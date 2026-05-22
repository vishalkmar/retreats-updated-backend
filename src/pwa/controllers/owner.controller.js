const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');
const {
  Property,
  PropertyField,
  Contract,
  Auditor,
  Officer,
  AvailabilityLead,
  Salesperson,
} = require('../models');
const { Package } = require('../../models');
const { ok, fail } = require('../../utils/response');
const { getUploadedUrl } = require('../../utils/uploads');
const { emitToProperty } = require('../services/socket');
const { sendSignedContractNotification } = require('../services/mailer');
const { PROPERTY_STATUS } = require('../constants');

// Owners are only allowed to see the properties registered against their
// email address — and only AFTER the auditor has released the contract
// (contract.sentAt is set). Until then the contract is still "with the
// auditor" and the owner shouldn't see it in their dashboard.

const visiblePropertiesWhere = (req) => ({
  ownerEmail: req.pwaUser.email,
  status: [
    PROPERTY_STATUS.CONTRACT_SENT,
    PROPERTY_STATUS.CONTRACT_SIGNED,
    PROPERTY_STATUS.COMPLETED,
  ],
});

// Adds a JOIN guard so a property still in 'approved' status (contract
// generated but not yet released by the auditor) doesn't leak out. We use
// `required: true` + `where: { sentAt IS NOT NULL }` on the Contract join.
const releasedContractInclude = () => ({
  model: Contract,
  as: 'contract',
  required: true,
  where: { sentAt: { [Op.ne]: null } },
});

const listMyProperties = asyncHandler(async (req, res) => {
  const items = await Property.findAll({
    where: visiblePropertiesWhere(req),
    include: [
      { model: Auditor, as: 'auditor', attributes: ['id', 'name', 'email', 'phone', 'profilePhotoUrl'] },
      releasedContractInclude(),
    ],
    order: [['updatedAt', 'DESC']],
  });
  return ok(res, { items });
});

const getOneByCode = asyncHandler(async (req, res) => {
  const property = await Property.findOne({
    where: { propertyCode: req.params.code, ...visiblePropertiesWhere(req) },
    include: [
      { model: PropertyField, as: 'fields' },
      { model: Auditor, as: 'auditor', attributes: ['id', 'name', 'email', 'phone', 'profilePhotoUrl'] },
      releasedContractInclude(),
    ],
  });
  if (!property) return fail(res, 'Property not found or not yet ready', 404);
  return ok(res, { property });
});

const uploadSignedContract = asyncHandler(async (req, res) => {
  const property = await Property.findOne({
    where: { propertyCode: req.params.code, ...visiblePropertiesWhere(req) },
    include: [
      { model: Auditor, as: 'auditor', attributes: ['id', 'name', 'email', 'phone', 'profilePhotoUrl'] },
      { model: Officer, as: 'officer', attributes: ['id', 'name', 'email', 'phone', 'profilePhotoUrl'] },
    ],
  });
  if (!property) return fail(res, 'Property not found or not yet ready', 404);
  if (!req.file) return fail(res, 'Upload a signed PDF or image', 400);

  let contract = await Contract.findOne({ where: { propertyId: property.id } });
  if (!contract) {
    contract = await Contract.create({ propertyId: property.id });
  }
  contract.signedPdfUrl = getUploadedUrl(req.file);
  contract.signedOriginalName = req.file.originalname || null;
  contract.signedMimeType = req.file.mimetype || null;
  contract.signedAt = new Date();
  contract.ownerSignedByEmail = req.pwaUser.email;
  await contract.save();

  property.status = PROPERTY_STATUS.CONTRACT_SIGNED;
  await property.save();

  try {
    await sendSignedContractNotification({
      to: process.env.SIGNED_CONTRACT_NOTIFY_EMAIL || 'vk722413@gmail.com',
      ownerEmail: property.ownerEmail,
      ownerName: property.ownerName,
      propertyName: property.name,
      propertyCode: property.propertyCode,
      signedUrl: contract.signedPdfUrl,
      auditor: property.auditor,
      officer: property.officer,
    });
  } catch (err) {
    console.warn('[PWA] signed contract notification failed:', err.message);
  }

  emitToProperty(property.id, 'property:status', {
    propertyId: property.id,
    status: property.status,
    contract,
  });

  return ok(res, { contract, property }, 'Signed contract uploaded');
});

// -- Availability lead endpoints (Check-Availability flow) ---------------

const leadInclude = () => [
  { model: Package, as: 'package', attributes: ['id', 'name', 'slug', 'primaryImage', 'priceFrom', 'currency', 'durationDays', 'durationNights'] },
  { model: Salesperson, as: 'salesperson', attributes: ['id', 'name', 'email', 'phone', 'profilePhotoUrl'] },
];

const listMyLeads = asyncHandler(async (req, res) => {
  const items = await AvailabilityLead.findAll({
    where: { ownerId: req.pwaUser.id },
    include: leadInclude(),
    order: [['createdAt', 'DESC']],
  });
  return ok(res, { items });
});

const respondToLead = asyncHandler(async (req, res) => {
  const { decision, note } = req.body;
  if (!['yes', 'no'].includes(decision)) return fail(res, 'decision must be yes or no', 400);

  const lead = await AvailabilityLead.findOne({
    where: { id: req.params.leadId, ownerId: req.pwaUser.id },
  });
  if (!lead) return fail(res, 'Lead not found', 404);
  if (lead.status !== 'pending') {
    return fail(res, `Lead already responded to (${lead.status})`, 400);
  }

  lead.status = decision === 'yes' ? 'owner_yes' : 'owner_no';
  lead.ownerRespondedAt = new Date();
  lead.ownerNote = note?.trim() || null;
  await lead.save();

  const fresh = await AvailabilityLead.findByPk(lead.id, { include: leadInclude() });
  return ok(res, { lead: fresh }, `Marked as ${decision === 'yes' ? 'available' : 'not available'}`);
});

module.exports = {
  listMyProperties,
  getOneByCode,
  uploadSignedContract,
  listMyLeads,
  respondToLead,
};
