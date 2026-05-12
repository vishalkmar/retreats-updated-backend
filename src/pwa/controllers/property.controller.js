const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');
const {
  Property,
  PropertyField,
  FieldReview,
  Message,
  Contract,
  Auditor,
  Officer,
} = require('../models');
const { ok, created, fail } = require('../../utils/response');
const { getUploadedUrl, removeUploadedFile } = require('../../utils/uploads');
const { generatePropertyCode } = require('../services/propertyId');
const { emitToProperty } = require('../services/socket');
const { SECTION_KEY_SET, SECTION_KEYS, PROPERTY_STATUS, FIELD_DECISION } = require('../constants');

// --- shared helpers ----------------------------------------------------

const propertyInclude = () => [
  { model: PropertyField, as: 'fields' },
  { model: FieldReview, as: 'reviews' },
  { model: Auditor, as: 'auditor', attributes: ['id', 'name', 'email', 'phone', 'profilePhotoUrl'] },
  { model: Officer, as: 'officer', attributes: ['id', 'name', 'email'] },
  { model: Contract, as: 'contract' },
];

const loadOwnProperty = async (auditorId, id) => {
  return Property.findOne({
    where: { id, auditorId },
    include: propertyInclude(),
  });
};

// --- Phase 1: Auditor creates property with basic details --------------

const createPhase1 = asyncHandler(async (req, res) => {
  const {
    name,
    address,
    locationMode,
    locationText,
    latitude,
    longitude,
    ownerName,
    ownerEmail,
    ownerPhone,
    numberOfRooms,
    pricing,
  } = req.body;

  if (!name?.trim() || !address?.trim() || !ownerName?.trim() || !ownerEmail?.trim()) {
    return fail(res, 'Name, address, owner name and owner email are required', 400);
  }

  const property = await Property.create({
    auditorId: req.pwaUser.id,
    name: name.trim(),
    address: address.trim(),
    locationMode: locationMode === 'pinned' ? 'pinned' : 'manual',
    locationText: locationText?.trim() || null,
    latitude: latitude || null,
    longitude: longitude || null,
    ownerName: ownerName.trim(),
    ownerEmail: ownerEmail.toLowerCase().trim(),
    ownerPhone: ownerPhone?.trim() || null,
    numberOfRooms: numberOfRooms ? parseInt(numberOfRooms, 10) : null,
    pricing: pricing?.trim() || null,
    status: PROPERTY_STATUS.PHASE1_DONE,
    phase: 2,
  });

  return created(res, { property }, 'Phase 1 saved');
});

// --- Phase 2: lock in the propertyCode ---------------------------------

const generateId = asyncHandler(async (req, res) => {
  const property = await loadOwnProperty(req.pwaUser.id, req.params.id);
  if (!property) return fail(res, 'Property not found', 404);
  if (property.propertyCode) {
    return ok(res, { property }, 'Property ID already generated');
  }
  property.propertyCode = await generatePropertyCode();
  property.phase = 3;
  await property.save();
  return ok(res, { property }, 'Property ID generated');
});

// --- Phase 3: upsert a section (description + photos) ------------------
//
// Multer is set up to handle up to 10 photos under field name "photos".
// `description` is plain text/HTML. `replacePhotos` (boolean) controls
// whether the new photo list replaces or appends.

const upsertSection = asyncHandler(async (req, res) => {
  const property = await loadOwnProperty(req.pwaUser.id, req.params.id);
  if (!property) return fail(res, 'Property not found', 404);
  if (!property.propertyCode) {
    return fail(res, 'Generate the Property ID first (Phase 2)', 400);
  }

  const sectionKey = req.params.sectionKey;
  if (!SECTION_KEY_SET.has(sectionKey)) return fail(res, 'Invalid section', 400);

  const incomingPhotos = (req.files || []).map(getUploadedUrl).filter(Boolean);
  const description = req.body.description ?? null;
  const replacePhotos = req.body.replacePhotos === 'true';
  const removeUrls = req.body.removeUrls
    ? String(req.body.removeUrls).split(',').filter(Boolean)
    : [];

  let field = await PropertyField.findOne({
    where: { propertyId: property.id, sectionKey },
  });

  const existingPhotos = field?.photoUrls || [];
  const kept = replacePhotos
    ? []
    : existingPhotos.filter((u) => !removeUrls.includes(u));
  // Best-effort delete of dropped photos
  if (!replacePhotos) {
    removeUrls.forEach((u) => removeUploadedFile(u));
  } else {
    existingPhotos.forEach((u) => removeUploadedFile(u));
  }
  const merged = [...kept, ...incomingPhotos];

  if (!field) {
    field = await PropertyField.create({
      propertyId: property.id,
      sectionKey,
      description,
      photoUrls: merged,
      iteration: 1,
      updatedByAuditorAt: new Date(),
    });
  } else {
    field.description = description ?? field.description;
    field.photoUrls = merged;
    field.updatedByAuditorAt = new Date();
    if (property.status === PROPERTY_STATUS.IN_REVISION) field.iteration += 1;
    await field.save();
  }

  // Reset officer's review for this section so it goes back to pending.
  const review = await FieldReview.findOne({
    where: { propertyId: property.id, sectionKey },
  });
  if (review) {
    review.decision = FIELD_DECISION.PENDING;
    review.comment = null;
    review.reviewedAt = null;
    await review.save();
  }

  emitToProperty(property.id, 'property:field-updated', {
    propertyId: property.id,
    sectionKey,
    field,
    review,
  });

  return ok(res, { field, review }, 'Section saved');
});

// --- Final submit ------------------------------------------------------

const submitForReview = asyncHandler(async (req, res) => {
  const property = await loadOwnProperty(req.pwaUser.id, req.params.id);
  if (!property) return fail(res, 'Property not found', 404);
  if (!property.propertyCode) return fail(res, 'Generate the Property ID first', 400);

  // Validate every required section has a description and >= 1 photo
  const fields = await PropertyField.findAll({ where: { propertyId: property.id } });
  const byKey = Object.fromEntries(fields.map((f) => [f.sectionKey, f]));
  const missing = SECTION_KEYS
    .filter((s) => s.required)
    .filter((s) => {
      const f = byKey[s.key];
      return !f || !f.description?.trim() || !(f.photoUrls || []).length;
    })
    .map((s) => s.label);

  if (missing.length) {
    return fail(res, `Missing required sections: ${missing.join(', ')}`, 400);
  }

  // Ensure pending reviews exist for every section
  for (const f of fields) {
    const review = await FieldReview.findOne({
      where: { propertyId: property.id, sectionKey: f.sectionKey },
    });
    if (!review) {
      await FieldReview.create({
        propertyId: property.id,
        sectionKey: f.sectionKey,
        decision: FIELD_DECISION.PENDING,
      });
    }
  }

  // Round-robin assignment: pick the active officer with the fewest open
  // properties so workload stays balanced.
  if (!property.assignedOfficerId) {
    const officers = await Officer.findAll({
      where: { isActive: true },
      attributes: ['id'],
    });
    if (officers.length) {
      const counts = await Property.findAll({
        attributes: [
          'assignedOfficerId',
          [require('sequelize').fn('COUNT', '*'), 'cnt'],
        ],
        where: {
          assignedOfficerId: officers.map((o) => o.id),
          status: [
            PROPERTY_STATUS.PHASE3_SUBMITTED,
            PROPERTY_STATUS.IN_REVIEW,
            PROPERTY_STATUS.IN_REVISION,
          ],
        },
        group: ['assignedOfficerId'],
        raw: true,
      });
      const countMap = Object.fromEntries(counts.map((c) => [c.assignedOfficerId, parseInt(c.cnt, 10)]));
      const pick = officers
        .map((o) => ({ id: o.id, n: countMap[o.id] || 0 }))
        .sort((a, b) => a.n - b.n)[0];
      property.assignedOfficerId = pick.id;
    }
  }

  property.status = property.status === PROPERTY_STATUS.IN_REVISION
    ? PROPERTY_STATUS.IN_REVISION
    : PROPERTY_STATUS.PHASE3_SUBMITTED;
  property.submittedAt = new Date();
  await property.save();

  emitToProperty(property.id, 'property:status', {
    propertyId: property.id,
    status: property.status,
  });

  const full = await Property.findByPk(property.id, { include: propertyInclude() });
  return ok(res, { property: full }, 'Submitted for review');
});

// --- Auditor: read endpoints ------------------------------------------

const listMyProperties = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const where = { auditorId: req.pwaUser.id };
  if (status === 'objections') {
    where.status = [PROPERTY_STATUS.IN_REVISION];
  } else if (status === 'following') {
    where.status = [PROPERTY_STATUS.IN_REVISION, PROPERTY_STATUS.IN_REVIEW];
  } else if (status === 'active') {
    where.status = {
      [Op.notIn]: [PROPERTY_STATUS.REJECTED, PROPERTY_STATUS.COMPLETED],
    };
  } else if (status === 'completed') {
    where.status = [PROPERTY_STATUS.COMPLETED, PROPERTY_STATUS.CONTRACT_SIGNED];
  } else if (status === 'rejected') {
    where.status = PROPERTY_STATUS.REJECTED;
  }
  const items = await Property.findAll({
    where,
    include: [{ model: FieldReview, as: 'reviews' }, { model: Contract, as: 'contract' }],
    order: [['updatedAt', 'DESC']],
  });
  return ok(res, { items });
});

const getMyProperty = asyncHandler(async (req, res) => {
  const property = await loadOwnProperty(req.pwaUser.id, req.params.id);
  if (!property) return fail(res, 'Property not found', 404);
  return ok(res, { property });
});

// --- Messages (shared by Auditor and Officer; access checked here) -----

const ensureActorCanAccessProperty = async (req, propertyId) => {
  const property = await Property.findByPk(propertyId);
  if (!property) return null;
  if (req.pwaRole === 'auditor' && property.auditorId === req.pwaUser.id) return property;
  if (req.pwaRole === 'officer') {
    // Officer can access any property assigned to them OR any property in
    // a queue state (no officer assigned yet) — supports "pick up new" UI.
    if (!property.assignedOfficerId || property.assignedOfficerId === req.pwaUser.id) return property;
  }
  return null;
};

const listMessages = asyncHandler(async (req, res) => {
  const property = await ensureActorCanAccessProperty(req, req.params.id);
  if (!property) return fail(res, 'Property not found', 404);
  const { sectionKey } = req.query;
  const where = { propertyId: property.id };
  if (sectionKey) where.sectionKey = sectionKey === 'general' ? null : sectionKey;
  const items = await Message.findAll({ where, order: [['createdAt', 'ASC']] });
  return ok(res, { items });
});

const postMessage = asyncHandler(async (req, res) => {
  const property = await ensureActorCanAccessProperty(req, req.params.id);
  if (!property) return fail(res, 'Property not found', 404);
  const { body, sectionKey } = req.body;
  if (!body?.trim()) return fail(res, 'body is required', 400);
  const msg = await Message.create({
    propertyId: property.id,
    senderId: req.pwaUser.id,
    senderType: req.pwaRole,
    sectionKey: sectionKey && sectionKey !== 'general' ? sectionKey : null,
    body: body.trim(),
  });
  emitToProperty(property.id, 'property:message', { message: msg });
  return created(res, { message: msg });
});

module.exports = {
  createPhase1,
  generateId,
  upsertSection,
  submitForReview,
  listMyProperties,
  getMyProperty,
  listMessages,
  postMessage,
};
