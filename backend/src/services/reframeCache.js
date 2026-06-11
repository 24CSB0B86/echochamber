/**
 * src/services/reframeCache.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Redis cache layer for Groq reframe results.
 *
 * Cache key design: "reframe:{sha256(rawContent).slice(0,16)}:{typeKey}"
 *
 *   Why sha256 instead of the raw message text?
 *     Redis keys are stored in memory. A 500-char message as a key wastes ~500
 *     bytes PER KEY. sha256 gives a fixed 64-char hex string; we take the first
 *     16 chars (64-bit) — astronomically collision-resistant for a chat app while
 *     keeping keys compact.
 *
 *   Why append typeKey to the hash?
 *     The same message "Nice work!" reframed for "analytical:verbal" sounds
 *     different from "emotional:visual". The typeKey makes the cache entry
 *     personality-specific. Without it, everyone would get the first cached
 *     reframe regardless of their personality.
 *
 * TTL: 3600 seconds (1 hour)
 *   Chat messages are ephemeral — a 1-hour cache is more than enough.
 *   After TTL expires, the next request re-calls Groq and refreshes the cache.
 *   This keeps memory usage bounded without a manual eviction strategy.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash } from 'crypto'; // Node.js built-in — no extra package needed
import redis from '../lib/redis.js';

// 1 hour TTL — chat messages are ephemeral; no need to cache indefinitely
const REFRAME_TTL = 3600;

/**
 * hashContent(text) → 16-char hex string
 * Stable, compact key component derived from message content.
 * sha256 is deterministic — same input always produces same hash.
 *
 * @param {string} text
 * @returns {string}  First 16 hex chars of sha256 hash
 */
export function hashContent(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Build the Redis cache key for a specific (content, typeKey) pair.
 *
 * @param {string} rawContent
 * @param {string} typeKey     e.g. "analytical:verbal"
 * @returns {string}           e.g. "reframe:a3f1b2c4d5e6f7a8:analytical:verbal"
 */
function buildKey(rawContent, typeKey) {
  return `reframe:${hashContent(rawContent)}:${typeKey}`;
}

/**
 * getCached(rawContent, typeKey) → string | null
 *
 * Returns the cached reframed string if it exists in Redis.
 * Returns null on cache miss (Groq must be called).
 *
 * @param {string} rawContent
 * @param {string} typeKey
 * @returns {Promise<string|null>}
 */
export async function getCached(rawContent, typeKey) {
  try {
    const value = await redis.get(buildKey(rawContent, typeKey));
    return value ?? null; // ioredis returns null on miss
  } catch (err) {
    // Redis error — treat as cache miss, let the caller call Groq
    console.error('[reframeCache] getCached error:', err.message);
    return null;
  }
}

/**
 * setCached(rawContent, typeKey, reframed)
 *
 * Stores a reframed string in Redis with a 1-hour TTL.
 * Returns silently on Redis error — caching failure should never break delivery.
 *
 * @param {string} rawContent
 * @param {string} typeKey
 * @param {string} reframed   The Groq-reframed text
 */
export async function setCached(rawContent, typeKey, reframed) {
  try {
    await redis.set(buildKey(rawContent, typeKey), reframed, 'EX', REFRAME_TTL);
  } catch (err) {
    console.error('[reframeCache] setCached error:', err.message);
  }
}
