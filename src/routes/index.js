const router = require('express').Router();

router.use('/auth', require('./auth.routes'));
router.use('/heroes', require('./hero.routes'));
router.use('/header-links', require('./headerLink.routes'));
router.use('/theme', require('./theme.routes'));
router.use('/cities', require('./city.routes'));
router.use('/categories', require('./category.routes'));
router.use('/problems', require('./problem.routes'));
router.use('/activities', require('./activity.routes'));
router.use('/packages', require('./package.routes'));
router.use('/testimonials', require('./testimonial.routes'));
router.use('/blog-categories', require('./blogCategory.routes'));
router.use('/blogs', require('./blog.routes'));

router.get('/health', (req, res) =>
  res.json({ success: true, message: 'API is healthy', timestamp: new Date().toISOString() })
);

module.exports = router;
