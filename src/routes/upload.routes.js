const router = require('express').Router();
const asyncHandler = require('express-async-handler');
const { authenticate } = require('../middlewares/auth.middleware');
const { authenticateUser } = require('../middlewares/userAuth.middleware');
const { buildUploader } = require('../middlewares/upload.middleware');
const { getUploadedUrl } = require('../utils/uploads');
const { ok, fail } = require('../utils/response');

const uploader = buildUploader('inline');
const avatarUploader = buildUploader('user-avatars', {
  allowed: /jpeg|jpg|png|gif|webp/,
  message: 'Only image files are allowed',
});

// POST /api/uploads/inline  (admin) — single image used inline in rich-text
// editors (e.g. custom bullet/marker icons). Returns the public URL.
router.post(
  '/inline',
  authenticate,
  uploader.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return fail(res, 'No file uploaded', 400);
    const url = getUploadedUrl(req.file);
    return ok(res, { url }, 'Uploaded');
  })
);

// POST /api/uploads/user-avatar  (signed-in user) — profile photo upload.
// Returns the public Cloudinary URL the caller can persist on its profile.
router.post(
  '/user-avatar',
  authenticateUser,
  avatarUploader.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return fail(res, 'No file uploaded', 400);
    const url = getUploadedUrl(req.file);
    return ok(res, { url }, 'Uploaded');
  })
);

module.exports = router;
