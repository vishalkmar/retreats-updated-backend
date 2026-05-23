const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Single-row table — there is exactly one referral config for the platform.
// We use an `id=1` row and upsert it via the admin UI; the service layer always
// reads from id=1 (with the hard-coded defaults below as a fallback if the row
// hasn't been seeded yet).
//
// `tiers` is a JSON array of bonus rules of the shape:
//   { atCount: 3, withinDays: 10, totalPayoutPaise: 120000, label: "..." }
//
// The service evaluates them in order — the FIRST tier whose conditions hold
// (referral count equals atCount, all those referrals happened within withinDays
// of the first one) wins. If no tier matches, the flat baseAmountPaise applies.
const ReferralConfig = sequelize.define(
  'ReferralConfig',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    // Flat reward paid for every qualifying referral that doesn't trigger a
    // tier bonus. ₹300 by default (30000 paise).
    baseAmountPaise: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30000 },

    // Bonus tiers (see comment above for shape).
    tiers: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [
        { atCount: 3, withinDays: 10, totalPayoutPaise: 120000, label: '3 referrals within 10 days' },
      ],
    },

    // Kill switch — set false to stop ALL referral payouts (useful for hot
    // rollback if a fraud wave hits the system).
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

    // Free-form note shown on the user-side Refer & Earn page.
    description: {
      type: DataTypes.STRING(500),
      allowNull: true,
      defaultValue: 'Earn ₹300 each time a friend makes their first booking. Refer 3 friends within 10 days and earn ₹1,200 instead of ₹900.',
    },
  },
  {
    tableName: 'referral_configs',
  }
);

module.exports = ReferralConfig;
