const asyncHandler = require('express-async-handler');
const slugify = require('slugify');
const { Op } = require('sequelize');
const {
  AddOnActivity,
  AddOnActivityImage,
  Location,
  sequelize,
} = require('../models');
const { ok, created, fail } = require('../utils/response');
const { getUploadedUrl, removeUploadedFile } = require('../utils/uploads');

const buildUrl = (file) => getUploadedUrl(file);
const removeFileIfLocal = (url) => removeUploadedFile(url);

const ensureUniqueSlug = async (base, ignoreId = null) => {
  let slug = slugify(base, { lower: true, strict: true });
  if (!slug) slug = `addon-${Date.now()}`;
  let candidate = slug;
  let i = 1;
  while (
    await AddOnActivity.findOne({
      where: { slug: candidate, ...(ignoreId && { id: { [Op.ne]: ignoreId } }) },
    })
  ) {
    candidate = `${slug}-${i++}`;
    if (i > 50) break;
  }
  return candidate;
};

const parseJsonField = (raw, fallback = []) => {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (Array.isArray(raw) || typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
};

const baseInclude = () => [
  { model: Location, as: 'location' },
  { model: AddOnActivityImage, as: 'gallery' },
];

// GET /api/add-ons  (public — listing with optional location filter)
const listPublic = asyncHandler(async (req, res) => {
  const { location, locationId, featured, limit = 12, page = 1 } = req.query;

  const where = { isActive: true };
  if (locationId) where.locationId = parseInt(locationId, 10);
  if (featured === 'true') where.isFeatured = true;

  const include = baseInclude();
  if (location) {
    include[0] = { ...include[0], where: { slug: location }, required: true };
  }

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const { rows, count } = await AddOnActivity.findAndCountAll({
    where,
    include,
    order: [['sortOrder', 'ASC'], ['id', 'DESC']],
    limit: parseInt(limit, 10),
    offset,
    distinct: true,
  });

  return ok(res, {
    items: rows,
    pagination: {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      total: count,
      pages: Math.ceil(count / parseInt(limit, 10)),
    },
  });
});

// GET /api/add-ons/:slug  (public)
const getBySlug = asyncHandler(async (req, res) => {
  const item = await AddOnActivity.findOne({
    where: { slug: req.params.slug, isActive: true },
    include: baseInclude(),
  });
  if (!item) return fail(res, 'Activity not found', 404);
  return ok(res, { activity: item });
});

// GET /api/add-ons/admin/all
const listAdmin = asyncHandler(async (req, res) => {
  const items = await AddOnActivity.findAll({
    include: baseInclude(),
    order: [['sortOrder', 'ASC'], ['id', 'DESC']],
  });
  return ok(res, { items });
});

// GET /api/add-ons/admin/:id
const getAdminOne = asyncHandler(async (req, res) => {
  const item = await AddOnActivity.findByPk(req.params.id, { include: baseInclude() });
  if (!item) return fail(res, 'Activity not found', 404);
  return ok(res, { activity: item });
});

// POST /api/add-ons
const createActivity = asyncHandler(async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const body = req.body;
    if (!body.name?.trim()) {
      await t.rollback();
      return fail(res, 'name is required', 400);
    }

    const slug = await ensureUniqueSlug(body.slug || body.name);
    const mainImageFile = req.files?.mainImage?.[0];
    const galleryFiles = req.files?.gallery || [];

    const item = await AddOnActivity.create(
      {
        name: body.name,
        slug,
        locationId: body.locationId ? parseInt(body.locationId, 10) : null,
        price: body.price ? parseFloat(body.price) : 0,
        priceOriginal: body.priceOriginal ? parseFloat(body.priceOriginal) : null,
        currency: body.currency || 'INR',
        mainImage: mainImageFile ? buildUrl(mainImageFile) : null,
        descriptionRich: body.descriptionRich || null,
        highlightsRich: body.highlightsRich || null,
        minAge: body.minAge ? parseInt(body.minAge, 10) : null,
        maxAge: body.maxAge ? parseInt(body.maxAge, 10) : null,
        faqs: parseJsonField(body.faqs, []),
        isFeatured: body.isFeatured === 'true',
        isActive: body.isActive === 'false' ? false : true,
        sortOrder: body.sortOrder ? parseInt(body.sortOrder, 10) : 0,
      },
      { transaction: t }
    );

    if (galleryFiles.length) {
      await AddOnActivityImage.bulkCreate(
        galleryFiles.map((f, i) => ({
          activityId: item.id,
          url: buildUrl(f),
          sortOrder: i,
        })),
        { transaction: t }
      );
    }

    await t.commit();
    const fresh = await AddOnActivity.findByPk(item.id, { include: baseInclude() });
    return created(res, { activity: fresh }, 'Activity created');
  } catch (err) {
    await t.rollback();
    Object.values(req.files || {}).forEach((arr) =>
      arr.forEach((f) => removeFileIfLocal(buildUrl(f)))
    );
    throw err;
  }
});

// PUT /api/add-ons/:id
const updateActivity = asyncHandler(async (req, res) => {
  const item = await AddOnActivity.findByPk(req.params.id);
  if (!item) return fail(res, 'Activity not found', 404);

  const body = req.body;
  const mainImageFile = req.files?.mainImage?.[0];
  const galleryFiles = req.files?.gallery || [];

  if (body.name !== undefined) item.name = body.name;
  if (body.slug !== undefined && body.slug !== item.slug) {
    item.slug = await ensureUniqueSlug(body.slug, item.id);
  }

  ['currency', 'descriptionRich', 'highlightsRich'].forEach((f) => {
    if (body[f] !== undefined) item[f] = body[f] === '' ? null : body[f];
  });

  if (body.locationId !== undefined) {
    item.locationId = body.locationId === '' ? null : parseInt(body.locationId, 10);
  }
  if (body.price !== undefined && body.price !== '') item.price = parseFloat(body.price);
  if (body.priceOriginal !== undefined)
    item.priceOriginal = body.priceOriginal === '' ? null : parseFloat(body.priceOriginal);
  if (body.minAge !== undefined) item.minAge = body.minAge === '' ? null : parseInt(body.minAge, 10);
  if (body.maxAge !== undefined) item.maxAge = body.maxAge === '' ? null : parseInt(body.maxAge, 10);
  if (body.sortOrder !== undefined && body.sortOrder !== '')
    item.sortOrder = parseInt(body.sortOrder, 10);

  ['isFeatured', 'isActive'].forEach((f) => {
    if (body[f] !== undefined) item[f] = body[f] === 'true' || body[f] === true;
  });

  if (body.faqs !== undefined) item.faqs = parseJsonField(body.faqs, []);

  if (mainImageFile) {
    if (item.mainImage) removeFileIfLocal(item.mainImage);
    item.mainImage = buildUrl(mainImageFile);
  }

  await item.save();

  if (galleryFiles.length) {
    if (body.replaceGallery === 'true') {
      const existing = await AddOnActivityImage.findAll({ where: { activityId: item.id } });
      existing.forEach((g) => removeFileIfLocal(g.url));
      await AddOnActivityImage.destroy({ where: { activityId: item.id } });
    }
    const offset = await AddOnActivityImage.count({ where: { activityId: item.id } });
    await AddOnActivityImage.bulkCreate(
      galleryFiles.map((f, i) => ({
        activityId: item.id,
        url: buildUrl(f),
        sortOrder: offset + i,
      }))
    );
  }

  const fresh = await AddOnActivity.findByPk(item.id, { include: baseInclude() });
  return ok(res, { activity: fresh }, 'Activity updated');
});

// POST /api/add-ons/:id/duplicate
const duplicateActivity = asyncHandler(async (req, res) => {
  const original = await AddOnActivity.findByPk(req.params.id, { include: baseInclude() });
  if (!original) return fail(res, 'Activity not found', 404);

  const t = await sequelize.transaction();
  try {
    const data = original.toJSON();
    const slug = await ensureUniqueSlug(`${data.slug}-copy`);
    ['id', 'slug', 'createdAt', 'updatedAt', 'location', 'gallery'].forEach((k) => delete data[k]);

    const copy = await AddOnActivity.create(
      {
        ...data,
        name: original.name,
        slug,
        isActive: false,
        isFeatured: false,
      },
      { transaction: t }
    );

    if (original.gallery?.length) {
      await AddOnActivityImage.bulkCreate(
        original.gallery.map((g, i) => ({
          activityId: copy.id,
          url: g.url,
          caption: g.caption,
          sortOrder: i,
        })),
        { transaction: t }
      );
    }

    await t.commit();
    const fresh = await AddOnActivity.findByPk(copy.id, { include: baseInclude() });
    return created(res, { activity: fresh }, 'Activity duplicated');
  } catch (err) {
    await t.rollback();
    throw err;
  }
});

// PATCH /api/add-ons/:id/toggle
const toggle = asyncHandler(async (req, res) => {
  const item = await AddOnActivity.findByPk(req.params.id);
  if (!item) return fail(res, 'Activity not found', 404);
  item.isActive = !item.isActive;
  await item.save();
  return ok(res, { activity: item }, `Activity ${item.isActive ? 'published' : 'unpublished'}`);
});

// PUT /api/add-ons/admin/reorder
const reorder = asyncHandler(async (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return fail(res, 'order must be an array of ids', 400);
  await Promise.all(order.map((id, idx) => AddOnActivity.update({ sortOrder: idx }, { where: { id } })));
  return ok(res, {}, 'Reordered');
});

// DELETE /api/add-ons/:id
const removeActivity = asyncHandler(async (req, res) => {
  const item = await AddOnActivity.findByPk(req.params.id, {
    include: [{ model: AddOnActivityImage, as: 'gallery' }],
  });
  if (!item) return fail(res, 'Activity not found', 404);
  if (item.mainImage) removeFileIfLocal(item.mainImage);
  item.gallery?.forEach((g) => removeFileIfLocal(g.url));
  await item.destroy();
  return ok(res, {}, 'Activity deleted');
});

// DELETE /api/add-ons/:id/gallery/:imageId
const removeGalleryImage = asyncHandler(async (req, res) => {
  const img = await AddOnActivityImage.findOne({
    where: { id: req.params.imageId, activityId: req.params.id },
  });
  if (!img) return fail(res, 'Image not found', 404);
  removeFileIfLocal(img.url);
  await img.destroy();
  return ok(res, {}, 'Image removed');
});

module.exports = {
  listPublic,
  getBySlug,
  listAdmin,
  getAdminOne,
  createActivity,
  updateActivity,
  duplicateActivity,
  toggle,
  reorder,
  removeActivity,
  removeGalleryImage,
};
