// PWA model registry + associations. Imported from backend/src/models/index.js
// so that everything lives behind a single `require('../models')` for the
// existing website code while staying isolated by table prefix `pwa_*`.

const Auditor = require('./auditor.model');
const Officer = require('./officer.model');
const PropertyOwner = require('./propertyOwner.model');
const OtpToken = require('./otpToken.model');
const Property = require('./property.model');
const PropertyField = require('./propertyField.model');
const FieldReview = require('./fieldReview.model');
const Message = require('./message.model');
const Contract = require('./contract.model');

// Property <-> Auditor
Property.belongsTo(Auditor, { foreignKey: 'auditorId', as: 'auditor' });
Auditor.hasMany(Property, { foreignKey: 'auditorId', as: 'properties' });

// Property <-> Officer
Property.belongsTo(Officer, { foreignKey: 'assignedOfficerId', as: 'officer' });
Officer.hasMany(Property, { foreignKey: 'assignedOfficerId', as: 'properties' });

// Property <-> Owner
Property.belongsTo(PropertyOwner, { foreignKey: 'ownerId', as: 'owner' });
PropertyOwner.hasMany(Property, { foreignKey: 'ownerId', as: 'properties' });

// Property <-> Fields
Property.hasMany(PropertyField, { foreignKey: 'propertyId', as: 'fields', onDelete: 'CASCADE' });
PropertyField.belongsTo(Property, { foreignKey: 'propertyId', as: 'property' });

// Property <-> Field Reviews
Property.hasMany(FieldReview, { foreignKey: 'propertyId', as: 'reviews', onDelete: 'CASCADE' });
FieldReview.belongsTo(Property, { foreignKey: 'propertyId', as: 'property' });

// Property <-> Messages
Property.hasMany(Message, { foreignKey: 'propertyId', as: 'messages', onDelete: 'CASCADE' });
Message.belongsTo(Property, { foreignKey: 'propertyId', as: 'property' });

// Property <-> Contract (1:1)
Property.hasOne(Contract, { foreignKey: 'propertyId', as: 'contract', onDelete: 'CASCADE' });
Contract.belongsTo(Property, { foreignKey: 'propertyId', as: 'property' });

module.exports = {
  Auditor,
  Officer,
  PropertyOwner,
  OtpToken,
  Property,
  PropertyField,
  FieldReview,
  Message,
  Contract,
};
