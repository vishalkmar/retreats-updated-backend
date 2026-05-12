const { sequelize } = require('../config/database');
const Admin = require('./admin.model');
const Hero = require('./hero.model');
const HeroMedia = require('./heroMedia.model');
const HeaderLink = require('./headerLink.model');
const SiteSetting = require('./siteSetting.model');
const City = require('./city.model');
const Category = require('./category.model');
const Problem = require('./problem.model');
const Activity = require('./activity.model');
const Package = require('./package.model');
const PackageImage = require('./packageImage.model');
const PackageReview = require('./packageReview.model');
const Testimonial = require('./testimonial.model');
const TestimonialMedia = require('./testimonialMedia.model');
const Blog = require('./blog.model');
const BlogCategory = require('./blogCategory.model');
const BlogScene = require('./blogScene.model');

const db = {
  sequelize,
  Admin,
  Hero,
  HeroMedia,
  HeaderLink,
  SiteSetting,
  City,
  Category,
  Problem,
  Activity,
  Package,
  PackageImage,
  PackageReview,
  Testimonial,
  TestimonialMedia,
  Blog,
  BlogCategory,
  BlogScene,
};

// Associations
Hero.hasMany(HeroMedia, { foreignKey: 'heroId', as: 'media', onDelete: 'CASCADE' });
HeroMedia.belongsTo(Hero, { foreignKey: 'heroId', as: 'hero' });

// Package <-> City
Package.belongsTo(City, { foreignKey: 'cityId', as: 'city' });
City.hasMany(Package, { foreignKey: 'cityId', as: 'packages' });

// Package <-> Category (M2M)
Package.belongsToMany(Category, {
  through: 'package_categories',
  foreignKey: 'packageId',
  otherKey: 'categoryId',
  as: 'categories',
  timestamps: false,
});
Category.belongsToMany(Package, {
  through: 'package_categories',
  foreignKey: 'categoryId',
  otherKey: 'packageId',
  as: 'packages',
  timestamps: false,
});

// Package <-> Problem (M2M)
Package.belongsToMany(Problem, {
  through: 'package_problems',
  foreignKey: 'packageId',
  otherKey: 'problemId',
  as: 'problems',
  timestamps: false,
});
Problem.belongsToMany(Package, {
  through: 'package_problems',
  foreignKey: 'problemId',
  otherKey: 'packageId',
  as: 'packages',
  timestamps: false,
});

// Package <-> Activity (M2M)
Package.belongsToMany(Activity, {
  through: 'package_activities',
  foreignKey: 'packageId',
  otherKey: 'activityId',
  as: 'activities',
  timestamps: false,
});
Activity.belongsToMany(Package, {
  through: 'package_activities',
  foreignKey: 'activityId',
  otherKey: 'packageId',
  as: 'packages',
  timestamps: false,
});

// Package <-> PackageImage
Package.hasMany(PackageImage, { foreignKey: 'packageId', as: 'gallery', onDelete: 'CASCADE' });
PackageImage.belongsTo(Package, { foreignKey: 'packageId', as: 'package' });

// Package <-> PackageReview
Package.hasMany(PackageReview, { foreignKey: 'packageId', as: 'reviews', onDelete: 'CASCADE' });
PackageReview.belongsTo(Package, { foreignKey: 'packageId', as: 'package' });

// Testimonial <-> TestimonialMedia
Testimonial.hasMany(TestimonialMedia, { foreignKey: 'testimonialId', as: 'media', onDelete: 'CASCADE' });
TestimonialMedia.belongsTo(Testimonial, { foreignKey: 'testimonialId', as: 'testimonial' });

// Blog <-> BlogCategory
Blog.belongsTo(BlogCategory, { foreignKey: 'blogCategoryId', as: 'category' });
BlogCategory.hasMany(Blog, { foreignKey: 'blogCategoryId', as: 'blogs' });

// Blog <-> BlogScene
Blog.hasMany(BlogScene, { foreignKey: 'blogId', as: 'scenes', onDelete: 'CASCADE' });
BlogScene.belongsTo(Blog, { foreignKey: 'blogId', as: 'blog' });

// PWA models register themselves with sequelize on require. We pull them in
// here so a single `require('./models')` from app/server boots both worlds.
// They live under separate `pwa_*` tables and never join with website tables.
const pwaModels = require('../pwa/models');
Object.assign(db, { pwa: pwaModels });

module.exports = db;
