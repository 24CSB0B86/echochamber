/**
 * src/socket/roomHandler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Registers all room-related Socket.io event handlers.
 *
 * Redis key schema:
 *   "room:{roomId}:members"      — Set of active userIds (presence)
 *   "presence:{roomId}:{userId}" — TTL key: "1" EX 30 (heartbeat-based)
 *   "history:{roomId}"           — List of last 50 messages (LPUSH + LTRIM)
 *   "ratelimit:{userId}"         — Sliding window counter (INCR + EXPIRE)
 *   "msgcount:{roomId}"          — Message count (synced to DB by syncRoomCounts job)
 *   "roomcount:{roomId}"         — Room member count
 *
 * send_message flow (Prompt 3 final shape):
 *   1. Rate limit check           — Redis INCR token bucket
 *   2. Validate + build message   — uses socket.profile (no Redis call)
 *   3. Pipeline                   — LPUSH history, LTRIM, INCR msgcount, PUBLISH
 *   4. Supabase insert            — fire and forget (don't await)
 *   5. reframeAndDeliver()        — await: grouped Groq reframe → socket delivery
 *   6. setImmediate               — weather runs AFTER message delivery, never blocking
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { v4 as uuid }    from 'uuid';
import redis             from '../lib/redis.js';
import { createUserClient } from '../auth/supabase.js';
import { reframeAndDeliver } from './reframeHandler.js';
import { analyzeMessage, updateRoomWeather } from '../services/sentiment.js';
import { INSTANCE_ID } from '../lib/instanceId.js';
import { hashContent } from '../services/reframeCache.js';
import { reframeMessage } from '../services/groq.js';

// Rate limit constants
const RATE_LIMIT_MAX    = 30;  // messages
const RATE_LIMIT_WINDOW = 60;  // seconds

/**
 * registerRoomHandlers(io, socket)
 * Called once per connection from socket/index.js.
 */
export function registerRoomHandlers(io, socket) {

  // ────────────────────────────────────────────────────────────────────────────
  // 'join_room' — client joins a chat room
  // ────────────────────────────────────────────────────────────────────────────
  socket.on('join_room', async ({ roomId } = {}) => {
    if (!roomId) return;

    try {
      // Join the Socket.io room
      await socket.join(roomId);

      // ── Presence: Redis Set + TTL key ────────────────────────────────────────
      // BOTTLENECK FIX: Redis Set instead of KEYS pattern.
      // SADD is O(1). SMEMBERS is O(n members) — only the members we care about.
      // "KEYS room:*:members" would be O(total Redis keys) — an anti-pattern.
      await redis.sadd(`room:${roomId}:members`, socket.userId);
      // TTL key auto-expires if the client disconnects without sending 'leave_room'.
      // Heartbeat ('heartbeat' event) refreshes this every 20s.
      await redis.set(`presence:${roomId}:${socket.userId}`, '1', 'EX', 30);

      // ── Build online users list ──────────────────────────────────────────────
      // Get all member IDs from the Set, then batch-fetch their profiles.
      const memberIds = await redis.smembers(`room:${roomId}:members`);

      // BOTTLENECK FIX: Pipeline batches all HGETALL calls into ONE round trip.
      // Without pipeline: N members × ~20ms = N×20ms of network overhead.
      // With pipeline: all N commands sent in one TCP packet → ~20ms total.
      const pipeline = redis.pipeline();
      memberIds.forEach(id => pipeline.hgetall(`profile:${id}`));
      const profileResults = await pipeline.exec();

      // pipeline.exec() returns [[err, val], [err, val], ...]
      const onlineUsers = profileResults
        .map(([err, profile]) => (!err && profile?.userId ? profile : null))
        .filter(Boolean);

      // ── Message history ──────────────────────────────────────────────────────
      // LRANGE returns newest-first (LPUSH inserts at head). Reverse for display.
      const rawHistory = await redis.lrange(`history:${roomId}`, 0, 49);
      const history    = rawHistory.map(m => JSON.parse(m)).reverse();

      // ── Reframe history for joining user's personality ───────────────────────
      // Bug fix: previously, history messages only contained rawContent.
      // On refresh, reframed versions were lost. Here we check the Redis reframe
      // cache for the joining user's personality typeKey (with Groq fallback on miss),
      // ensuring that page refreshes and room re-entries retain full reframing.
      const userTypeKey = socket.typeKey || socket.profile?.typeKey;
      if (userTypeKey && history.length > 0) {
        try {
          const cachePipeline = redis.pipeline();
          const candidateIndices = [];

          history.forEach((m, idx) => {
            // Reframe only other users' messages (sender always sees their own raw text)
            if (m.senderId !== socket.userId && m.rawContent) {
              const hash = hashContent(m.rawContent);
              cachePipeline.get(`reframe:${hash}:${userTypeKey}`);
              candidateIndices.push(idx);
            }
          });

          if (candidateIndices.length > 0) {
            const cacheResults = await cachePipeline.exec();
            const misses = [];

            cacheResults.forEach(([err, cached], i) => {
              const histIdx = candidateIndices[i];
              if (!err && cached) {
                history[histIdx].content = cached;
              } else {
                misses.push(histIdx);
              }
            });

            // If any cache misses, reframe via Groq in parallel and cache the result
            if (misses.length > 0) {
              const writePipeline = redis.pipeline();
              await Promise.all(
                misses.map(async (histIdx) => {
                  try {
                    const raw = history[histIdx].rawContent;
                    const reframed = await reframeMessage(raw, userTypeKey);
                    if (reframed) {
                      history[histIdx].content = reframed;
                      const hash = hashContent(raw);
                      writePipeline.set(`reframe:${hash}:${userTypeKey}`, reframed, 'EX', 3600);
                    }
                  } catch (e) {
                    console.error('[room/reframe-history] Miss reframe error:', e.message);
                  }
                })
              );
              await writePipeline.exec();
            }
          }
        } catch (reframeErr) {
          console.error('[room/join_room] History reframe error:', reframeErr.message);
        }
      }

      // ── Load current weather for this room ───────────────────────────────────
      // HGETALL "roomweather:{roomId}" — computed by sentiment.js asynchronously.
      // May be null if no messages have been sent yet (or if TTL expired).
      const weather = await redis.hgetall(`roomweather:${roomId}`);

      // ── Emit to the joining client ───────────────────────────────────────────
      socket.emit('room_history',    { roomId, messages: history });
      socket.emit('online_users',    { roomId, users: onlineUsers });
      // Send current weather snapshot on join so client doesn't wait for next message
      if (weather && weather.state) {
        socket.emit('weather_update', {
          state:      weather.state,
          avgScore:   parseFloat(weather.avgScore   || '0'),
          velocity:   parseInt( weather.velocity    || '0', 10),
          volatility: parseFloat(weather.volatility || '0'),
        });
      }

      // ── Notify the rest of the room ──────────────────────────────────────────
      socket.to(roomId).emit('user_joined', {
        roomId,
        userId:  socket.userId,
        profile: socket.profile,  // cached on socket — no Redis call
      });

      // Track room member count for the room list
      await redis.incr(`roomcount:${roomId}`);

      console.log(`[room] ${socket.userId} joined ${roomId} (${onlineUsers.length} online)`);
    } catch (err) {
      console.error(`[room] join_room error (${roomId}):`, err.message);
    }
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 'send_message' — client sends a chat message
  //
  // Final shape after Prompt 3:
  //   1. Rate limit check (Redis token bucket)
  //   2. Validate + build message object (uses socket.profile — no Redis call)
  //   3. Pipeline: LPUSH history, LTRIM, INCR msgcount, PUBLISH → await
  //   4. Supabase insert — fire and forget (don't await)
  //   5. reframeAndDeliver(io, message) — await (delivers to clients)
  //   6. setImmediate → weather runs AFTER delivery, never on critical path
  // ────────────────────────────────────────────────────────────────────────────
  socket.on('send_message', async ({ roomId, content } = {}) => {
    if (!roomId || !content) return;

    try {
      // ── Step 1: Rate limiting — token bucket via Redis INCR ────────────────
      // NOTE: INCR + EXPIRE is not perfectly atomic — a crash between the two
      // could leave a key without a TTL. Use a Lua script in production:
      //   redis.eval("local c=redis.call('INCR',KEYS[1]) if c==1 then redis.call('EXPIRE',KEYS[1],60) end return c", 1, key)
      const rateLimitKey = `ratelimit:${socket.userId}`;
      const count        = await redis.incr(rateLimitKey);
      if (count === 1) {
        // First message in the window — start the 60-second clock
        await redis.expire(rateLimitKey, RATE_LIMIT_WINDOW);
      }
      if (count > RATE_LIMIT_MAX) {
        socket.emit('rate_limited', { message: 'Slow down — max 30 messages per minute' });
        return;
      }

      // ── Step 2: Validate + build message object ────────────────────────────
      const trimmed = content.trim().slice(0, 500);
      if (!trimmed) return;

      const message = {
        id:            uuid(),
        roomId,
        senderId:      socket.userId,
        rawContent:    trimmed,    // ← original text, always preserved
        content:       trimmed,    // ← may be overwritten by reframing per-recipient
        sentAt:        new Date().toISOString(),
        senderProfile: socket.profile, // cached on socket — zero Redis calls
        instanceId:    INSTANCE_ID,   // ← tells pubsub.js to skip delivery on THIS instance
                                       //   (reframeAndDeliver handles it below)
      };

      const messageJson = JSON.stringify(message);

      // ── Step 3: Pipeline — 4 Redis operations in ONE round trip ───────────
      // Without pipeline: 4 commands × ~20ms = ~80ms added to every send.
      // Pipeline batches them into 1 TCP packet → ~20ms total regardless of count.
      //
      // Note: PUBLISH goes into the pipeline too. The pub/sub subscriber (pubsub.js)
      // would normally broadcast via io.to(roomId).emit — but with reframing enabled,
      // reframeAndDeliver handles delivery instead. The PUBLISH is kept for cross-
      // instance message delivery in multi-server deployments (other instances don't
      // have the reframe logic running for their own clients).
      const pipeline = redis.pipeline();
      pipeline.lpush(`history:${roomId}`, messageJson);  // prepend to history list
      pipeline.ltrim(`history:${roomId}`, 0, 49);         // keep only last 50 entries
      pipeline.incr(`msgcount:${roomId}`);                 // counter synced to DB by job
      pipeline.publish(`room:${roomId}`, messageJson);     // pub/sub for multi-instance
      await pipeline.exec();

      // ── Step 4: Supabase insert — fire and forget ──────────────────────────
      // Don't await — Redis + reframe delivery is the live path.
      // If this fails, the message is still delivered to all clients.
      // Redis history is the short-term source of truth; Supabase is durable backup.
      const userClient = createUserClient(socket.token);
      userClient
        .from('messages')
        .insert({
          id:        message.id,
          room_id:   roomId,
          sender_id: socket.userId,
          content:   trimmed,
          sent_at:   message.sentAt,
        })
        .then(({ error }) => {
          if (error) console.error('[room] Supabase insert error:', error.message);
        });

      // ── Step 5: Grouped Groq reframing + delivery ─────────────────────────
      // reframeAndDeliver groups recipients by typeKey (at most 9 groups),
      // checks Redis cache in one pipeline, calls Groq only for cache misses
      // (in parallel via Promise.all), then emits new_message to each socket
      // with the content reframed for their personality type.
      //
      // The sender receives their own raw message (no reframing for yourself).
      //
      // Scaling math:
      //   50-person room, 5 unique personality types:
      //     Before: 49 Groq calls (one per recipient)
      //     After:  5 Groq calls  (one per unique typeKey, all parallel)
      //     Warm cache: 0 Groq calls
      //   Redis round trips: 2 (1 pipeline cache check + 1 pipeline cache write)
      await reframeAndDeliver(io, message);

      // ── Step 6: Emotional weather — NON-BLOCKING via setImmediate ──────────
      // setImmediate defers to the NEXT iteration of the Node.js event loop.
      // This means reframeAndDeliver() fully completes (all clients receive the
      // message) BEFORE sentiment analysis or weather Redis writes begin.
      //
      // Why setImmediate vs setTimeout(fn, 0)?
      //   setImmediate fires in the "check" phase — after I/O callbacks but before
      //   timers. It's more semantically clear: "run this after the current
      //   operation." setTimeout(fn, 0) adds OS timer jitter (1-15ms extra).
      //   Both ensure message delivery happens first; setImmediate is more explicit.
      //
      // Weather arrives ~5-10ms after message delivery as a separate 'weather_update'
      // socket event — clients update the room mood indicator without blocking chat.
      setImmediate(() => {
        const { score } = analyzeMessage(message.rawContent);
        updateRoomWeather(roomId, score, Date.now());
      });

    } catch (err) {
      console.error(`[room] send_message error (${roomId}):`, err.message);
    }
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 'heartbeat' — client sends every 20s to keep presence TTL alive
  // ────────────────────────────────────────────────────────────────────────────
  socket.on('heartbeat', async ({ roomId } = {}) => {
    if (!roomId) return;
    // Refresh the 30-second TTL key. If this stops (client disconnects),
    // the key auto-expires within 30s and the user is effectively "offline".
    await redis.set(`presence:${roomId}:${socket.userId}`, '1', 'EX', 30);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 'leave_room' — explicit leave (e.g. switching rooms)
  // ────────────────────────────────────────────────────────────────────────────
  socket.on('leave_room', async ({ roomId } = {}) => {
    if (!roomId) return;
    await _leaveRoom(io, socket, roomId);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 'disconnect' — clean up all rooms the socket was in
  // ────────────────────────────────────────────────────────────────────────────
  socket.on('disconnect', async () => {
    // socket.rooms is a Set of room IDs the socket was in.
    // We skip the socket's own room (its socket.id) — that's a Socket.io internal.
    const rooms = [...socket.rooms].filter(r => r !== socket.id);
    for (const roomId of rooms) {
      await _leaveRoom(io, socket, roomId);
    }
  });
}

// ── Internal helper ──────────────────────────────────────────────────────────

/**
 * _leaveRoom — shared cleanup for leave_room and disconnect.
 */
async function _leaveRoom(io, socket, roomId) {
  try {
    socket.leave(roomId);
    await redis.srem(`room:${roomId}:members`, socket.userId);
    await redis.del(`presence:${roomId}:${socket.userId}`);
    io.to(roomId).emit('user_left', { roomId, userId: socket.userId });
    console.log(`[room] ${socket.userId} left ${roomId}`);
  } catch (err) {
    console.error(`[room] _leaveRoom error (${roomId}):`, err.message);
  }
}
