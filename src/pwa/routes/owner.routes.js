const router = require('express').Router();
const ctrl = require('../controllers/owner.controller');
const { authenticatePwa, requireRoles } = require('../middlewares/pwaAuth.middleware');
const { buildUploader } = require('../../middlewares/upload.middleware');

const upload = buildUploader('pwa-contracts', {
  allowed: /pdf|jpg|jpeg|png|application\/pdf|image\/jpeg|image\/png/,
  message: 'Only PDF, JPG, JPEG, and PNG files are allowed',
});

router.use(authenticatePwa, requireRoles('owner'));

router.get('/properties', ctrl.listMyProperties);
router.get('/properties/:code', ctrl.getOneByCode);
router.post('/properties/:code/sign-upload', upload.single('signed'), ctrl.uploadSignedContract);

module.exports = router;
