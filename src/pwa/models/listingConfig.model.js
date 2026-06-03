const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

/*
  Per-property website-listing configuration. Created when the central officer
  pushes an onboarded property to the admin ("List on website now"). The admin
  then sets the property TYPE (which website category it lists under), a MARKUP
  (percent/fixed, on the total and/or per-room), and any extra custom fields
  before publishing. On publish we materialise a real website Hotel/Package/
  Event from the PWA data + this config and store the link back here.
*/
const PwaListingConfig = sequelize.define(
  'PwaListingConfig',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    propertyId: { type: DataTypes.INTEGER, allowNull: false },

    // Which website category this property should list under.
    propertyType: {
      type: DataTypes.ENUM('hotel', 'package', 'event', 'custom'),
      allowNull: true,
    },
    // Free-text label when propertyType === 'custom'.
    customType: { type: DataTypes.STRING(120), allowNull: true },
    // Optional taxonomy category id within the chosen type (hotel category,
    // event type, package category…). Interpretation depends on propertyType.
    categoryId: { type: DataTypes.INTEGER, allowNull: true },

    // Markup config:
    //   { mode: 'total'|'per_room', type: 'percent'|'fixed', value: Number,
    //     perRoom: { [roomKey]: { type, value } } }
    markup: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },

    // Admin-added dynamic fields:
    //   [{ id, kind: 'text'|'image', name, value }]  (value = string or URL)
    customFields: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },

    // Lifecycle of the listing config itself.
    listingStatus: {
      type: DataTypes.ENUM('draft', 'listed', 'unlisted'),
      allowNull: false,
      defaultValue: 'draft',
    },

    // Link to the materialised website entity once published.
    linkedType: { type: DataTypes.ENUM('hotel', 'package', 'event'), allowNull: true },
    linkedId: { type: DataTypes.INTEGER, allowNull: true },
    listedAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: 'pwa_listing_configs',
    indexes: [
      { name: 'pwa_listing_configs_property_unique', unique: true, fields: ['propertyId'] },
      { fields: ['listingStatus'] },
    ],
  }
);

module.exports = PwaListingConfig;
