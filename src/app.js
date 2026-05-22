require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

const apiRoutes = require('./routes');
const { notFound, errorHandler } = require('./middlewares/error.middleware');

const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

const parseOrigins = (...values) =>
  values
    .filter(Boolean)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);

const allowedOrigins = parseOrigins(
  process.env.CLIENT_URL,
  process.env.PWA_CLIENT_URL,
  'http://localhost:5173',
  'http://localhost:5174'
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
  })
);
app.options('*', cors({ origin: allowedOrigins, credentials: true }));

// Capture the original request body on `req.rawBody` so the Cashfree webhook
// handler can verify the HMAC against the exact bytes Cashfree signed. The
// extra string copy is cheap relative to a TLS round-trip and we only read
// it inside the webhook controller; every other handler ignores it.
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

const uploadDir = process.env.UPLOAD_DIR || 'uploads';
app.use(`/${uploadDir}`, express.static(path.join(process.cwd(), uploadDir)));

app.get('/', (req, res) =>
  res.json({ success: true, name: 'Retreats by Traveon API', version: '1.0.0' })
);

app.use('/api', apiRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
