/**
 * src/socket/reframeHandler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Grouped + cached Groq message reframing.
 *
 * THE CORE BOTTLENECK FIX (Bottleneck #1):
 *
 * Naive approach: call Groq once per recipient
 *   50 users in room → 49 Groq calls (sender excluded) × ~150ms each
 *   = 7,350ms of sequential work if done in series
 *   = ~150ms if done in parallel BUT still 49 API calls (rate limits, cost)
 *
 * Optimized approach — two-level reduction:
 *
 *   Level 1 — Group by personality type (O(room size) → O(personality types)):
 *     Users are grouped by socket.typeKey (e.g. "analytical:verbal").
 *     At most 9 unique groups exist (3 response values × 3 medium values).
 *     50 users → at most 9 Groq calls, regardless of room size.
 *
 *   Level 2 — Redis cache (O(personality types) → O(cache misses)):
 *     Check Redis for all typeKeys in ONE pipeline (1 round trip).
 *     Only call Groq for cache misses. On the second occurrence of the same
 *     message pattern: 0 Groq calls.
 *
 *   Level 3 — Parallel execution (sequential latency → single-call latency):
 *     Cache misses are called with Promise.all — all in parallel.
 *     5 misses × 150ms sequential = 750ms.
 *     5 misses × 150ms parallel  = ~150ms (the slowest single call).
 *
 * Net result for a 50-person room, 5 unique personality types, cold cache:
 *   Before: 49 Groq calls
 *   After:  5 Groq calls (one per unique typeKey), all in parallel
 *   Warm cache: 0 Groq calls
 *   Upstash round trips: 2 (1 pipeline for cache check + 1 pipeline for cache write)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import redis          from '../lib/redis.js';
import { reframeMessage } from '../services/groq.js';
import { hashContent }    from '../services/reframeCache.js';

/**
 * reframeAndDeliver(io, message)
 *
 * Groups sockets by personality typeKey, batch-checks Redis cache, calls Groq
 * only for cache misses (in parallel), then delivers a tailored 'new_message'
 * event to each socket with the reframed content for their personality type.
 *
 * @param {import('socket.io').Server} io
 * @param {object} message  The full message object from roomHandler.js
 */
export async function reframeAndDeliver(io, message) {

  // ── Get all sockets currently in this room ────────────────────────────────
  // io.sockets.adapter.rooms is a Map<roomId, Set<socketId>>
  const roomSockets = io.sockets.adapter.rooms.get(message.roomId);
  if (!roomSockets || roomSockets.size === 0) return;

  // ── Step 1: Group sockets by typeKey ──────────────────────────────────────
  // socket.typeKey is attached at connection time from socket.profile.typeKey.
  // No Redis call needed here — the profile is cached on the socket object.
  // This is the key insight: we pay the profile-load cost ONCE at connect,
  // then reuse it for every message during the connection's lifetime.
  //
  // groups shape: { "analytical:verbal": { typeKey, socketIds: ["abc", "def"] }, ... }
  const groups = {};

  for (const socketId of roomSockets) {
    const socket = io.sockets.sockets.get(socketId);

    // Skip if socket not found or if this is the sender (they get raw content)
    if (!socket || socket.userId === message.senderId) continue;

    const typeKey = socket.typeKey;

    // typeKey may be undefined if the socket somehow lacks a profile —
    // fall back to 'unknown' so these users still receive the raw message
    const key = typeKey || 'unknown';
    if (!groups[key]) {
      groups[key] = { typeKey: key, socketIds: [] };
    }
    groups[key].socketIds.push(socketId);
  }

  const typeKeys = Object.keys(groups);

  // Edge case: only the sender is in the room (no recipients to reframe for)
  if (typeKeys.length === 0) {
    // Still deliver to sender
    _deliverToSender(io, message);
    return;
  }

  // ── Step 2: Batch-check Redis cache for ALL typeKeys in ONE pipeline ───────
  // Without pipeline: typeKeys.length × ~20ms = N × 20ms of network overhead.
  // With pipeline: all GET commands sent in a single TCP packet → ~20ms total.
  // This is the same pipeline pattern used in roomHandler.js for presence checks.
  const contentHash = hashContent(message.rawContent);

  const cachePipelineRead = redis.pipeline();
  typeKeys.forEach(tk => {
    cachePipelineRead.get(`reframe:${contentHash}:${tk}`);
  });
  const cacheResults = await cachePipelineRead.exec();

  // ── Step 3: Separate cache hits from misses ────────────────────────────────
  const hits   = {};  // { typeKey: reframedString }
  const misses = [];  // [typeKey, typeKey, ...]

  typeKeys.forEach((tk, i) => {
    // pipeline.exec() returns [[err, value], [err, value], ...]
    const [err, cached] = cacheResults[i];
    if (!err && cached) {
      hits[tk] = cached;   // Cache HIT — no Groq call needed
    } else {
      misses.push(tk);     // Cache MISS — must call Groq
    }
  });

  // ── Step 4: Call Groq for misses — ALL IN PARALLEL (Promise.all) ──────────
  // Why parallel, not sequential?
  //   Sequential: misses.length × ~150ms = up to 9 × 150ms = 1,350ms
  //   Parallel:   max(all call latencies) ≈ ~150ms regardless of miss count
  //
  // Why at most 9 calls even for a 50-person room?
  //   typeKey = "{response}:{medium}" — 3 response values × 3 medium values = 9 max.
  //   Grouping by typeKey reduces from O(room size) to O(personality types).
  const groqResults = await Promise.all(
    misses.map(async (tk) => {
      const reframed = await reframeMessage(message.rawContent, tk);
      return { tk, reframed };
    })
  );

  // ── Step 5: Write Groq results to Redis cache — one pipeline ──────────────
  // We batch-write all new cache entries in a single round trip.
  // TTL: 3600s (1 hour) — messages are ephemeral; no need to keep forever.
  if (groqResults.length > 0) {
    const cachePipelineWrite = redis.pipeline();
    groqResults.forEach(({ tk, reframed }) => {
      cachePipelineWrite.set(`reframe:${contentHash}:${tk}`, reframed, 'EX', 3600);
      hits[tk] = reframed; // Merge into hits map for delivery below
    });
    await cachePipelineWrite.exec();
  }

  // ── Step 6: Deliver to each socket with its personality-tailored version ───
  // Each socket.id receives 'new_message' with the reframed content for its
  // typeKey. io.to(socketId) targets a single socket — no broadcast.
  //
  // Fallback: if hits[typeKey] is somehow missing (unknown typeKey group),
  // deliver the raw message — users see the original rather than nothing.
  for (const [typeKey, group] of Object.entries(groups)) {
    const content = hits[typeKey] ?? message.rawContent;

    for (const socketId of group.socketIds) {
      io.to(socketId).emit('new_message', {
        ...message,
        content,         // ← reframed content for this personality type
        rawContent: message.rawContent, // ← preserve original for display/debug
      });
    }
  }

  // ── Step 7: Deliver raw message to the sender ─────────────────────────────
  // The sender always sees their own unmodified message. Reframing your own
  // words would be confusing and would break the "sent successfully" feedback.
  _deliverToSender(io, message);
}

/**
 * _deliverToSender — internal helper
 * Delivers raw (unmodified) message to the sender's sockets within the room.
 * A user may have multiple tabs open (multiple sockets with same userId).
 *
 * BUG FIX: Previously iterated io.sockets.sockets (ALL connected sockets on the
 * server across ALL rooms). Now iterates only the room's socket set — correct
 * and O(room size) instead of O(total connected users).
 */
function _deliverToSender(io, message) {
  const roomSockets = io.sockets.adapter.rooms.get(message.roomId);
  if (!roomSockets) return;

  for (const socketId of roomSockets) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && socket.userId === message.senderId) {
      socket.emit('new_message', {
        ...message,
        content: message.rawContent, // sender always sees their own original text
      });
    }
  }
}

