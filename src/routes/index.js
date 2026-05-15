const router = require('express').Router();

router.use('/auth', require('./auth.routes'));
router.use('/heroes', require('./hero.routes'));
router.use('/header-links', require('./headerLink.routes'));
router.use('/theme', require('./theme.routes'));
router.use('/cities', require('./city.routes'));
router.use('/locations', require('./location.routes'));
router.use('/facilities', require('./facility.routes'));
router.use('/room-views', require('./roomView.routes'));
router.use('/nearby-places', require('./nearbyPlace.routes'));
router.use('/categories', require('./category.routes'));
router.use('/problems', require('./problem.routes'));
router.use('/activities', require('./activity.routes'));
router.use('/areas', require('./area.routes'));
router.use('/cultures', require('./culture.routes'));
router.use('/packages', require('./package.routes'));
router.use('/hotels', require('./hotel.routes'));
router.use('/rooms', require('./availableRoom.routes'));
router.use('/add-ons', require('./addOnActivity.routes'));
router.use('/event-types', require('./eventType.routes'));
router.use('/events', require('./event.routes'));
router.use('/testimonials', require('./testimonial.routes'));
router.use('/blog-categories', require('./blogCategory.routes'));
router.use('/blogs', require('./blog.routes'));
router.use('/uploads', require('./upload.routes'));
router.use('/site-info', require('./siteInfo.routes'));
router.use('/section-themes', require('./sectionTheme.routes'));

// PWA — mounted at /api/pwa/* so it stays visibly separate from the
// website API. See backend/src/pwa/routes/index.js for sub-routes.
router.use('/pwa', require('../pwa/routes'));

router.get('/health', (req, res) =>
  res.json({ success: true, message: 'API is healthy', timestamp: new Date().toISOString() })
);

module.exports = router;
