const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const Contract = sequelize.define(
  'Contract',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    propertyId: { type: DataTypes.INTEGER, allowNull: false },
    generatedPdfUrl: { type: DataTypes.STRING(500), allowNull: true },
    signedPdfUrl: { type: DataTypes.STRING(500), allowNull: true },
    signedOriginalName: { type: DataTypes.STRING(255), allowNull: true },
    signedMimeType: { type: DataTypes.STRING(120), allowNull: true },
    sentAt: { type: DataTypes.DATE, allowNull: true },
    signedAt: { type: DataTypes.DATE, allowNull: true },
    ownerSignedByEmail: { type: DataTypes.STRING(180), allowNull: true },
  },
  {
    tableName: 'pwa_contracts',
    indexes: [
      { name: 'pwa_contracts_property_unique', unique: true, fields: ['propertyId'] },
    ],
  }
);

module.exports = Contract;
