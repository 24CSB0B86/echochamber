/**
 * src/middleware/auth.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Express middleware: validates the Bearer JWT from every protected request.
 *
 * ── BOTTLENECK FIX #4: Redis Token Cache ─────────────────────────────────────
 * Problem:  supabase.getUser(token) is a network call (~50-100ms).
 *           50 concurrent users × every REST request = 50 parallel round trips
 *           to Supabase's auth server on every burst.
 *
 * Fix:      Cache the token → { userId, email } mapping in Redis with a 5-minute TTL.
 *           First request per token: 1 Supabase call → store in Redis.
 *           Every subsequent request within 5 minutes: sub-millisecond Redis GET.
 *           Result: at most 1 Supabase call per 5-minute window per active token.
 *
 * Why is this safe?
 *   JWTs are immutable — the token string itself never changes between issuance and
 *   expiry. If a user logs out, Supabase invalidates the session on its side.
 *   The worst case: a logged-out user's token remains usable for up to 5 minutes
 *   (the cache TTL). For a chat app this is an acceptable trade-off.
 *   For a banking app, you would either: (a) use a shorter TTL, or (b) maintain
 *   a Redis blocklist that revoked tokens are added to at logout.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getUser } from '../auth/supabase.js';
import redis from '../lib/redis.js';

// Cache duration: 5 minutes (300 seconds)
// The JWT itself often expires in 1 hour; our cache always expires before the JWT.
const TOKEN_CACHE_TTL = 300;

/**
 * authMiddleware
 * Reads Authorization: Bearer <token>, validates it, attaches req.user.
 * Returns 401 on missing/invalid token.
 */
export async function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.slice(7); // strip "Bearer "

  try {
    // ── Step 1: Check Redis cache first ───────────────────────────────────────
    // Key format: "auth:{token}"
    // Value stored: "{userId}|{email}" (pipe-separated for simple parsing)
    const cacheKey = `auth:${token}`;
    const cached   = await redis.get(cacheKey);

    if (cached) {
      // Cache HIT → parse and attach user, skip Supabase entirely
      const [id, email] = cached.split('|');
      req.user  = { id, email };
      req.token = token; // attach raw JWT for user-scoped Supabase client
      return next();
    }

    // ── Step 2: Cache MISS → call Supabase (the expensive path) ───────────────
    const { data, error } = await getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { id, email } = data.user;

    // ── Step 3: Populate Redis cache for next 5 minutes ───────────────────────
    // EX sets expiry in seconds. We store a compact pipe-separated string to
    // avoid JSON.parse overhead on every cache hit.
    await redis.set(cacheKey, `${id}|${email}`, 'EX', TOKEN_CACHE_TTL);

    req.user  = { id, email };
    req.token = token; // attach raw JWT for user-scoped Supabase client
    next();

  } catch (err) {
    console.error('[auth middleware] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal auth error' });
  }
}

export default authMiddleware;
