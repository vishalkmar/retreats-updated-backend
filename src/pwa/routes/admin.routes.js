const router = require('express').Router();
const ctrl = require('../controllers/admin.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { buildUploader } = require('../../middlewares/upload.middleware');

const upload = buildUploader('pwa-profiles');

// All admin PWA routes require an authenticated site admin.
router.use(authenticate);

// Auditors
router.get('/auditors', ctrl.listAuditors);
router.post('/auditors', upload.single('profilePhoto'), ctrl.createAuditor);
router.get('/auditors/:id', ctrl.getAuditor);
router.put('/auditors/:id', upload.single('profilePhoto'), ctrl.updateAuditor);
router.patch('/auditors/:id/toggle', ctrl.toggleAuditor);
router.post('/auditors/:id/reset-password', ctrl.resetAuditorPassword);

// Officers
router.get('/officers', ctrl.listOfficers);
router.post('/officers', upload.single('profilePhoto'), ctrl.createOfficer);
router.get('/officers/:id', ctrl.getOfficer);
router.put('/officers/:id', upload.single('profilePhoto'), ctrl.updateOfficer);
router.patch('/officers/:id/toggle', ctrl.toggleOfficer);
router.post('/officers/:id/reset-password', ctrl.resetOfficerPassword);

// Signed owner contracts
router.get('/signed-properties', ctrl.listSignedProperties);
router.get('/signed-properties/:id/download', ctrl.downloadSignedProperty);

module.exports = router;
