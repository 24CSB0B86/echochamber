/**
 * src/index.js
 * ─────────────────────────────────────────────────────────────────────────────
 * EchoChamber Express + Socket.io server entry point.
 * Wires up: middleware, routes, Socket.io, background jobs, graceful shutdown.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import http    from 'http';
import express from 'express';
import cors    from 'cors';

import onboardingRouter from './routes/onboarding.js';
import profileRouter    from './routes/profile.js';
import roomsRouter      from './routes/rooms.js';
import { initSocket }   from './socket/index.js';
import { startSyncJob } from './jobs/syncRoomCounts.js';

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Global Middleware ─────────────────────────────────────────────────────────

// ── CORS ──────────────────────────────────────────────────────────────────────
// FRONTEND_URL can be a comma-separated list of allowed origins, e.g.:
//   "https://echochamber-gamma.vercel.app,http://localhost:5173"
// This allows both production and local dev without changing code.
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  ...(process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map(u => u.trim())
    : []),
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));


app.use(express.json({ limit: '10kb' })); // parse JSON bodies, reject oversized payloads

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.use('/api/onboarding', onboardingRouter);
app.use('/api/profile',    profileRouter);
app.use('/api/rooms',      roomsRouter);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[Express] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── HTTP server (needed to share with Socket.io) ──────────────────────────────
// Socket.io must attach to the raw http.Server, not express directly.
const server = http.createServer(app);

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = initSocket(server);

// ── Start server ──────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[EchoChamber] Backend running on http://localhost:${PORT}`);
});

// ── Background jobs ───────────────────────────────────────────────────────────
const syncJobId = startSyncJob();

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`[EchoChamber] Received ${signal}, shutting down gracefully...`);
  clearInterval(syncJobId);
  io.close();
  server.close(() => {
    console.log('[EchoChamber] Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

export default app;
