/**
 * src/socket/pubsub.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Redis Pub/Sub subscriber — the core horizontal scaling fix.
 *
 * Why a separate Redis client?
 *   Upstash (and Redis in general) requires separate connections for pub vs
 *   subscribe modes. A subscribed client can ONLY send SUBSCRIBE/UNSUBSCRIBE/PING
 *   commands — it cannot run HGETALL, LPUSH, etc. Creating a dedicated client
 *   for subscribing keeps the main redis client free for all other operations.
 *
 * Channels subscribed (pattern):
 *   "room:*"    — chat messages published by roomHandler.js send_message pipeline
 *   "weather:*" — weather updates published by sentiment.js updateRoomWeather
 *
 * CRITICAL: Why we check instanceId before delivering room messages
 * ─────────────────────────────────────────────────────────────────
 *   roomHandler.js calls pipeline.publish("room:{roomId}", message) AND then
 *   calls reframeAndDeliver(io, message). Because this subscriber runs in the
 *   SAME process, the pmessage event fires during an await inside
 *   reframeAndDeliver — BEFORE per-personality delivery is complete.
 *
 *   Without the instanceId check:
 *     pubsub broadcasts raw message to ALL sockets → frontend deduplicates by ID
 *     → reframed version arrives later but gets dropped (same ID already seen)
 *     Result: everyone sees the raw unframed message. Reframing silently fails.
 *
 *   With the instanceId check:
 *     Same instance  → pubsub SKIPS. reframeAndDeliver already handled delivery.
 *     Other instance → pubsub calls reframeAndDeliver for cross-instance delivery.
 *     Result: every user gets the personality-tailored reframed content. ✓
 *
 * Message flow:
 *   roomHandler.js:  pipeline.publish("room:{roomId}", messageJson)
 *   pubsub.js:       receives → if same instance: skip → else: reframeAndDeliver
 *
 *   sentiment.js:    redis.publish("weather:{roomId}", weatherJson)
 *   pubsub.js:       receives → io.to(roomId).emit('weather_update', weather)
 *                    (weather is NOT per-personality; everyone sees the same state)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Redis from 'ioredis';
import 'dotenv/config';
import { INSTANCE_ID }      from '../lib/instanceId.js';
import { reframeAndDeliver } from './reframeHandler.js';

/**
 * startPubSub(io)
 * Creates a dedicated Redis subscriber client and subscribes to all room
 * and weather channels.
 * Call once from socket/index.js after io is created.
 */
export function startPubSub(io) {
  const subscriber = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null, // subscriber clients should retry forever
    tls: process.env.REDIS_URL?.startsWith('rediss://') ? {} : undefined,
  });

  subscriber.on('error', (err) => {
    console.error('[pubsub] Redis subscriber error:', err.message);
  });

  subscriber.on('connect', () => {
    console.log('[pubsub] Redis subscriber connected');
  });

  // ── Subscribe to room:* AND weather:* patterns ────────────────────────────
  // psubscribe accepts multiple patterns in a single call.
  // "room:*"    → matches "room:{roomId}" (chat messages)
  // "weather:*" → matches "weather:{roomId}" (emotional weather updates)
  subscriber.psubscribe('room:*', 'weather:*', (err, count) => {
    if (err) {
      console.error('[pubsub] psubscribe failed:', err.message);
    } else {
      console.log(`[pubsub] Subscribed to ${count} channel pattern(s): room:*, weather:*`);
    }
  });

  // 'pmessage' fires for ALL pattern subscriptions: (pattern, channel, payload)
  subscriber.on('pmessage', (pattern, channel, payload) => {
    try {
      if (pattern === 'room:*') {
        // ── Chat message ────────────────────────────────────────────────────
        const roomId  = channel.slice('room:'.length);
        const message = JSON.parse(payload);

        // ── instanceId check: the key to making reframing work ─────────────
        // If this message was published by THIS server instance, reframeAndDeliver
        // in roomHandler.js already handled delivery with per-personality content.
        // Delivering again here (raw) would race with reframeAndDeliver and the
        // raw version would win the frontend's dedup-by-ID check.
        //
        // If the message came from a DIFFERENT instance (horizontal scaling), that
        // instance's reframeAndDeliver sent to its own clients but not ours —
        // so WE must call reframeAndDeliver to deliver to our connected clients.
        if (message.instanceId === INSTANCE_ID) {
          // Same instance — reframeAndDeliver already handled it. Skip.
          return;
        }

        // Cross-instance message — run reframing and deliver to our clients.
        // Don't await — pmessage handler should return quickly.
        reframeAndDeliver(io, message).catch(err => {
          console.error('[pubsub] reframeAndDeliver error:', err.message);
        });

      } else if (pattern === 'weather:*') {
        // ── Emotional weather update ────────────────────────────────────────
        // Weather is NOT per-personality — everyone in the room sees the same state.
        // No instanceId check needed: publishing weather is idempotent and lightweight.
        const roomId  = channel.slice('weather:'.length);
        const weather = JSON.parse(payload);

        // Broadcast weather state to all clients in the room.
        io.to(roomId).emit('weather_update', weather);
      }

    } catch (err) {
      console.error('[pubsub] Failed to parse message:', err.message);
    }
  });

  return subscriber;
}
