const asyncHandler = require('express-async-handler');
const slugify = require('slugify');
const { Op } = require('sequelize');
const {
  AvailableRoom,
  AvailableRoomImage,
  Hotel,
  Facility,
  RoomView,
  sequelize,
} = require('../models');
const { ok, created, fail } = require('../utils/response');
const { getUploadedUrl, removeUploadedFile } = require('../utils/uploads');

const buildUrl = (file) => getUploadedUrl(file);
const removeFileIfLocal = (url) => removeUploadedFile(url);

// Slug uniqueness is per-hotel — same slug "deluxe-suite" can exist under
// different hotels.
const ensureUniqueSlug = async (hotelId, base, ignoreId = null) => {
  let slug = slugify(base, { lower: true, strict: true });
  if (!slug) slug = `room-${Date.now()}`;
  let candidate = slug;
  let i = 1;
  while (
    await AvailableRoom.findOne({
      where: {
        hotelId,
        slug: candidate,
        ...(ignoreId && { id: { [Op.ne]: ignoreId } }),
      },
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

const parseIntArray = (raw) => {
  const arr = parseJsonField(raw, []);
  return Array.isArray(arr) ? arr.map((x) => parseInt(x, 10)).filter(Boolean) : [];
};

const baseInclude = () => [
  { model: Hotel, as: 'hotel', attributes: ['id', 'name', 'slug', 'primaryImage'] },
  { model: Facility, as: 'facilities', through: { attributes: [] } },
  { model: RoomView, as: 'views', through: { attributes: [] } },
  { model: AvailableRoomImage, as: 'gallery' },
];

// ─── Public ───────────────────────────────────────────────────────────────

// GET /api/rooms?hotelSlug=...   (public — list rooms for a hotel by slug)
const listPublicByHotel = asyncHandler(async (req, res) => {
  const { hotelSlug, hotelId } = req.query;
  if (!hotelSlug && !hotelId) {
    return fail(res, 'hotelSlug or hotelId is required', 400);
  }

  const hotel = hotelId
    ? await Hotel.findByPk(hotelId)
    : await Hotel.findOne({ where: { slug: hotelSlug } });
  if (!hotel) return fail(res, 'Hotel not found', 404);

  const rooms = await AvailableRoom.findAll({
    where: { hotelId: hotel.id, isActive: true },
    include: baseInclude(),
    order: [['sortOrder', 'ASC'], ['price', 'ASC']],
  });

  return ok(res, { items: rooms, hotel: { id: hotel.id, slug: hotel.slug, name: hotel.name } });
});

// GET /api/rooms/by-slug?hotelSlug=...&roomSlug=...   (public — detail)
const getBySlug = asyncHandler(async (req, res) => {
  const { hotelSlug, roomSlug } = req.query;
  if (!hotelSlug || !roomSlug) return fail(res, 'hotelSlug and roomSlug are required', 400);

  const hotel = await Hotel.findOne({ where: { slug: hotelSlug, isActive: true } });
  if (!hotel) return fail(res, 'Hotel not found', 404);

  const room = await AvailableRoom.findOne({
    where: { hotelId: hotel.id, slug: roomSlug, isActive: true },
    include: baseInclude(),
  });
  if (!room) return fail(res, 'Room not found', 404);

  return ok(res, { room });
});

// ─── Admin ────────────────────────────────────────────────────────────────

// GET /api/rooms/admin/all?hotelId=...   (admin — list, optional hotel filter)
const listAdmin = asyncHandler(async (req, res) => {
  const where = {};
  if (req.query.hotelId) where.hotelId = parseInt(req.query.hotelId, 10);

  const items = await AvailableRoom.findAll({
    where,
    include: baseInclude(),
    order: [['hotelId', 'ASC'], ['sortOrder', 'ASC'], ['id', 'DESC']],
  });
  return ok(res, { items });
});

// GET /api/rooms/admin/:id
const getAdminOne = asyncHandler(async (req, res) => {
  const room = await AvailableRoom.findByPk(req.params.id, { include: baseInclude() });
  if (!room) return fail(res, 'Room not found', 404);
  return ok(res, { room });
});

// POST /api/rooms   (admin — multipart mainImage + gallery[])
const createRoom = asyncHandler(async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const body = req.body;
    if (!body.name?.trim()) {
      await t.rollback();
      return fail(res, 'name is required', 400);
    }
    if (!body.hotelId) {
      await t.rollback();
      return fail(res, 'hotelId is required', 400);
    }

    const hotelId = parseInt(body.hotelId, 10);
    const hotel = await Hotel.findByPk(hotelId);
    if (!hotel) {
      await t.rollback();
      return fail(res, 'Hotel not found', 404);
    }

    const slug = await ensureUniqueSlug(hotelId, body.slug || body.name);

    const mainImageFile = req.files?.mainImage?.[0];
    const galleryFiles = req.files?.gallery || [];

    const room = await AvailableRoom.create(
      {
        hotelId,
        name: body.name,
        slug,
        price: body.price ? parseFloat(body.price) : 0,
        priceOriginal: body.priceOriginal ? parseFloat(body.priceOriginal) : null,
        currency: body.currency || 'INR',
        roomSize: body.roomSize || null,
        maxOccupancy: body.maxOccupancy ? parseInt(body.maxOccupancy, 10) : 2,
        mainImage: mainImageFile ? buildUrl(mainImageFile) : null,
        highlightsRich: body.highlightsRich || null,
        descriptionRich: body.descriptionRich || null,
        isFeatured: body.isFeatured === 'true',
        isActive: body.isActive === 'false' ? false : true,
        sortOrder: body.sortOrder ? parseInt(body.sortOrder, 10) : 0,
      },
      { transaction: t }
    );

    const facilityIds = parseIntArray(body.facilityIds);
    const viewIds = parseIntArray(body.viewIds);
    if (facilityIds.length) await room.setFacilities(facilityIds, { transaction: t });
    if (viewIds.length) await room.setViews(viewIds, { transaction: t });

    if (galleryFiles.length) {
      await AvailableRoomImage.bulkCreate(
        galleryFiles.map((f, i) => ({
          roomId: room.id,
          url: buildUrl(f),
          sortOrder: i,
        })),
        { transaction: t }
      );
    }

    await t.commit();
    const fresh = await AvailableRoom.findByPk(room.id, { include: baseInclude() });
    return created(res, { room: fresh }, 'Room created');
  } catch (err) {
    await t.rollback();
    Object.values(req.files || {}).forEach((arr) =>
      arr.forEach((f) => removeFileIfLocal(buildUrl(f)))
    );
    throw err;
  }
});

// PUT /api/rooms/:id  (admin)
const updateRoom = asyncHandler(async (req, res) => {
  const room = await AvailableRoom.findByPk(req.params.id);
  if (!room) return fail(res, 'Room not found', 404);

  const body = req.body;
  const mainImageFile = req.files?.mainImage?.[0];
  const galleryFiles = req.files?.gallery || [];

  // Allow re-parenting to a different hotel
  if (body.hotelId !== undefined && body.hotelId !== '') {
    const newHotelId = parseInt(body.hotelId, 10);
    if (newHotelId !== room.hotelId) {
      const hotel = await Hotel.findByPk(newHotelId);
      if (!hotel) return fail(res, 'Target hotel not found', 404);
      room.hotelId = newHotelId;
    }
  }

  if (body.name !== undefined) room.name = body.name;
  if (body.slug !== undefined && body.slug !== room.slug) {
    room.slug = await ensureUniqueSlug(room.hotelId, body.slug, room.id);
  }

  const directFields = ['currency', 'roomSize', 'highlightsRich', 'descriptionRich'];
  directFields.forEach((f) => {
    if (body[f] !== undefined) room[f] = body[f] === '' ? null : body[f];
  });

  if (body.price !== undefined && body.price !== '') room.price = parseFloat(body.price);
  if (body.priceOriginal !== undefined)
    room.priceOriginal = body.priceOriginal === '' ? null : parseFloat(body.priceOriginal);
  if (body.maxOccupancy !== undefined && body.maxOccupancy !== '')
    room.maxOccupancy = parseInt(body.maxOccupancy, 10);
  if (body.sortOrder !== undefined && body.sortOrder !== '')
    room.sortOrder = parseInt(body.sortOrder, 10);

  ['isFeatured', 'isActive'].forEach((f) => {
    if (body[f] !== undefined) room[f] = body[f] === 'true' || body[f] === true;
  });

  if (mainImageFile) {
    if (room.mainImage) removeFileIfLocal(room.mainImage);
    room.mainImage = buildUrl(mainImageFile);
  }

  await room.save();

  if (body.facilityIds !== undefined) await room.setFacilities(parseIntArray(body.facilityIds));
  if (body.viewIds !== undefined) await room.setViews(parseIntArray(body.viewIds));

  if (galleryFiles.length) {
    if (body.replaceGallery === 'true') {
      const existing = await AvailableRoomImage.findAll({ where: { roomId: room.id } });
      existing.forEach((g) => removeFileIfLocal(g.url));
      await AvailableRoomImage.destroy({ where: { roomId: room.id } });
    }
    const offset = await AvailableRoomImage.count({ where: { roomId: room.id } });
    await AvailableRoomImage.bulkCreate(
      galleryFiles.map((f, i) => ({
        roomId: room.id,
        url: buildUrl(f),
        sortOrder: offset + i,
      }))
    );
  }

  const fresh = await AvailableRoom.findByPk(room.id, { include: baseInclude() });
  return ok(res, { room: fresh }, 'Room updated');
});

// POST /api/rooms/:id/duplicate  (admin)
const duplicateRoom = asyncHandler(async (req, res) => {
  const original = await AvailableRoom.findByPk(req.params.id, { include: baseInclude() });
  if (!original) return fail(res, 'Room not found', 404);

  const t = await sequelize.transaction();
  try {
    const data = original.toJSON();
    const slug = await ensureUniqueSlug(original.hotelId, `${data.slug}-copy`);

    ['id', 'slug', 'createdAt', 'updatedAt', 'hotel', 'facilities', 'views', 'gallery']
      .forEach((k) => delete data[k]);

    const copy = await AvailableRoom.create(
      {
        ...data,
        name: `${original.name} (Copy)`,
        slug,
        isActive: false,
        isFeatured: false,
      },
      { transaction: t }
    );

    const facilityIds = (original.facilities || []).map((f) => f.id);
    const viewIds = (original.views || []).map((v) => v.id);
    if (facilityIds.length) await copy.setFacilities(facilityIds, { transaction: t });
    if (viewIds.length) await copy.setViews(viewIds, { transaction: t });

    if (original.gallery?.length) {
      await AvailableRoomImage.bulkCreate(
        original.gallery.map((g, i) => ({
          roomId: copy.id,
          url: g.url,
          caption: g.caption,
          sortOrder: i,
        })),
        { transaction: t }
      );
    }

    await t.commit();
    const fresh = await AvailableRoom.findByPk(copy.id, { include: baseInclude() });
    return created(res, { room: fresh }, 'Room duplicated');
  } catch (err) {
    await t.rollback();
    throw err;
  }
});

// PATCH /api/rooms/:id/toggle
const toggle = asyncHandler(async (req, res) => {
  const room = await AvailableRoom.findByPk(req.params.id);
  if (!room) return fail(res, 'Room not found', 404);
  room.isActive = !room.isActive;
  await room.save();
  return ok(res, { room }, `Room ${room.isActive ? 'published' : 'unpublished'}`);
});

// PUT /api/rooms/admin/reorder   body: { order: [id, id, …] }
const reorderRooms = asyncHandler(async (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return fail(res, 'order must be an array of ids', 400);
  await Promise.all(order.map((id, idx) => AvailableRoom.update({ sortOrder: idx }, { where: { id } })));
  return ok(res, {}, 'Reordered');
});

// DELETE /api/rooms/:id
const removeRoom = asyncHandler(async (req, res) => {
  const room = await AvailableRoom.findByPk(req.params.id, {
    include: [{ model: AvailableRoomImage, as: 'gallery' }],
  });
  if (!room) return fail(res, 'Room not found', 404);

  if (room.mainImage) removeFileIfLocal(room.mainImage);
  room.gallery?.forEach((g) => removeFileIfLocal(g.url));

  await room.destroy();
  return ok(res, {}, 'Room deleted');
});

// DELETE /api/rooms/:id/gallery/:imageId
const removeGalleryImage = asyncHandler(async (req, res) => {
  const img = await AvailableRoomImage.findOne({
    where: { id: req.params.imageId, roomId: req.params.id },
  });
  if (!img) return fail(res, 'Image not found', 404);
  removeFileIfLocal(img.url);
  await img.destroy();
  return ok(res, {}, 'Image removed');
});

module.exports = {
  listPublicByHotel,
  getBySlug,
  listAdmin,
  getAdminOne,
  createRoom,
  updateRoom,
  duplicateRoom,
  toggle,
  reorderRooms,
  removeRoom,
  removeGalleryImage,
};
