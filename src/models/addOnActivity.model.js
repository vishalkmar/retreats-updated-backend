const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const AddOnActivity = sequelize.define(
  'AddOnActivity',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    // Identity
    name: { type: DataTypes.STRING(220), allowNull: false },
    slug: { type: DataTypes.STRING(240), allowNull: false },

    // Location (FK to Location taxonomy)
    locationId: { type: DataTypes.INTEGER, allowNull: true },

    // Pricing
    price: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    priceOriginal: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    currency: { type: DataTypes.STRING(8), defaultValue: 'INR' },

    // Media
    mainImage: { type: DataTypes.STRING(500), allowNull: true },

    // Rich-text content
    descriptionRich: { type: DataTypes.TEXT('long'), allowNull: true },
    highlightsRich: { type: DataTypes.TEXT('long'), allowNull: true },

    // Age limits
    minAge: { type: DataTypes.INTEGER, allowNull: true },
    maxAge: { type: DataTypes.INTEGER, allowNull: true },

    // FAQs — JSON array of { question, answer }
    faqs: { type: DataTypes.JSON, defaultValue: [] },

    // Flags
    isFeatured: { type: DataTypes.BOOLEAN, defaultValue: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },

    sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
  },
  {
    tableName: 'add_on_activities',
    indexes: [
      { name: 'add_on_activities_slug_unique', unique: true, fields: ['slug'] },
      { fields: ['locationId'] },
      { fields: ['isActive'] },
      { fields: ['isFeatured'] },
    ],
  }
);

module.exports = AddOnActivity;
