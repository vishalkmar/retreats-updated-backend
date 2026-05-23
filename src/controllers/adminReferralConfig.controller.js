const asyncHandler = require('express-async-handler');
const { ReferralConfig, WalletTransaction, User, Booking } = require('../models');
const { ok, fail } = require('../utils/response');
const { fromPaise } = require('../services/booking.service');
const { getDefaultConfig } = require('../services/referEarn.service');

// Single-row config — we always operate on id=1. First read creates it from
// the service's hard-coded defaults so the admin UI never sees a missing row.
const ensureRow = async () => {
  let row = await ReferralConfig.findByPk(1);
  if (!row) {
    const def = getDefaultConfig();
    row = await ReferralConfig.create({
      id: 1,
      baseAmountPaise: def.baseAmountPaise,
      tiers: def.tiers,
      enabled: def.enabled,
    });
  }
  return row;
};

const publicConfig = (row) => ({
  id: row.id,
  enabled: !!row.enabled,
  baseAmount: fromPaise(row.baseAmountPaise || 0),
  baseAmountPaise: row.baseAmountPaise || 0,
  tiers: (row.tiers || []).map((t) => ({
    atCount: t.atCount,
    withinDays: t.withinDays,
    totalPayout: fromPaise(t.totalPayoutPaise || 0),
    totalPayoutPaise: t.totalPayoutPaise || 0,
    label: t.label || `${t.atCount} referrals within ${t.withinDays} days`,
  })),
  description: row.description,
  updatedAt: row.updatedAt,
});

// GET /api/admin/referral-config
const get = asyncHandler(async (req, res) => {
  const row = await ensureRow();

  // Lifetime referral payout stats — useful sanity-check banner on the admin
  // UI ("we have paid out ₹X across Y referrals to date"). Cheap aggregate.
  const stats = await WalletTransaction.findOne({
    where: { type: 'referral_payout' },
    attributes: [
      [WalletTransaction.sequelize.fn('COUNT', WalletTransaction.sequelize.col('id')), 'count'],
      [WalletTransaction.sequelize.fn('SUM', WalletTransaction.sequelize.col('amountPaise')), 'totalPaise'],
    ],
    raw: true,
  });

  return ok(res, {
    config: publicConfig(row),
    defaults: {
      ...getDefaultConfig(),
      baseAmount: fromPaise(getDefaultConfig().baseAmountPaise),
    },
    stats: {
      totalPayouts: Number(stats?.count || 0),
      totalAmount: fromPaise(Number(stats?.totalPaise || 0)),
    },
  });
});

// PUT /api/admin/referral-config { enabled, baseAmount, tiers[], description }
// `baseAmount` and tier amounts arrive as rupees (decimal) — we convert to
// paise for storage so the math stays integer-only at runtime.
const update = asyncHandler(async (req, res) => {
  const row = await ensureRow();

  const body = req.body || {};

  if (typeof body.enabled === 'boolean') row.enabled = body.enabled;

  if (body.baseAmount !== undefined) {
    const rupees = Number(body.baseAmount);
    if (!Number.isFinite(rupees) || rupees < 0) {
      return fail(res, 'baseAmount must be a non-negative number (₹)', 400);
    }
    row.baseAmountPaise = Math.round(rupees * 100);
  }

  if (Array.isArray(body.tiers)) {
    const cleaned = [];
    for (const t of body.tiers) {
      if (!t || typeof t !== 'object') continue;
      const atCount = parseInt(t.atCount, 10);
      const withinDays = parseInt(t.withinDays, 10);
      const totalPayout = Number(t.totalPayout);
      if (!Number.isFinite(atCount) || atCount < 1) continue;
      if (!Number.isFinite(withinDays) || withinDays < 0) continue;
      if (!Number.isFinite(totalPayout) || totalPayout < 0) continue;
      cleaned.push({
        atCount,
        withinDays,
        totalPayoutPaise: Math.round(totalPayout * 100),
        label: String(t.label || `${atCount} referrals within ${withinDays} days`).slice(0, 120),
      });
    }
    // Reject obvious mistakes early — same atCount twice would silently
    // collide on first-match wins.
    const seen = new Set();
    for (const t of cleaned) {
      const key = `${t.atCount}:${t.withinDays}`;
      if (seen.has(key)) {
        return fail(res, `Duplicate tier with atCount=${t.atCount} and withinDays=${t.withinDays}`, 400);
      }
      seen.add(key);
    }
    row.tiers = cleaned;
  }

  if (body.description !== undefined) {
    row.description = String(body.description || '').slice(0, 500);
  }

  await row.save();
  return ok(res, { config: publicConfig(row) }, 'Referral config updated');
});

// POST /api/admin/referral-config/reset — restore the hard-coded defaults
// so an admin can recover from an experimental edit gone wrong.
const reset = asyncHandler(async (req, res) => {
  const def = getDefaultConfig();
  const [row] = await ReferralConfig.upsert({
    id: 1,
    baseAmountPaise: def.baseAmountPaise,
    tiers: def.tiers,
    enabled: def.enabled,
    description: 'Earn ₹300 each time a friend makes their first booking. Refer 3 friends within 10 days and earn ₹1,200 instead of ₹900.',
  });
  return ok(res, { config: publicConfig(row) }, 'Referral config reset to defaults');
});

module.exports = { get, update, reset };
