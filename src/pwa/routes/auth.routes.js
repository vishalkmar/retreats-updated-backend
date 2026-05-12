const router = require('express').Router();
const ctrl = require('../controllers/auth.controller');
const { authenticatePwa } = require('../middlewares/pwaAuth.middleware');

// Auditor / Officer
router.post('/login', ctrl.login);
router.post('/verify-otp', ctrl.verifyLoginOtp);
router.post('/resend-otp', ctrl.resendOtp);

// Owner (passwordless)
router.post('/owner/request-otp', ctrl.ownerRequestOtp);
router.post('/owner/verify-otp', ctrl.ownerVerifyOtp);

// Session
router.get('/me', authenticatePwa, ctrl.me);
router.post('/change-password', authenticatePwa, ctrl.changePassword);

module.exports = router;
