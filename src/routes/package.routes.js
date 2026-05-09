const router = require('express').Router();
const ctrl = require('../controllers/package.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { buildUploader } = require('../middlewares/upload.middleware');

const upload = buildUploader('packages');

const packageUpload = upload.fields([
  { name: 'primaryImage', maxCount: 1 },
  { name: 'hostImage', maxCount: 1 },
  { name: 'gallery', maxCount: 30 },
]);

// Public
router.get('/', ctrl.listPublic);
router.post('/:id/interested', ctrl.markInterested);
router.post('/:id/reviews', ctrl.submitReview);

// Admin
router.get('/admin/all', authenticate, ctrl.listAdmin);
router.put('/admin/reorder', authenticate, ctrl.reorderPackages);
router.get('/admin/reviews', authenticate, ctrl.listReviewsAdmin);
router.get('/admin/:id', authenticate, ctrl.getAdminOne);
router.post('/', authenticate, packageUpload, ctrl.createPackage);
router.put('/:id', authenticate, packageUpload, ctrl.updatePackage);
router.patch('/:id/toggle', authenticate, ctrl.toggle);
router.delete('/:id/gallery/:imageId', authenticate, ctrl.removeGalleryImage);
router.delete('/:id', authenticate, ctrl.removePackage);
router.patch('/reviews/:reviewId/approve', authenticate, ctrl.approveReview);
router.delete('/reviews/:reviewId', authenticate, ctrl.removeReview);

// Public — fetch by slug (must be last to avoid clashing with /admin etc)
router.get('/:slug', ctrl.getBySlug);

module.exports = router;
