const asyncHandler = require('express-async-handler');
const {
  Property,
  PropertyField,
  Contract,
  Auditor,
  Officer,
} = require('../models');
const { ok, fail } = require('../../utils/response');
const { getUploadedUrl } = require('../../utils/uploads');
const { emitToProperty } = require('../services/socket');
const { sendSignedContractNotification } = require('../services/mailer');
const { PROPERTY_STATUS } = require('../constants');

// Owners are only allowed to see the properties registered against their
// email address — and only once those properties are at the contract-sent
// stage or beyond.

const visiblePropertiesWhere = (req) => ({
  ownerEmail: req.pwaUser.email,
  status: [
    PROPERTY_STATUS.APPROVED,
    PROPERTY_STATUS.CONTRACT_SENT,
    PROPERTY_STATUS.CONTRACT_SIGNED,
    PROPERTY_STATUS.COMPLETED,
  ],
});

const listMyProperties = asyncHandler(async (req, res) => {
  const items = await Property.findAll({
    where: visiblePropertiesWhere(req),
    include: [
      { model: Auditor, as: 'auditor', attributes: ['id', 'name', 'email', 'phone', 'profilePhotoUrl'] },
      { model: Contract, as: 'contract' },
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
      { model: Contract, as: 'contract' },
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

module.exports = {
  listMyProperties,
  getOneByCode,
  uploadSignedContract,
};
