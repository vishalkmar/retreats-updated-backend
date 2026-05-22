const https = require('https');
const crypto = require('crypto');

// One single env switch decides everything else. `TEST` and `production` are
// accepted as aliases of `SANDBOX` and `PROD` so accidental misspellings still
// resolve to the right environment instead of silently picking the wrong key.
const resolveMode = () => {
  const raw = String(process.env.CASHFREE_MODE || 'TEST').toUpperCase();
  if (raw === 'PROD' || raw === 'PRODUCTION' || raw === 'LIVE') return 'PROD';
  return 'TEST';
};

const apiBase = () => {
  // Respect a manual override (handy for staging / pinned-version tests) but
  // fall back to Cashfree's documented endpoints for the resolved mode.
  if (process.env.CASHFREE_API_URL) return String(process.env.CASHFREE_API_URL).replace(/\/$/, '');
  return resolveMode() === 'PROD' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
};

const API_VERSION = process.env.CASHFREE_API_VERSION || '2025-01-01';
const APP_ID = () => process.env.CASHFREE_APP_ID || '';
const APP_SECRET = () => process.env.CASHFREE_APP_SECRET || '';

const isConfigured = () => !!(APP_ID() && APP_SECRET());

const cashfreeRequest = ({ method = 'GET', path, body }) =>
  new Promise((resolve, reject) => {
    if (!isConfigured()) {
      reject(new Error('Cashfree not configured. Set CASHFREE_APP_ID and CASHFREE_APP_SECRET in .env'));
      return;
    }

    const url = new URL(`${apiBase()}${path}`);
    const payload = body ? JSON.stringify(body) : null;

    const headers = {
      'x-api-version': API_VERSION,
      'x-client-id': APP_ID(),
      'x-client-secret': APP_SECRET(),
      Accept: 'application/json',
    };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
            return;
          }
          const detail = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
          const err = new Error(`Cashfree ${method} ${path} failed (${res.statusCode}): ${detail}`);
          err.statusCode = res.statusCode;
          err.body = parsed;
          reject(err);
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

/**
 * Create a Cashfree order for a booking. Returns the `payment_session_id`
 * the frontend SDK needs to render the hosted checkout.
 *
 *   - We use the human-readable bookingCode as Cashfree's order_id so support
 *     tickets and webhook payloads tie back to a booking without a join.
 *   - return_url has `{order_id}` as a literal so Cashfree substitutes it at
 *     redirect time. This means /booking-success/RBT-2026-XYZ is the actual
 *     landing URL the browser hits after a successful payment.
 */
const createOrder = async ({
  bookingCode,
  amount,             // rupees (decimal) — Cashfree expects rupees, not paise
  currency = 'INR',
  customer,           // { id, name, email, phone }
  returnUrl,          // browser redirect after payment
  notifyUrl,          // server-to-server webhook
  note,               // optional human-readable note
}) => {
  const body = {
    order_id: bookingCode,
    order_amount: Number(amount),
    order_currency: currency,
    customer_details: {
      customer_id: String(customer.id),
      customer_name: customer.name || 'Guest',
      customer_email: customer.email,
      customer_phone: customer.phone,
    },
    order_meta: {
      return_url: returnUrl,
      ...(notifyUrl ? { notify_url: notifyUrl } : {}),
    },
    ...(note ? { order_note: String(note).slice(0, 100) } : {}),
  };

  const res = await cashfreeRequest({ method: 'POST', path: '/orders', body });
  return {
    orderId: res.order_id,
    paymentSessionId: res.payment_session_id,
    orderStatus: res.order_status,
    cfOrderId: res.cf_order_id,
    raw: res,
  };
};

/**
 * Look up the current status of a Cashfree order. We call this from BOTH the
 * return-URL handler (when the browser comes back) AND the webhook handler,
 * so we have a single canonical "what does Cashfree say?" answer and never
 * trust the browser to tell us a payment succeeded.
 */
const getOrder = async (orderId) =>
  cashfreeRequest({ method: 'GET', path: `/orders/${encodeURIComponent(orderId)}` });

const isPaid = (order) =>
  String(order?.order_status || '').toUpperCase() === 'PAID';

/**
 * Verify a Cashfree webhook signature. The spec (PG v3) is:
 *   signature = base64(HMAC_SHA256(timestamp + rawBody, clientSecret))
 *
 * The caller MUST pass the raw body bytes — once express.json() has parsed it
 * the original byte-for-byte string is gone and the HMAC will never match.
 */
const verifyWebhookSignature = ({ rawBody, signature, timestamp }) => {
  if (!signature || !timestamp || rawBody == null) return false;
  if (!APP_SECRET()) return false;
  const expected = crypto
    .createHmac('sha256', APP_SECRET())
    .update(String(timestamp) + String(rawBody))
    .digest('base64');
  // timingSafeEqual requires equal-length buffers — short-circuit if not.
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
};

module.exports = {
  isConfigured,
  resolveMode,
  apiBase,
  createOrder,
  getOrder,
  isPaid,
  verifyWebhookSignature,
};
