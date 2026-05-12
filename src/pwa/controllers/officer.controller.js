const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');
const {
  Property,
  PropertyField,
  FieldReview,
  Contract,
  Auditor,
  Officer,
} = require('../models');
const { ok, fail } = require('../../utils/response');
const { emitToProperty } = require('../services/socket');
const { sendContract } = require('../services/mailer');
const { generateContractPdf } = require('../services/contractPdf');
const { SECTION_KEY_SET, PROPERTY_STATUS, FIELD_DECISION } = require('../constants');

// All routes here use authenticatePwa + requireRoles('officer') in the
// router. We additionally scope every query to the officer's own id once a
// property has been assigned, but leave unassigned-but-submitted properties
// visible (so officers can "claim" new ones).

const propertyInclude = () => [
  { model: PropertyField, as: 'fields' },
  { model: FieldReview, as: 'reviews' },
  { model: Auditor, as: 'auditor', attributes: ['id', 'name', 'email', 'phone', 'profilePhotoUrl'] },
  { model: Contract, as: 'contract' },
];

const visibilityFilter = (officerId) => ({
  [Op.or]: [
    { assignedOfficerId: officerId },
    { assignedOfficerId: null, status: PROPERTY_STATUS.PHASE3_SUBMITTED },
  ],
});

// --- Tabs --------------------------------------------------------------

const listProperties = asyncHandler(async (req, res) => {
  const { tab = 'new' } = req.query;
  const officerId = req.pwaUser.id;

  let where = { ...visibilityFilter(officerId) };
  if (tab === 'new') {
    where.status = [PROPERTY_STATUS.PHASE3_SUBMITTED, PROPERTY_STATUS.IN_REVIEW];
  } else if (tab === 'follow-up') {
    where.status = [PROPERTY_STATUS.IN_REVISION];
    where.assignedOfficerId = officerId; // only mine
  } else if (tab === 'rejected') {
    where.status = [PROPERTY_STATUS.REJECTED];
    where.assignedOfficerId = officerId;
  } else if (tab === 'approved') {
    where.status = [
      PROPERTY_STATUS.APPROVED,
      PROPERTY_STATUS.CONTRACT_SENT,
      PROPERTY_STATUS.CONTRACT_SIGNED,
      PROPERTY_STATUS.COMPLETED,
    ];
    where.assignedOfficerId = officerId;
  } else if (tab === 'all') {
    where.assignedOfficerId = officerId;
  }

  const items = await Property.findAll({
    where,
    include: [
      { model: Auditor, as: 'auditor', attributes: ['id', 'name', 'email', 'profilePhotoUrl'] },
      { model: FieldReview, as: 'reviews' },
    ],
    order: [['submittedAt', 'DESC'], ['updatedAt', 'DESC']],
  });
  return ok(res, { items });
});

const getProperty = asyncHandler(async (req, res) => {
  const property = await Property.findOne({
    where: { id: req.params.id, ...visibilityFilter(req.pwaUser.id) },
    include: propertyInclude(),
  });
  if (!property) return fail(res, 'Property not found', 404);
  return ok(res, { property });
});

// --- Claim a new property (auto-assign current officer) ----------------

const claim = asyncHandler(async (req, res) => {
  const property = await Property.findByPk(req.params.id);
  if (!property) return fail(res, 'Property not found', 404);
  if (property.assignedOfficerId && property.assignedOfficerId !== req.pwaUser.id) {
    return fail(res, 'Another officer is already on this case', 409);
  }
  property.assignedOfficerId = req.pwaUser.id;
  if (property.status === PROPERTY_STATUS.PHASE3_SUBMITTED) {
    property.status = PROPERTY_STATUS.IN_REVIEW;
  }
  await property.save();
  emitToProperty(property.id, 'property:status', {
    propertyId: property.id,
    status: property.status,
    assignedOfficerId: property.assignedOfficerId,
  });
  return ok(res, { property }, 'Claimed');
});

// --- Field-level decision (green/red) ----------------------------------

const decideField = asyncHandler(async (req, res) => {
  const { id: propertyId, sectionKey } = req.params;
  const { decision, comment } = req.body;
  if (!SECTION_KEY_SET.has(sectionKey)) return fail(res, 'Invalid section', 400);
  if (![FIELD_DECISION.APPROVED, FIELD_DECISION.REJECTED].includes(decision)) {
    return fail(res, 'decision must be approved or objection', 400);
  }
  if (decision === FIELD_DECISION.REJECTED && !comment?.trim()) {
    return fail(res, 'Raising an objection requires a comment', 400);
  }

  const property = await Property.findOne({
    where: { id: propertyId, ...visibilityFilter(req.pwaUser.id) },
  });
  if (!property) return fail(res, 'Property not found', 404);

  // Officer auto-claims on first review action.
  if (!property.assignedOfficerId) {
    property.assignedOfficerId = req.pwaUser.id;
  }
  if (property.status === PROPERTY_STATUS.PHASE3_SUBMITTED) {
    property.status = PROPERTY_STATUS.IN_REVIEW;
  }

  const [review] = await FieldReview.findOrCreate({
    where: { propertyId: property.id, sectionKey },
    defaults: { decision: FIELD_DECISION.PENDING },
  });
  review.decision = decision;
  review.comment = decision === FIELD_DECISION.REJECTED ? comment.trim() : null;
  review.officerId = req.pwaUser.id;
  review.reviewedAt = new Date();
  await review.save();

  // If anything has an objection, parent property moves to in_revision so the
  // auditor sees objections on their dashboard. If everything is approved
  // and at least every required section is decided, we stay in_review
  // until the officer hits the final approve action.
  if (decision === FIELD_DECISION.REJECTED) {
    property.status = PROPERTY_STATUS.IN_REVISION;
  }
  await property.save();

  emitToProperty(property.id, 'property:field-review', {
    propertyId: property.id,
    sectionKey,
    review,
    status: property.status,
  });

  return ok(res, { review, status: property.status }, 'Decision recorded');
});

// --- Suggestion box (free-form) ----------------------------------------

const updateSuggestion = asyncHandler(async (req, res) => {
  const property = await Property.findOne({
    where: { id: req.params.id, ...visibilityFilter(req.pwaUser.id) },
  });
  if (!property) return fail(res, 'Property not found', 404);
  property.officerSuggestion = req.body.suggestion?.trim() || null;
  if (!property.assignedOfficerId) property.assignedOfficerId = req.pwaUser.id;
  await property.save();
  emitToProperty(property.id, 'property:suggestion', {
    propertyId: property.id,
    suggestion: property.officerSuggestion,
  });
  return ok(res, { property });
});

// --- Keep in follow-up -------------------------------------------------

const followUpProperty = asyncHandler(async (req, res) => {
  const property = await Property.findOne({
    where: { id: req.params.id, ...visibilityFilter(req.pwaUser.id) },
  });
  if (!property) return fail(res, 'Property not found', 404);
  if ([
    PROPERTY_STATUS.APPROVED,
    PROPERTY_STATUS.CONTRACT_SENT,
    PROPERTY_STATUS.CONTRACT_SIGNED,
    PROPERTY_STATUS.COMPLETED,
    PROPERTY_STATUS.REJECTED,
  ].includes(property.status)) {
    return fail(res, 'Finalized properties cannot move to follow-up', 400);
  }

  property.status = PROPERTY_STATUS.IN_REVISION;
  property.officerSuggestion = req.body.suggestion?.trim() || property.officerSuggestion;
  property.assignedOfficerId = property.assignedOfficerId || req.pwaUser.id;
  await property.save();

  emitToProperty(property.id, 'property:status', {
    propertyId: property.id,
    status: property.status,
    suggestion: property.officerSuggestion,
  });

  return ok(res, { property }, 'Moved to follow-up');
});

// --- Final approve (generates contract + emails owner) -----------------

const approveProperty = asyncHandler(async (req, res) => {
  const property = await Property.findOne({
    where: { id: req.params.id, ...visibilityFilter(req.pwaUser.id) },
    include: propertyInclude(),
  });
  if (!property) return fail(res, 'Property not found', 404);

  // All non-pending decisions, no objections.
  const reviews = await FieldReview.findAll({ where: { propertyId: property.id } });
  const hasRejected = reviews.some((r) => r.decision === FIELD_DECISION.REJECTED);
  const hasPending = reviews.some((r) => r.decision === FIELD_DECISION.PENDING);
  if (hasRejected) return fail(res, 'Cannot approve while any section has an objection', 400);
  if (hasPending) return fail(res, 'All sections must be marked approved before final approval', 400);

  property.status = PROPERTY_STATUS.APPROVED;
  property.approvedAt = new Date();
  property.assignedOfficerId = property.assignedOfficerId || req.pwaUser.id;
  await property.save();

  const officer = await Officer.findByPk(property.assignedOfficerId);

  // Generate PDF + email owner. PDF body lives in memory; we keep a
  // /uploads-style URL only if you decide to store it later.
  let pdfBuffer = null;
  try {
    pdfBuffer = await generateContractPdf({
      property,
      auditor: property.auditor,
      officerName: officer?.name,
    });
  } catch (err) {
    console.error('[PWA] PDF generation failed:', err);
  }

  let contract = await Contract.findOne({ where: { propertyId: property.id } });
  if (!contract) {
    contract = await Contract.create({ propertyId: property.id });
  }
  contract.sentAt = new Date();
  await contract.save();

  try {
    if (pdfBuffer) {
      await sendContract({
        to: property.ownerEmail,
        ownerName: property.ownerName,
        propertyName: property.name,
        propertyCode: property.propertyCode,
        pdfBuffer,
        pdfFilename: `contract-${property.propertyCode}.pdf`,
      });
    }
  } catch (err) {
    console.warn('[PWA] sendContract failed:', err.message);
  }

  property.status = PROPERTY_STATUS.CONTRACT_SENT;
  await property.save();

  emitToProperty(property.id, 'property:status', {
    propertyId: property.id,
    status: property.status,
  });

  return ok(res, { property, contract }, 'Approved — contract sent to owner');
});

// --- Final reject ------------------------------------------------------

const rejectProperty = asyncHandler(async (req, res) => {
  const property = await Property.findOne({
    where: { id: req.params.id, ...visibilityFilter(req.pwaUser.id) },
  });
  if (!property) return fail(res, 'Property not found', 404);
  const { reason } = req.body;
  if (!reason?.trim()) return fail(res, 'A rejection reason is required', 400);
  property.status = PROPERTY_STATUS.REJECTED;
  property.rejectedReason = reason.trim();
  property.assignedOfficerId = property.assignedOfficerId || req.pwaUser.id;
  await property.save();
  emitToProperty(property.id, 'property:status', {
    propertyId: property.id,
    status: property.status,
    rejectedReason: property.rejectedReason,
  });
  return ok(res, { property }, 'Property rejected');
});

module.exports = {
  listProperties,
  getProperty,
  claim,
  decideField,
  updateSuggestion,
  followUpProperty,
  approveProperty,
  rejectProperty,
};
