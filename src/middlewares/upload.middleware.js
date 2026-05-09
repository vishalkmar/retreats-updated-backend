const multer = require('multer');
const path = require('path');
const { cloudinary, ROOT_FOLDER, isConfigured } = require('../config/cloudinary');

const MAX_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10);

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp|svg|mp4|webm|mov|avi/;
  const ok = allowed.test(path.extname(file.originalname).toLowerCase()) ||
             allowed.test(file.mimetype);
  if (ok) cb(null, true);
  else cb(new Error('Only image and video files are allowed'));
};

// Memory storage — files held in RAM until streamed to Cloudinary
const storage = multer.memoryStorage();

const baseMulter = multer({
  storage,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
  fileFilter,
});

/**
 * Upload a single buffer to Cloudinary, returning the secure URL.
 */
const streamUploadBuffer = (buffer, { folder, resourceType, originalName }) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        // Cloudinary auto-derives a unique public_id; we don't pin one
        // so we don't need to worry about collisions.
        use_filename: true,
        unique_filename: true,
        overwrite: false,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    stream.end(buffer);
  });

const guessResourceType = (file) => {
  if (file.mimetype?.startsWith('video/')) return 'video';
  if (/\.(mp4|webm|mov|avi)$/i.test(file.originalname)) return 'video';
  return 'image';
};

/**
 * After multer parses files into memory, push each one to Cloudinary
 * and attach the secure URL to file.path so downstream code can read
 * a uniform `file.path` regardless of storage backend.
 */
const cloudinaryStreamUploader = (subfolder) => async (req, res, next) => {
  try {
    const folder = `${ROOT_FOLDER}/${subfolder}`;

    const uploadOne = async (file) => {
      if (!file?.buffer) return;
      const resourceType = guessResourceType(file);
      const result = await streamUploadBuffer(file.buffer, {
        folder,
        resourceType,
        originalName: file.originalname,
      });
      file.path = result.secure_url;
      file.cloudinaryPublicId = result.public_id;
      file.cloudinaryResourceType = resourceType;
      file.uploadSubfolder = subfolder;
      // Free memory
      file.buffer = null;
    };

    if (req.file) await uploadOne(req.file);

    if (req.files) {
      // req.files can be an array (multer.array) or an object keyed by field name (multer.fields)
      if (Array.isArray(req.files)) {
        for (const f of req.files) await uploadOne(f);
      } else {
        for (const fieldName of Object.keys(req.files)) {
          for (const f of req.files[fieldName]) await uploadOne(f);
        }
      }
    }

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Build an uploader for a specific subfolder. Returns an object whose
 * `single(field)`, `array(field, max)` and `fields(spec)` mirror multer's
 * API but include the Cloudinary upload step.
 */
const buildUploader = (subfolder = 'misc') => {
  if (!isConfigured()) {
    console.warn('[CLOUDINARY] credentials missing — uploads will fail until set in .env');
  }
  const cloudinaryStep = cloudinaryStreamUploader(subfolder);

  return {
    single: (field) => [baseMulter.single(field), cloudinaryStep],
    array: (field, max) => [baseMulter.array(field, max), cloudinaryStep],
    fields: (spec) => [baseMulter.fields(spec), cloudinaryStep],
  };
};

module.exports = { buildUploader };
