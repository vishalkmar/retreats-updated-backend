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
const { notifyUser } = require('../services/notifications');
const { sendContract } = require('../services/mailer');
const { generateContractPdf } = require('../services/contractPdf');
const { uploadContractPdf } = require('../services/contractStorage');
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
    {
      assignedOfficerId: null,
      status: [PROPERTY_STATUS.PHASE3_SUBMITTED, PROPERTY_STATUS.PHASE4_SUBMITTED],
    },
  ],
});

// --- Tabs --------------------------------------------------------------

const listProperties = asyncHandler(async (req, res) => {
  const { tab = 'new' } = req.query;
  const officerId = req.pwaUser.id;

  let where = { ...visibilityFilter(officerId) };
  if (tab === 'new') {
    where.status = [PROPERTY_STATUS.PHASE3_SUBMITTED, PROPERTY_STATUS.IN_REVIEW];
  } else if (tab === 'phase4') {
    // Phase 4 deep-dive submissions awaiting officer review.
    where.status = [PROPERTY_STATUS.PHASE4_SUBMITTED];
  } else if (tab === 'follow-up') {
    where.status = [PROPERTY_STATUS.IN_REVISION, PROPERTY_STATUS.PHASE4_IN_REVISION];
    where.assignedOfficerId = officerId; // only mine
  } else if (tab === 'rejected') {
    where.status = [PROPERTY_STATUS.REJECTED];
    where.assignedOfficerId = officerId;
  } else if (tab === 'approved') {
    where.status = [
      PROPERTY_STATUS.APPROVED,
      PROPERTY_STATUS.PHASE4_SUBMITTED,
      PROPERTY_STATUS.PHASE4_IN_REVISION,
      PROPERTY_STATUS.FINAL_APPROVED,
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
  const { decision, comment, approvedForFutureReview } = req.body;
  if (!SECTION_KEY_SET.has(sectionKey)) return fail(res, 'Invalid section', 400);
  if (![FIELD_DECISION.APPROVED, FIELD_DECISION.REJECTED].includes(decision)) {
    return fail(res, 'decision must be approved or objection', 400);
  }
  if (decision === FIELD_DECISION.REJECTED && !comment?.trim()) {
    return fail(res, 'Raising an objection requires a comment', 400);
  }
  if (
    decision === FIELD_DECISION.APPROVED &&
    approvedForFutureReview === true &&
    !comment?.trim()
  ) {
    return fail(res, 'Approving with objection requires a note', 400);
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
  const approveWithObjection =
    decision === FIELD_DECISION.APPROVED && approvedForFutureReview === true;
  if (decision === FIELD_DECISION.REJECTED) {
    review.comment = comment.trim();
  } else if (approveWithObjection) {
    review.comment = comment.trim();
  } else {
    review.comment = null;
  }
  review.approvedForFutureReview = approveWithObjection;
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

  // Notify whoever is responsible for fixing the section. For auditor-
  // onboarded properties that's the auditor; for self-onboarded ones it's
  // the owner directly. Notification carries `sectionKey` + `propertyCode`
  // so the client can deep-link to the exact section editor.
  const sectionLabel = (
    require('../constants').SECTION_KEYS.find((s) => s.key === sectionKey)?.label
    || sectionKey
  );
  const notifType = decision === FIELD_DECISION.REJECTED
    ? 'section_objection'
    : approveWithObjection
      ? 'section_approved_objection'
      : 'section_approved';
  const notifTitle = decision === FIELD_DECISION.REJECTED
    ? `Objection on ${sectionLabel}`
    : approveWithObjection
      ? `Approved with a note: ${sectionLabel}`
      : `Approved: ${sectionLabel}`;
  const notifBody = review.comment || `Property ${property.propertyCode || `#${property.id}`}`;
  const notifData = {
    sectionKey,
    decision: review.decision,
    propertyCode: property.propertyCode,
    source: property.source,
  };

  if (property.source === 'self' && property.ownerId) {
    notifyUser({
      role: 'owner',
      userId: property.ownerId,
      type: notifType,
      title: notifTitle,
      body: notifBody,
      propertyId: property.id,
      data: notifData,
    });
  } else if (property.auditorId) {
    notifyUser({
      role: 'auditor',
      userId: property.auditorId,
      type: notifType,
      title: notifTitle,
      body: notifBody,
      propertyId: property.id,
      data: notifData,
    });
  }

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

// --- Phase 3 approve (semi-approved; awaits Phase 4 deep-dive) ---------
//
// What used to be the "Final approve" step is now Phase 3 approve only.
// It just locks in Phase 3 — no contract PDF is generated here. The
// auditor must complete Phase 4 deep-dive before the officer's final
// approval (which actually triggers the contract). This means the
// `approved` status is conceptually "semi-approved".

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

  emitToProperty(property.id, 'property:status', {
    propertyId: property.id,
    status: property.status,
  });

  // Owner does the auditor's job on self-onboarded properties, so they
  // need this same "Phase 3 approved, go do Phase 4" ping.
  if (property.source === 'self' && property.ownerId) {
    notifyUser({
      role: 'owner',
      userId: property.ownerId,
      type: 'property_approved',
      title: `Phase 3 approved: ${property.propertyCode || property.name}`,
      body: 'Complete Phase 4 deep-dive to unlock the contract.',
      propertyId: property.id,
      data: { propertyCode: property.propertyCode, source: property.source },
    });
  } else if (property.auditorId) {
    notifyUser({
      role: 'auditor',
      userId: property.auditorId,
      type: 'property_approved',
      title: `Phase 3 approved: ${property.propertyCode || property.name}`,
      body: 'Complete Phase 4 deep-dive to unlock the contract.',
      propertyId: property.id,
      data: { propertyCode: property.propertyCode, source: property.source },
    });
  }

  return ok(
    res,
    { property },
    'Phase 3 approved — waiting on auditor to complete Phase 4 deep-dive',
  );
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
  if (property.source === 'self' && property.ownerId) {
    notifyUser({
      role: 'owner',
      userId: property.ownerId,
      type: 'property_rejected',
      title: `Property rejected: ${property.propertyCode || property.name}`,
      body: property.rejectedReason,
      propertyId: property.id,
      data: { propertyCode: property.propertyCode, source: property.source },
    });
  } else if (property.auditorId) {
    notifyUser({
      role: 'auditor',
      userId: property.auditorId,
      type: 'property_rejected',
      title: `Property rejected: ${property.propertyCode || property.name}`,
      body: property.rejectedReason,
      propertyId: property.id,
      data: { propertyCode: property.propertyCode, source: property.source },
    });
  }
  return ok(res, { property }, 'Property rejected');
});

// --- Contracts dashboard (officer side) --------------------------------
//
// Reads every contract this officer has touched, split into three buckets:
//   - sent     : contract delivered to owner, awaiting their signed copy
//   - received : owner uploaded a signed copy, awaiting listing finalization
//   - listed   : property fully completed and live
//
// Each row carries property + contract data so the UI can show the PDF
// preview link, send dates, and the owner-side signed copy.
const listContracts = asyncHandler(async (req, res) => {
  const officerId = req.pwaUser.id;
  const items = await Property.findAll({
    where: {
      assignedOfficerId: officerId,
      status: [
        PROPERTY_STATUS.FINAL_APPROVED,
        PROPERTY_STATUS.CONTRACT_SENT,
        PROPERTY_STATUS.CONTRACT_SIGNED,
        PROPERTY_STATUS.COMPLETED,
      ],
    },
    include: [
      { model: Contract, as: 'contract', required: true },
      { model: Auditor, as: 'auditor', attributes: ['id', 'name', 'email'] },
    ],
    attributes: [
      'id', 'name', 'propertyCode', 'status', 'address', 'source',
      'ownerName', 'ownerEmail', 'ownerPhone', 'approvedAt', 'finalApprovedAt',
    ],
    order: [
      [{ model: Contract, as: 'contract' }, 'generatedAt', 'DESC'],
    ],
  });
  const buckets = { sent: [], received: [], listed: [] };
  for (const p of items) {
    if (p.status === PROPERTY_STATUS.COMPLETED) buckets.listed.push(p);
    else if (p.contract?.signedPdfUrl) buckets.received.push(p);
    else buckets.sent.push(p);
  }
  return ok(res, { ...buckets, total: items.length });
});

// Proxy the generated contract PDF (officer's own copy) so they can preview
// from inside the dashboard without leaving the app.
const downloadContractPdf = asyncHandler(async (req, res) => {
  const property = await Property.findOne({
    where: { id: req.params.id, ...visibilityFilter(req.pwaUser.id) },
    include: [{ model: Contract, as: 'contract' }],
  });
  if (!property?.contract?.generatedPdfUrl) {
    return fail(res, 'Contract PDF not ready', 404);
  }
  const http = require('http');
  const https = require('https');
  const fetchRemote = (url) =>
    new Promise((resolve, reject) => {
      const client = url.startsWith('https:') ? https : http;
      client.get(url, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          fetchRemote(r.headers.location).then(resolve).catch(reject);
          return;
        }
        if (r.statusCode !== 200) { r.resume(); return reject(new Error(`status ${r.statusCode}`)); }
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: r.headers['content-type'] }));
      }).on('error', reject);
    });
  try {
    const { buffer, contentType } = await fetchRemote(property.contract.generatedPdfUrl);
    res.setHeader('Content-Type', contentType || 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="contract-${property.propertyCode || property.id}.pdf"`,
    );
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (err) {
    return fail(res, `Could not stream PDF — ${err.message}`, 500);
  }
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
  listContracts,
  downloadContractPdf,
};
