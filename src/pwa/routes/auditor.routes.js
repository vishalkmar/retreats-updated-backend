const router = require('express').Router();
const ctrl = require('../controllers/property.controller');
const { authenticatePwa, requireRoles } = require('../middlewares/pwaAuth.middleware');
const { buildUploader } = require('../../middlewares/upload.middleware');

const upload = buildUploader('pwa-audits');
const sectionUpload = upload.array('photos', 10);

router.use(authenticatePwa, requireRoles('auditor'));

// Phase 1 / 2 / 3 lifecycle
router.post('/properties', ctrl.createPhase1);
router.post('/properties/:id/generate-id', ctrl.generateId);
router.put('/properties/:id/sections/:sectionKey', sectionUpload, ctrl.upsertSection);
router.post('/properties/:id/submit', ctrl.submitForReview);

// Reads
router.get('/properties', ctrl.listMyProperties);
router.get('/properties/:id', ctrl.getMyProperty);

// Messaging
router.get('/properties/:id/messages', ctrl.listMessages);
router.post('/properties/:id/messages', ctrl.postMessage);

module.exports = router;
