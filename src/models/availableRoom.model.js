const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const AvailableRoom = sequelize.define(
  'AvailableRoom',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    // A room is owned by EITHER a hotel OR a package (mutually exclusive).
    // `ownerType` records which; the other FK stays null.
    ownerType: {
      type: DataTypes.ENUM('hotel', 'package'),
      allowNull: false,
      defaultValue: 'hotel',
    },
    hotelId: { type: DataTypes.INTEGER, allowNull: true },
    packageId: { type: DataTypes.INTEGER, allowNull: true },

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
    // Children up to this count stay free (no per-child charge). Used by the
    // booking widget to decide how many children incur no cost.
    maxChildrenFree: { type: DataTypes.INTEGER, defaultValue: 0 },

    // Media
    mainImage: { type: DataTypes.STRING(500), allowNull: true },

    // Rich-text content
    highlightsRich: { type: DataTypes.TEXT('long'), allowNull: true },
    descriptionRich: { type: DataTypes.TEXT('long'), allowNull: true },

    // Cancellation / refund
    isRefundable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    refundPolicyOverride: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Per-item refund tiers — same shape as RefundPolicy.tiers. When null the global policy is used.',
    },

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
      { fields: ['packageId'] },
      { fields: ['isActive'] },
      { fields: ['price'] },
    ],
  }
);

module.exports = AvailableRoom;
