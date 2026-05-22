const asyncHandler = require('express-async-handler');
const http = require('http');
const https = require('https');
const { Op } = require('sequelize');
const { Property, Contract, Officer } = require('../models');
const { ok, fail } = require('../../utils/response');
const { sendContract } = require('../services/mailer');
const { emitToProperty } = require('../services/socket');
const { PROPERTY_STATUS } = require('../constants');

/*
  After the officer approves a property the contract PDF is stored but NOT
  emailed to the owner. The auditor sees the property in their "Incoming
  contracts" tab and presses "Send to owner" — only then does the owner
  receive the contract and become eligible to log in.

  Endpoints:
    GET    /api/pwa/auditor/contracts              list pending + sent contracts
    GET    /api/pwa/auditor/contracts/:propertyId  fetch one
    POST   /api/pwa/auditor/contracts/:propertyId/send-to-owner   release it
*/

const contractInclude = () => [
  { model: Contract, as: 'contract' },
];

// "Incoming" = contract PDF generated but not yet released to the owner.
const listForAuditor = asyncHandler(async (req, res) => {
  const where = {
    auditorId: req.pwaUser.id,
    status: {
      [Op.in]: [
        // Only properties whose Phase 4 has also been accepted — contract
        // is only generated after FINAL_APPROVED.
        PROPERTY_STATUS.FINAL_APPROVED,
        PROPERTY_STATUS.CONTRACT_SENT,
        PROPERTY_STATUS.CONTRACT_SIGNED,
        PROPERTY_STATUS.COMPLETED,
      ],
    },
  };
  const items = await Property.findAll({
    where,
    include: [
      {
        model: Contract,
        as: 'contract',
        required: true,            // only properties that have a contract row
        where: { generatedAt: { [Op.ne]: null } },
      },
    ],
    attributes: ['id', 'name', 'propertyCode', 'status', 'address', 'ownerName', 'ownerEmail', 'ownerPhone', 'approvedAt'],
    order: [
      // Pending (no sentAt) first
      [{ model: Contract, as: 'contract' }, 'sentAt', 'ASC'],
      [{ model: Contract, as: 'contract' }, 'generatedAt', 'DESC'],
    ],
  });

  const pending = items.filter((p) => !p.contract?.sentAt);
  const released = items.filter((p) => p.contract?.sentAt);

  return ok(res, { pending, released, total: items.length });
});

const getOne = asyncHandler(async (req, res) => {
  const property = await Property.findOne({
    where: { id: req.params.propertyId, auditorId: req.pwaUser.id },
    include: contractInclude(),
    attributes: ['id', 'name', 'propertyCode', 'status', 'address', 'ownerName', 'ownerEmail', 'ownerPhone', 'approvedAt'],
  });
  if (!property || !property.contract) return fail(res, 'Contract not found', 404);
  return ok(res, { property, contract: property.contract });
});

// Stream the stored PDF back to the auditor for inline preview. We could
// also just return the secure URL — but doing the proxy avoids exposing the
// raw Cloudinary URL to anyone who can see DOM source.
const fetchRemoteBuffer = (url) =>
  new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    client.get(url, (remote) => {
      if (remote.statusCode >= 300 && remote.statusCode < 400 && remote.headers.location) {
        fetchRemoteBuffer(remote.headers.location).then(resolve).catch(reject);
        return;
      }
      if (remote.statusCode !== 200) {
        remote.resume();
        reject(new Error(`Could not fetch contract PDF (${remote.statusCode})`));
        return;
      }
      const chunks = [];
      remote.on('data', (chunk) => chunks.push(chunk));
      remote.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: remote.headers['content-type'] }));
    }).on('error', reject);
  });

const downloadPdf = asyncHandler(async (req, res) => {
  const property = await Property.findOne({
    where: { id: req.params.propertyId, auditorId: req.pwaUser.id },
    include: contractInclude(),
  });
  if (!property?.contract?.generatedPdfUrl) {
    return fail(res, 'Contract PDF not found', 404);
  }
  const { buffer, contentType } = await fetchRemoteBuffer(property.contract.generatedPdfUrl);
  res.setHeader('Content-Type', contentType || 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="contract-${property.propertyCode || property.id}.pdf"`);
  res.setHeader('Content-Length', buffer.length);
  return res.send(buffer);
});

const sendToOwner = asyncHandler(async (req, res) => {
  const property = await Property.findOne({
    where: { id: req.params.propertyId, auditorId: req.pwaUser.id },
    include: contractInclude(),
  });
  if (!property) return fail(res, 'Property not found', 404);
  if (!property.contract?.generatedPdfUrl) return fail(res, 'No generated contract to send', 400);
  if (property.contract.sentAt) return fail(res, 'Contract was already sent to the owner', 400);

  // Fetch PDF buffer from Cloudinary so we can re-attach it to the email.
  let pdfBuffer = null;
  try {
    const { buffer } = await fetchRemoteBuffer(property.contract.generatedPdfUrl);
    pdfBuffer = buffer;
  } catch (err) {
    return fail(res, `Could not fetch contract PDF — ${err.message}`, 500);
  }

  try {
    await sendContract({
      to: property.ownerEmail,
      ownerName: property.ownerName,
      propertyName: property.name,
      propertyCode: property.propertyCode,
      pdfBuffer,
      pdfFilename: `contract-${property.propertyCode || property.id}.pdf`,
    });
  } catch (err) {
    return fail(res, `Email send failed — ${err.message}`, 500);
  }

  property.contract.sentAt = new Date();
  property.contract.releasedByAuditorId = req.pwaUser.id;
  await property.contract.save();

  property.status = PROPERTY_STATUS.CONTRACT_SENT;
  await property.save();

  emitToProperty(property.id, 'property:status', {
    propertyId: property.id,
    status: property.status,
  });

  return ok(res, { property, contract: property.contract }, 'Contract sent to owner');
});

module.exports = {
  listForAuditor,
  getOne,
  downloadPdf,
  sendToOwner,
};
