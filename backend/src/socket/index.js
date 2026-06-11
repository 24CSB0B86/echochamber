/**
 * src/socket/index.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Initializes Socket.io on the existing Express HTTP server.
 *
 * Auth flow per connection:
 *   1. Read token from socket.handshake.auth.token
 *   2. Check Redis cache "auth:{token}" → userId (same cache as HTTP middleware)
 *   3. On cache miss: call supabase.getUser(token) — the expensive path
 *   4. HGETALL "profile:{userId}" → attach to socket
 *   5. Reject if token invalid or profile missing
 *
 * BOTTLENECK FIX: Profile is stored on socket.profile so roomHandler never
 * needs to fetch it again during the lifetime of the connection.
 * If a user retakes onboarding, the frontend emits 'profile_updated' which
 * triggers a reconnect — the new profile is picked up on reconnection.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Server } from 'socket.io';
import redis      from '../lib/redis.js';
import { getUser } from '../auth/supabase.js';
import { registerRoomHandlers } from './roomHandler.js';
import { startPubSub }          from './pubsub.js';

// Cache TTL must match HTTP auth middleware (300s = 5 min)
const TOKEN_CACHE_TTL = 300;

/**
 * initSocket(httpServer)
 * Call once from src/index.js after creating the HTTP server.
 * Returns the io instance so index.js can pass it to graceful shutdown.
 */
export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true,
    },
  });

  // ── Auth middleware ────────────────────────────────────────────────────────
  // Runs once per connection attempt, before any event handlers.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error('AUTH_MISSING'));
    }

    try {
      // Step 1: Redis cache check (same key format as HTTP auth middleware)
      const cacheKey = `auth:${token}`;
      const cached   = await redis.get(cacheKey);

      let userId;
      if (cached) {
        // Cache HIT — parse userId from "userId|email"
        userId = cached.split('|')[0];
      } else {
        // Cache MISS — call Supabase
        const { data, error } = await getUser(token);
        if (error || !data?.user) {
          return next(new Error('AUTH_INVALID'));
        }
        userId = data.user.id;
        const email = data.user.email;
        // Populate cache for subsequent requests
        await redis.set(cacheKey, `${userId}|${email}`, 'EX', TOKEN_CACHE_TTL);
      }

      // Step 2: Load profile from Redis
      // HGETALL returns {} for missing keys — check for a required field
      const profile = await redis.hgetall(`profile:${userId}`);
      if (!profile || !profile.userId) {
        return next(new Error('PROFILE_NOT_FOUND'));
      }

      // Step 3: Attach to socket — never fetch again during this connection
      socket.userId   = userId;
      socket.token    = token;
      socket.profile  = profile;
      socket.typeKey  = profile.typeKey; // quick access for reframe logic

      next();
    } catch (err) {
      console.error('[socket/auth] Unexpected error:', err.message);
      next(new Error('AUTH_ERROR'));
    }
  });

  // ── Connection handler ─────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    console.log(`[socket] Connected: ${socket.userId} (${socket.profile?.displayName})`);

    // Register all room-related event handlers
    registerRoomHandlers(io, socket);

    // Allow frontend to trigger a reconnect after retaking onboarding
    socket.on('profile_updated', () => {
      console.log(`[socket] Profile updated for ${socket.userId} — disconnecting to refresh`);
      socket.disconnect(true);
    });

    socket.on('disconnect', (reason) => {
      console.log(`[socket] Disconnected: ${socket.userId} — ${reason}`);
    });
  });

  // ── Start pub/sub subscriber ───────────────────────────────────────────────
  startPubSub(io);

  return io;
}
