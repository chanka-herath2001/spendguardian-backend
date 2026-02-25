require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const apiRoutes = require('./routes/api');

const app  = express();
const PORT = process.env.PORT || 5000;

// ─── CORS ─────────────────────────────────────────────────────────────────────

const allowedOrigins = [
  'http://localhost:5173',
  'https://spendguardian-frontend.vercel.app',   // no trailing slash
  'https://spendguardian.online',
  'https://www.spendguardian.online',
  process.env.FRONTEND_URL,                       // optional custom domain via Railway var
].filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (health checks, Postman, server-to-server)
    if (!origin) return callback(null, true)
    // Allow any Vercel preview deployment URL for this project
    if (allowedOrigins.includes(origin) || origin.includes('spendguardian')) {
      return callback(null, true)
    }
    callback(new Error(`CORS: origin ${origin} not allowed`))
  },
  credentials: true,
}));

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api', apiRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'SpendGuardian API is running 🚀' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✅ SpendGuardian API running on http://localhost:${PORT}`);
});