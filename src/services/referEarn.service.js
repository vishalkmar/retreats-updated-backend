const crypto = require('crypto');
const { Op } = require('sequelize');
const { User, Coupon, WalletTransaction, Booking, sequelize } = require('../models');

// All amounts in paise so we never lose a rupee to float rounding.
// Tunable via env without touching code.
const intEnv = (key, def) => {
  const n = parseInt(process.env[key], 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
};

const CONFIG = {
  // Referrer's wallet payout when their referee makes the first paid booking.
  referrerWalletPaise: intEnv('REFERRAL_REFERRER_WALLET_PAISE', 50000), // ₹500

  // Welcome coupon for the new user (referee). 10% off, max ₹500.
  newUserCouponPercent: intEnv('REFERRAL_NEW_USER_COUPON_PERCENT', 10),
  newUserCouponCapPaise: intEnv('REFERRAL_NEW_USER_COUPON_CAP_PAISE', 50000),
  newUserCouponExpiryDays: intEnv('REFERRAL_NEW_USER_COUPON_EXPIRY_DAYS', 60),

  // Bonus coupon for the referrer (in addition to wallet credit).
  referrerCouponPercent: intEnv('REFERRAL_REFERRER_COUPON_PERCENT', 15),
  referrerCouponCapPaise: intEnv('REFERRAL_REFERRER_COUPON_CAP_PAISE', 100000),
  referrerCouponExpiryDays: intEnv('REFERRAL_REFERRER_COUPON_EXPIRY_DAYS', 90),
};

// Build a code like WELCOME-A4F8B2. Loops on the very rare collision so we
// never write two coupons with the same code (the column is UNIQUE).
const generateCouponCode = async (prefix = 'CODE') => {
  for (let i = 0; i < 6; i++) {
    const tail = crypto.randomBytes(3).toString('hex').toUpperCase();
    const code = `${prefix}-${tail}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await Coupon.findOne({ where: { code }, attributes: ['id'] });
    if (!exists) return code;
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
};

/**
 * Issue the welcome + referrer coupons the moment a brand-new user completes
 * their profile WITH a referredByUserId set. Idempotent — guards against
 * double-issuance if completeProfile somehow fires twice for the same user.
 *
 * Why both coupons here:
 *   • The referee sees their welcome coupon immediately, so the very first
 *     booking already shows the discount on the preview page.
 *   • The referrer's coupon is the immediate "thanks" so they feel rewarded
 *     even before the wallet payout (which requires a paid booking).
 */
const issueReferralCouponsOnSignup = async ({ refereeUser, referrerUser }) => {
  if (!refereeUser || !referrerUser || refereeUser.id === referrerUser.id) return;

  const now = new Date();
  const refereeExpiry = new Date(now.getTime() + CONFIG.newUserCouponExpiryDays * 24 * 60 * 60 * 1000);
  const referrerExpiry = new Date(now.getTime() + CONFIG.referrerCouponExpiryDays * 24 * 60 * 60 * 1000);

  // De-dupe: if either coupon was already issued for this referee/referrer
  // pair, skip silently. Match by (userId, reason, referenceId=other user id)
  // — we encode the link via the `description` field for traceability.
  const refereeExists = await Coupon.findOne({
    where: { userId: refereeUser.id, reason: 'referral_signup' },
    attributes: ['id'],
  });
  if (!refereeExists) {
    const code = await generateCouponCode('WELCOME');
    await Coupon.create({
      code,
      userId: refereeUser.id,
      kind: 'percent',
      value: CONFIG.newUserCouponPercent,
      maxDiscountPaise: CONFIG.newUserCouponCapPaise,
      minOrderPaise: 0,
      usageLimit: 1,
      timesUsed: 0,
      expiresAt: refereeExpiry,
      reason: 'referral_signup',
      description: `Welcome bonus — joined via ${referrerUser.referralCode || 'a friend'}`,
      isActive: true,
    });
  }

  const referrerExists = await Coupon.findOne({
    where: { userId: referrerUser.id, reason: 'referral_referee', description: { [Op.like]: `%${refereeUser.email}%` } },
    attributes: ['id'],
  });
  if (!referrerExists) {
    const code = await generateCouponCode('THANKS');
    await Coupon.create({
      code,
      userId: referrerUser.id,
      kind: 'percent',
      value: CONFIG.referrerCouponPercent,
      maxDiscountPaise: CONFIG.referrerCouponCapPaise,
      minOrderPaise: 0,
      usageLimit: 1,
      timesUsed: 0,
      expiresAt: referrerExpiry,
      reason: 'referral_referee',
      description: `Thank-you bonus for referring ${refereeUser.email}`,
      isActive: true,
    });
  }
};

/**
 * Pay the referrer their wallet credit when the referee finishes their FIRST
 * paid booking. Called from the Cashfree confirmation path.
 *
 *   - Guard with a referenceType+referenceId lookup so a re-fired webhook
 *     can't credit twice.
 *   - "First paid booking" = no other confirmed/completed booking exists for
 *     this referee. If they had already paid once, we skip silently.
 */
const creditReferrerForFirstPaid = async ({ booking }) => {
  if (!booking || !booking.userId) return null;
  if (booking.status !== 'confirmed' && booking.status !== 'completed') return null;

  const referee = await User.findByPk(booking.userId);
  if (!referee || !referee.referredByUserId) return null;

  // Has this booking already triggered a payout? (Idempotency.)
  const already = await WalletTransaction.findOne({
    where: { type: 'referral_payout', referenceType: 'booking', referenceId: String(booking.id) },
    attributes: ['id'],
  });
  if (already) return null;

  // Was this the FIRST paid booking for this referee? Count any other
  // confirmed/completed booking by this user; if there's one, skip.
  const earlierPaid = await Booking.findOne({
    where: {
      userId: referee.id,
      status: { [Op.in]: ['confirmed', 'completed'] },
      id: { [Op.ne]: booking.id },
    },
    attributes: ['id'],
  });
  if (earlierPaid) return null;

  const referrer = await User.findByPk(referee.referredByUserId);
  if (!referrer || !referrer.isActive) return null;

  const amount = CONFIG.referrerWalletPaise;
  if (amount <= 0) return null;

  // Single atomic credit — update the running balance and write the ledger
  // row in one transaction so the wallet UI never sees a partial state.
  return sequelize.transaction(async (tx) => {
    const fresh = await User.findByPk(referrer.id, { transaction: tx, lock: tx.LOCK.UPDATE });
    const newBalance = (fresh.walletBalancePaise || 0) + amount;
    fresh.walletBalancePaise = newBalance;
    await fresh.save({ transaction: tx });

    await WalletTransaction.create({
      userId: fresh.id,
      amountPaise: amount,
      balanceAfterPaise: newBalance,
      type: 'referral_payout',
      referenceType: 'booking',
      referenceId: String(booking.id),
      description: `Referral bonus — ${referee.email} completed first booking`,
    }, { transaction: tx });

    return { userId: fresh.id, amountPaise: amount, balanceAfterPaise: newBalance };
  });
};

/**
 * Validate a coupon code for a given user + cart and return the discount
 * amount in paise. Returns `{ ok: false, reason }` for any rejection. We
 * deliberately keep error reasons human-friendly so the frontend can show
 * them verbatim.
 *
 *   - Personal coupons (userId != null) only match if userId === user.id.
 *   - Public coupons match for anyone but still respect usageLimit / expiry.
 *   - Discount math returns paise; caller decides where in the pricing
 *     ladder to apply it.
 */
const validateCouponFor = async ({ code, user, subtotalPaise, taxPaise }) => {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return { ok: false, reason: 'Please enter a coupon code' };

  const coupon = await Coupon.findOne({ where: { code: clean } });
  if (!coupon || !coupon.isActive) return { ok: false, reason: 'Coupon not found' };
  if (coupon.userId && coupon.userId !== user.id) return { ok: false, reason: 'This coupon belongs to another account' };
  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) return { ok: false, reason: 'This coupon has expired' };
  if (coupon.usageLimit && coupon.timesUsed >= coupon.usageLimit) return { ok: false, reason: 'This coupon has already been used' };

  const grossPaise = (subtotalPaise || 0) + (taxPaise || 0);
  if (coupon.minOrderPaise && grossPaise < coupon.minOrderPaise) {
    return {
      ok: false,
      reason: `Min order ₹${(coupon.minOrderPaise / 100).toLocaleString()} not met`,
    };
  }

  let discountPaise;
  if (coupon.kind === 'percent') {
    discountPaise = Math.round((grossPaise * coupon.value) / 100);
    if (coupon.maxDiscountPaise) discountPaise = Math.min(discountPaise, coupon.maxDiscountPaise);
  } else {
    discountPaise = coupon.value;
  }
  discountPaise = Math.max(0, Math.min(discountPaise, grossPaise));

  return {
    ok: true,
    coupon,
    discountPaise,
    description: coupon.description,
  };
};

/**
 * Mark a coupon as consumed by a specific booking. Called from booking.create
 * after the coupon has been validated and the discount baked into the row.
 * Bumping timesUsed is best-effort — if the booking later cancels, we restore.
 */
const consumeCoupon = async ({ coupon }) => {
  if (!coupon) return;
  await coupon.increment('timesUsed', { by: 1 });
};

const restoreCoupon = async ({ code }) => {
  if (!code) return;
  const coupon = await Coupon.findOne({ where: { code: String(code).toUpperCase() } });
  if (!coupon) return;
  if (coupon.timesUsed > 0) {
    await coupon.decrement('timesUsed', { by: 1 });
  }
};

/**
 * Debit the user's wallet for a booking and write the ledger row. Called from
 * booking.create the moment the wallet portion is reserved. If the booking
 * later cancels, refundWalletForBooking puts it back.
 */
const debitWalletForBooking = async ({ userId, amountPaise, bookingId }) => {
  if (!amountPaise || amountPaise <= 0) return null;
  return sequelize.transaction(async (tx) => {
    const user = await User.findByPk(userId, { transaction: tx, lock: tx.LOCK.UPDATE });
    if (!user) throw new Error('User not found');
    const balance = user.walletBalancePaise || 0;
    if (balance < amountPaise) throw new Error('Insufficient wallet balance');
    user.walletBalancePaise = balance - amountPaise;
    await user.save({ transaction: tx });
    await WalletTransaction.create({
      userId,
      amountPaise: -amountPaise,
      balanceAfterPaise: user.walletBalancePaise,
      type: 'booking_used',
      referenceType: 'booking',
      referenceId: String(bookingId),
      description: `Applied to booking`,
    }, { transaction: tx });
    return user.walletBalancePaise;
  });
};

const refundWalletForBooking = async ({ userId, amountPaise, bookingId }) => {
  if (!amountPaise || amountPaise <= 0) return null;

  // Idempotency: don't refund twice if the cancel path fires more than once.
  const already = await WalletTransaction.findOne({
    where: { userId, type: 'booking_refund', referenceType: 'booking', referenceId: String(bookingId) },
    attributes: ['id'],
  });
  if (already) return null;

  return sequelize.transaction(async (tx) => {
    const user = await User.findByPk(userId, { transaction: tx, lock: tx.LOCK.UPDATE });
    if (!user) return null;
    user.walletBalancePaise = (user.walletBalancePaise || 0) + amountPaise;
    await user.save({ transaction: tx });
    await WalletTransaction.create({
      userId,
      amountPaise,
      balanceAfterPaise: user.walletBalancePaise,
      type: 'booking_refund',
      referenceType: 'booking',
      referenceId: String(bookingId),
      description: 'Refund — booking cancelled',
    }, { transaction: tx });
    return user.walletBalancePaise;
  });
};

module.exports = {
  CONFIG,
  issueReferralCouponsOnSignup,
  creditReferrerForFirstPaid,
  validateCouponFor,
  consumeCoupon,
  restoreCoupon,
  debitWalletForBooking,
  refundWalletForBooking,
  generateCouponCode,
};
