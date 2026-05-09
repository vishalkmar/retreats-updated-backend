const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Package = sequelize.define(
  'Package',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    // Basic
    name: { type: DataTypes.STRING(220), allowNull: false },
    slug: { type: DataTypes.STRING(240), allowNull: false, unique: true },
    shortDescription: { type: DataTypes.STRING(500), allowNull: true },
    description: { type: DataTypes.TEXT('long'), allowNull: true },

    // Media
    primaryImage: { type: DataTypes.STRING(500), allowNull: true },
    videoUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'Optional URL of overview video (YouTube/Vimeo/MP4)',
    },

    // Location
    cityId: { type: DataTypes.INTEGER, allowNull: true },
    locationDetail: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Free text like "Kochi, Kerala, India"',
    },

    // Time
    durationDays: { type: DataTypes.INTEGER, defaultValue: 1 },
    durationNights: { type: DataTypes.INTEGER, defaultValue: 0 },
    timing: {
      type: DataTypes.STRING(160),
      allowNull: true,
      comment: 'e.g. "Available all year round" or "Daily 07:00 - 21:00"',
    },
    availableAllYear: { type: DataTypes.BOOLEAN, defaultValue: true },
    startDate: { type: DataTypes.DATEONLY, allowNull: true },
    endDate: { type: DataTypes.DATEONLY, allowNull: true },

    // Group
    minGroupSize: { type: DataTypes.INTEGER, defaultValue: 1 },
    maxGroupSize: { type: DataTypes.INTEGER, defaultValue: 30 },

    // Pricing
    priceFrom: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    priceOriginal: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      comment: 'Strike-through price for discount display',
    },
    currency: { type: DataTypes.STRING(8), defaultValue: 'INR' },

    // Stats
    rating: { type: DataTypes.DECIMAL(3, 2), defaultValue: 0 },
    reviewCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    interestedCount: { type: DataTypes.INTEGER, defaultValue: 0 },

    // Badges / flags
    freeCancellation: { type: DataTypes.BOOLEAN, defaultValue: true },
    isGoldHost: { type: DataTypes.BOOLEAN, defaultValue: false },
    isFeatured: { type: DataTypes.BOOLEAN, defaultValue: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },

    // Single rich-text block that replaces include/exclude/highlights inputs.
    // Stores HTML produced by the admin rich-text editor.
    richContent: {
      type: DataTypes.TEXT('long'),
      allowNull: true,
      comment: 'HTML content covering highlights / what is and is not included',
    },

    // Food (rich text HTML) + structured meals / diets pickers
    food: {
      type: DataTypes.TEXT('long'),
      allowNull: true,
      comment: 'HTML content describing the food / cuisine',
    },
    meals: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Array of meal types served, e.g. ["Breakfast","Lunch","Dinner"]',
    },
    diets: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Array of diets catered, e.g. ["Vegan","Gluten Free"]',
    },

    // Benefits — rich text HTML
    benefits: {
      type: DataTypes.TEXT('long'),
      allowNull: true,
      comment: 'HTML content describing benefits guests can expect',
    },

    // Facilities offered at the venue
    facilities: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Array of facilities, e.g. ["Free Wifi","Pool","Spa"]',
    },

    // Legacy structured lists — kept for backwards compatibility but no longer
    // surfaced in the admin form (the rich-text editor replaces them).
    highlights: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Legacy: array of highlight strings',
    },
    includes: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Legacy: array of "what is included" strings',
    },
    excludes: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Legacy: array of "what is not included" strings',
    },
    itinerary: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Array of { day, title, description }',
    },
    faqs: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Array of { question, answer }',
    },

    // Host
    hostName: { type: DataTypes.STRING(160), allowNull: true },
    hostBio: { type: DataTypes.TEXT, allowNull: true },
    hostImage: { type: DataTypes.STRING(500), allowNull: true },

    // SEO
    metaTitle: { type: DataTypes.STRING(255), allowNull: true },
    metaDescription: { type: DataTypes.STRING(500), allowNull: true },

    sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
  },
  {
    tableName: 'packages',
    indexes: [
      { fields: ['slug'] },
      { fields: ['cityId'] },
      { fields: ['isActive'] },
      { fields: ['isFeatured'] },
      { fields: ['priceFrom'] },
    ],
  }
);

module.exports = Package;
