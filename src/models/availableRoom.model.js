const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const AvailableRoom = sequelize.define(
  'AvailableRoom',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    hotelId: { type: DataTypes.INTEGER, allowNull: false },

    // Identity
    name: { type: DataTypes.STRING(220), allowNull: false },
    slug: {
      type: DataTypes.STRING(240),
      allowNull: false,
      comment: 'Unique within a hotel — combined with hotelId',
    },

    // Pricing
    price: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    priceOriginal: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    currency: { type: DataTypes.STRING(8), defaultValue: 'INR' },

    // Specs
    roomSize: {
      type: DataTypes.STRING(60),
      allowNull: true,
      comment: 'Display string like "350 sqft" or "32 m²"',
    },
    maxOccupancy: { type: DataTypes.INTEGER, defaultValue: 2 },

    // Media
    mainImage: { type: DataTypes.STRING(500), allowNull: true },

    // Rich-text content
    highlightsRich: { type: DataTypes.TEXT('long'), allowNull: true },
    descriptionRich: { type: DataTypes.TEXT('long'), allowNull: true },

    // Flags
    isFeatured: { type: DataTypes.BOOLEAN, defaultValue: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },

    sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
  },
  {
    tableName: 'available_rooms',
    indexes: [
      { name: 'available_rooms_hotel_slug_unique', unique: true, fields: ['hotelId', 'slug'] },
      { fields: ['hotelId'] },
      { fields: ['isActive'] },
      { fields: ['price'] },
    ],
  }
);

module.exports = AvailableRoom;
