const asyncHandler = require('express-async-handler');
const http = require('http');
const https = require('https');
const { Op } = require('sequelize');
const { Property, Contract, Officer, Auditor } = require('../models');
const { ok, fail } = require('../../utils/response');
const { sendContract } = require('../services/mailer');
const { emitToProperty } = require('../services/socket');
const { notifyUser } = require('../services/notifications');
const { generateContractPdf } = require('../services/contractPdf');
const { uploadContractPdf } = require('../services/contractStorage');
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
    include: [
      { model: Contract, as: 'contract' },
      { model: Auditor, as: 'auditor' },
    ],
  });
  if (!property) return fail(res, 'Property not found', 404);

  // Allow a re-send only if the previous attempt never reached the owner.
  // Once the owner has actually received the email (sentAt set), we don't
  // re-send from this endpoint.
  if (property.contract?.sentAt) {
    return fail(res, 'Contract was already sent to the owner', 400);
  }

  // Try to source the PDF from Cloudinary first; on any failure (URL
  // missing, Cloudinary unconfigured, fetch timeout), regenerate it locally
  // so a stuck contract never blocks the auditor from sending.
  let pdfBuffer = null;
  if (property.contract?.generatedPdfUrl) {
    try {
      const { buffer } = await fetchRemoteBuffer(property.contract.generatedPdfUrl);
      pdfBuffer = buffer;
    } catch (err) {
      console.warn('[PWA] could not fetch stored PDF, regenerating:', err.message);
    }
  }
  if (!pdfBuffer) {
    try {
      const officer = property.assignedOfficerId
        ? await Officer.findByPk(property.assignedOfficerId)
        : null;
      pdfBuffer = await generateContractPdf({
        property,
        auditor: property.auditor,
        officerName: officer?.name,
      });
    } catch (err) {
      return fail(res, `Could not regenerate contract PDF — ${err.message}`, 500);
    }
  }
  if (!pdfBuffer) {
    return fail(res, 'No contract PDF available to send', 500);
  }

  // Try to deliver. In dev, a Brevo outage shouldn't stop the auditor from
  // releasing the contract — we mark it sent so the owner login flow
  // becomes available, and surface the email error in the response.
  let emailDelivered = false;
  let emailError = null;
  try {
    await sendContract({
      to: property.ownerEmail,
      ownerName: property.ownerName,
      propertyName: property.name,
      propertyCode: property.propertyCode,
      pdfBuffer,
      pdfFilename: `contract-${property.propertyCode || property.id}.pdf`,
    });
    emailDelivered = true;
  } catch (err) {
    emailError = err.message;
    console.warn('[PWA] contract email send failed:', err.message);
    if (process.env.NODE_ENV === 'production') {
      return fail(res, `Email send failed — ${err.message}`, 500);
    }
    // Fall through in dev — contract still gets marked sent below.
  }

  // Make sure we have a contract row even if the original finalApprove
  // path skipped one (defensive — keeps the rest of the flow consistent).
  let contract = property.contract;
  if (!contract) {
    contract = await Contract.create({ propertyId: property.id });
    property.contract = contract;
  }
  contract.sentAt = new Date();
  contract.releasedByAuditorId = req.pwaUser.id;
  if (!contract.generatedAt) contract.generatedAt = new Date();
  await contract.save();

  // Best-effort: backfill the Cloudinary URL so the auditor's preview works
  // on later visits. Never block the response on this.
  if (!contract.generatedPdfUrl) {
    uploadContractPdf({
      buffer: pdfBuffer,
      filename: `contract-${property.propertyCode || property.id}.pdf`,
    })
      .then(async (url) => {
        if (!url) return;
        contract.generatedPdfUrl = url;
        await contract.save();
      })
      .catch((err) => console.warn('[PWA] background contract upload failed:', err.message));
  }

  property.status = PROPERTY_STATUS.CONTRACT_SENT;
  await property.save();

  emitToProperty(property.id, 'property:status', {
    propertyId: property.id,
    status: property.status,
  });

  // Ping the assigned officer so they see the loop closed; the auditor
  // doesn't need a self-notification (their UI already updates).
  if (property.assignedOfficerId) {
    notifyUser({
      role: 'officer',
      userId: property.assignedOfficerId,
      type: 'contract_sent_to_owner',
      title: `Contract sent to owner: ${property.propertyCode || property.name}`,
      body: `Emailed to ${property.ownerEmail}.`,
      propertyId: property.id,
    });
  }

  return ok(
    res,
    { property, contract: property.contract, emailDelivered, emailError },
    emailDelivered
      ? 'Contract sent to owner'
      : 'Contract marked sent — email service was unreachable, ask the owner to log in directly',
  );
});

module.exports = {
  listForAuditor,
  getOne,
  downloadPdf,
  sendToOwner,
};
