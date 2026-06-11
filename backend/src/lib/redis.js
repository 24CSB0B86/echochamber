/**
 * src/lib/redis.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared ioredis client singleton.
 *
 * Upstash Redis requires TLS (rediss://) for all connections.
 * ioredis handles reconnection automatically — no manual retry logic needed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Redis from 'ioredis';
import 'dotenv/config';

if (!process.env.REDIS_URL) {
  throw new Error(
    '[redis.js] Missing REDIS_URL in .env. ' +
    'Get your connection string from https://console.upstash.com'
  );
}

const redis = new Redis(process.env.REDIS_URL, {
  // ioredis retries 30 times by default — reduce for faster failure in dev
  maxRetriesPerRequest: 3,

  // Upstash requires TLS; ioredis enables it automatically for rediss:// URLs.
  // If you see ECONNREFUSED, check that your REDIS_URL starts with "rediss://"
  tls: process.env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
});

redis.on('error', (err) => {
  // Log but don't crash — the app can degrade gracefully without Redis
  // (auth falls back to Supabase calls, profile reads fall back to Supabase)
  console.error('[Redis] Connection error:', err.message);
});

redis.on('connect', () => {
  console.log('[Redis] Connected to Upstash');
});

export default redis;
