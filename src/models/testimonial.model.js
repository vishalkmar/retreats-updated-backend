const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/*
  Testimonial types:
   - text     : just author quote with optional avatar (stars + content)
   - image    : 1 hero image + author quote (used in image-style cards)
   - gallery  : multiple images (carousel-only, no quote needed)
   - video    : 1 video (with optional poster + author quote)
*/
const TYPES = ['text', 'image', 'gallery', 'video'];

const Testimonial = sequelize.define(
  'Testimonial',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    type: { type: DataTypes.ENUM(...TYPES), allowNull: false, defaultValue: 'text' },

    // Author
    authorName: { type: DataTypes.STRING(120), allowNull: true },
    authorTitle: { type: DataTypes.STRING(160), allowNull: true },
    authorLocation: { type: DataTypes.STRING(160), allowNull: true },
    authorAvatar: { type: DataTypes.STRING(500), allowNull: true },

    // Quote / rating (text + image + video)
    rating: { type: DataTypes.INTEGER, allowNull: true },
    content: { type: DataTypes.TEXT, allowNull: true },

    // Video specific
    videoUrl: { type: DataTypes.STRING(500), allowNull: true },
    videoPoster: { type: DataTypes.STRING(500), allowNull: true },

    // Display
    sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  },
  {
    tableName: 'testimonials',
    indexes: [{ fields: ['type'] }, { fields: ['isActive'] }],
  }
);

Testimonial.TYPES = TYPES;
module.exports = Testimonial;
