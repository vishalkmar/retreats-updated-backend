const asyncHandler = require('express-async-handler');
const { Auditor, Officer, PropertyOwner, Property, Salesperson } = require('../models');
const { signToken } = require('../../utils/jwt');
const { ok, fail } = require('../../utils/response');
const { issueOtp, verifyOtp } = require('../services/otp');
const { sendOtp } = require('../services/mailer');

const findUserByRole = async (role, email) => {
  if (role === 'auditor') return Auditor.findOne({ where: { email } });
  if (role === 'officer') return Officer.findOne({ where: { email } });
  if (role === 'salesperson') return Salesperson.findOne({ where: { email } });
  return null;
};

const PASSWORD_LOGIN_ROLES = ['auditor', 'officer', 'salesperson'];

const issuePwaToken = (role, id) =>
  signToken({ pwa: true, role, id });

// -- Auditor / Officer login --------------------------------------------

const login = asyncHandler(async (req, res) => {
  const { role, email, password } = req.body;
  if (!PASSWORD_LOGIN_ROLES.includes(role)) return fail(res, 'Invalid role', 400);
  if (!email || !password) return fail(res, 'Email and password are required', 400);

  const normalized = email.toLowerCase().trim();
  const user = await findUserByRole(role, normalized);
  if (!user || !user.isActive) return fail(res, 'Invalid credentials', 401);

  const matches = await user.comparePassword(password);
  if (!matches) return fail(res, 'Invalid credentials', 401);

  // Auto-issue an OTP if email is not yet verified — UI will redirect to
  // the OTP screen instead of completing login.
  if (!user.emailVerifiedAt) {
    const code = await issueOtp({
      email: normalized,
      target: role,
      purpose: 'signup_verify',
      ipAddress: req.ip,
    });
    try {
      await sendOtp({ to: normalized, code, purpose: 'signup_verify', role });
    } catch (err) {
      console.warn('[PWA] sendOtp failed:', err.message);
      return fail(res, 'Could not send OTP email. Check Brevo email settings.', 500);
    }
    return ok(res, { requiresEmailVerification: true, role, email: normalized }, 'Verify your email to continue');
  }

  user.lastLoginAt = new Date();
  await user.save();
  const token = issuePwaToken(role, user.id);
  return ok(res, { token, role, user: user.toSafeJSON() }, 'Logged in');
});

// Verify the OTP issued during signup_verify or login. On success, returns
// a real session token.
const verifyLoginOtp = asyncHandler(async (req, res) => {
  const { role, email, code } = req.body;
  if (!PASSWORD_LOGIN_ROLES.includes(role)) return fail(res, 'Invalid role', 400);
  if (!email || !code) return fail(res, 'Email and code are required', 400);

  const normalized = email.toLowerCase().trim();
  const result = await verifyOtp({
    email: normalized,
    target: role,
    purpose: 'signup_verify',
    code,
  });
  if (!result.ok) return fail(res, `OTP ${result.reason}`, 400);

  const user = await findUserByRole(role, normalized);
  if (!user || !user.isActive) return fail(res, 'Account not found or inactive', 401);

  user.emailVerifiedAt = new Date();
  user.lastLoginAt = new Date();
  await user.save();
  const token = issuePwaToken(role, user.id);
  return ok(res, { token, role, user: user.toSafeJSON() }, 'Email verified');
});

const resendOtp = asyncHandler(async (req, res) => {
  const { role, email, purpose = 'signup_verify' } = req.body;
  if (!PASSWORD_LOGIN_ROLES.includes(role)) return fail(res, 'Invalid role', 400);
  if (!email) return fail(res, 'Email is required', 400);
  const normalized = email.toLowerCase().trim();
  const user = await findUserByRole(role, normalized);
  if (!user) return fail(res, 'Account not found', 404);

  const code = await issueOtp({ email: normalized, target: role, purpose, ipAddress: req.ip });
  try {
    await sendOtp({ to: normalized, code, purpose, role });
  } catch (err) {
    console.warn('[PWA] resendOtp send failed:', err.message);
    return fail(res, 'Could not send OTP email. Check Brevo email settings.', 500);
  }
  return ok(res, {}, 'OTP sent');
});

// -- Owner login (passwordless via propertyCode + email + OTP) ----------

const ownerRequestOtp = asyncHandler(async (req, res) => {
  const { propertyCode, email } = req.body;
  if (!propertyCode || !email) return fail(res, 'Property ID and email are required', 400);

  const normalized = email.toLowerCase().trim();
  const property = await Property.findOne({ where: { propertyCode } });
  if (!property) return fail(res, 'Invalid Property ID', 404);
  if (property.ownerEmail.toLowerCase().trim() !== normalized) {
    return fail(res, 'This email is not on file for that Property ID', 403);
  }
  // Owner login is only unlocked AFTER the auditor releases the contract —
  // i.e. status moved past `approved`. While the contract sits with the
  // auditor (status === 'approved'), the owner can't sign in yet.
  if (!['contract_sent', 'contract_signed', 'completed'].includes(property.status)) {
    return fail(res, 'Owner access is not yet enabled for this property', 403);
  }

  const code = await issueOtp({
    email: normalized,
    target: 'owner',
    purpose: 'owner_login',
    propertyCode,
    ipAddress: req.ip,
  });
  try {
    await sendOtp({ to: normalized, code, purpose: 'owner_login', role: 'owner' });
  } catch (err) {
    console.warn('[PWA] owner OTP send failed:', err.message);
    return fail(res, 'Could not send OTP email. Try again later.', 500);
  }
  return ok(res, { email: normalized }, 'OTP sent');
});

const ownerVerifyOtp = asyncHandler(async (req, res) => {
  const { propertyCode, email, code } = req.body;
  if (!propertyCode || !email || !code) {
    return fail(res, 'Property ID, email and code are required', 400);
  }
  const normalized = email.toLowerCase().trim();
  const result = await verifyOtp({
    email: normalized,
    target: 'owner',
    purpose: 'owner_login',
    code,
    propertyCode,
  });
  if (!result.ok) return fail(res, `OTP ${result.reason}`, 400);

  // Upsert owner record
  let owner = await PropertyOwner.findOne({ where: { email: normalized } });
  if (!owner) {
    const property = await Property.findOne({ where: { propertyCode } });
    owner = await PropertyOwner.create({
      email: normalized,
      name: property?.ownerName || null,
      phone: property?.ownerPhone || null,
      emailVerifiedAt: new Date(),
      lastLoginAt: new Date(),
    });
    if (property && !property.ownerId) {
      property.ownerId = owner.id;
      await property.save();
    }
  } else {
    owner.emailVerifiedAt = owner.emailVerifiedAt || new Date();
    owner.lastLoginAt = new Date();
    await owner.save();
  }

  const token = issuePwaToken('owner', owner.id);
  return ok(res, { token, role: 'owner', user: owner.toSafeJSON(), propertyCode }, 'Logged in');
});

// -- /me ----------------------------------------------------------------

const me = asyncHandler(async (req, res) => {
  return ok(res, { role: req.pwaRole, user: req.pwaUser.toSafeJSON() });
});

const changePassword = asyncHandler(async (req, res) => {
  if (req.pwaRole === 'owner') return fail(res, 'Owners do not have a password', 400);
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return fail(res, 'Both passwords are required', 400);
  if (newPassword.length < 8) return fail(res, 'New password must be at least 8 characters', 400);

  const matches = await req.pwaUser.comparePassword(currentPassword);
  if (!matches) return fail(res, 'Current password is wrong', 400);

  req.pwaUser.password = newPassword;
  await req.pwaUser.save();
  return ok(res, {}, 'Password updated');
});

module.exports = {
  login,
  verifyLoginOtp,
  resendOtp,
  ownerRequestOtp,
  ownerVerifyOtp,
  me,
  changePassword,
};
