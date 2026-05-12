const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { OtpToken } = require('../models');

const OTP_TTL_MIN = parseInt(process.env.PWA_OTP_TTL_MIN || '10', 10);
const OTP_MAX_ATTEMPTS = 5;

const generateCode = () => String(Math.floor(100000 + Math.random() * 900000));

// Issue a fresh OTP for (email, target, purpose). Any unconsumed prior token
// for the same triple is consumed silently so the most recent code wins.
const issueOtp = async ({ email, target, purpose, propertyCode = null, ipAddress = null }) => {
  const normalized = email.toLowerCase().trim();
  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 8);
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);

  await OtpToken.update(
    { consumedAt: new Date() },
    {
      where: {
        email: normalized,
        target,
        purpose,
        consumedAt: null,
      },
    }
  );

  await OtpToken.create({
    email: normalized,
    target,
    purpose,
    propertyCode,
    codeHash,
    expiresAt,
    ipAddress,
  });

  return code;
};

const verifyOtp = async ({ email, target, purpose, code, propertyCode = null }) => {
  const normalized = email.toLowerCase().trim();
  const token = await OtpToken.findOne({
    where: {
      email: normalized,
      target,
      purpose,
      consumedAt: null,
      expiresAt: { [Op.gt]: new Date() },
      ...(propertyCode ? { propertyCode } : {}),
    },
    order: [['createdAt', 'DESC']],
  });

  if (!token) return { ok: false, reason: 'expired' };

  if (token.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts' };
  }

  const matches = await bcrypt.compare(String(code), token.codeHash);
  if (!matches) {
    token.attempts += 1;
    await token.save();
    return { ok: false, reason: 'invalid' };
  }

  token.consumedAt = new Date();
  await token.save();
  return { ok: true };
};

module.exports = { issueOtp, verifyOtp, OTP_TTL_MIN };
