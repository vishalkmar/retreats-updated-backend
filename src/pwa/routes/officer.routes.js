const router = require('express').Router();
const ctrl = require('../controllers/officer.controller');
const propertyCtrl = require('../controllers/property.controller');
const { authenticatePwa, requireRoles } = require('../middlewares/pwaAuth.middleware');

router.use(authenticatePwa, requireRoles('officer'));

router.get('/properties', ctrl.listProperties);
router.get('/properties/:id', ctrl.getProperty);
router.post('/properties/:id/claim', ctrl.claim);
router.patch('/properties/:id/fields/:sectionKey/decision', ctrl.decideField);
router.put('/properties/:id/suggestion', ctrl.updateSuggestion);
router.post('/properties/:id/follow-up', ctrl.followUpProperty);
router.post('/properties/:id/approve', ctrl.approveProperty);
router.post('/properties/:id/reject', ctrl.rejectProperty);

// Messages reuse the shared controller (handler checks officer access).
router.get('/properties/:id/messages', propertyCtrl.listMessages);
router.post('/properties/:id/messages', propertyCtrl.postMessage);

module.exports = router;
