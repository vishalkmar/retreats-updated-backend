const router = require('express').Router();
const asyncHandler = require('express-async-handler');
const { authenticate } = require('../middlewares/auth.middleware');
const { buildUploader } = require('../middlewares/upload.middleware');
const { getUploadedUrl } = require('../utils/uploads');
const { ok, fail } = require('../utils/response');

const uploader = buildUploader('inline');

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

module.exports = router;
