/**
 * src/services/sentiment.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Room Emotional Weather — sentiment analysis + weather state computation.
 *
 * BOTTLENECK FIX #6: Non-blocking side effects via setImmediate
 * ─────────────────────────────────────────────────────────────────────────────
 * The problem with synchronous side effects:
 *   If we compute sentiment AND update Redis AND publish weather BEFORE emitting
 *   new_message to clients, every send_message adds those operations to the
 *   critical path. Even at ~5ms, that compounds across many messages.
 *
 * The fix — setImmediate:
 *   setImmediate(fn) schedules fn to run in the NEXT iteration of the Node.js
 *   event loop — AFTER the current operation (message delivery) completes.
 *
 *   Timeline:
 *     [tick N]   reframeAndDeliver(io, message)  ← message reaches clients HERE
 *     [tick N+1] setImmediate callback fires      ← weather computation starts
 *                analyzeMessage() → ~1ms (synchronous, in-memory)
 *                updateRoomWeather() → Redis pipeline + Groq comparison
 *     [~10ms later] Redis/pub-sub completes → 'weather_update' reaches clients
 *
 * Why setImmediate vs setTimeout(fn, 0)?
 *   - setImmediate runs in the "check" phase of the event loop, AFTER I/O callbacks
 *     but BEFORE timers. It's more semantically clear: "run this in the next tick."
 *   - setTimeout(fn, 0) is technically fine here too, but the 0ms delay isn't
 *     guaranteed — the OS timer resolution may add 1-15ms of extra delay.
 *   - Both ensure message delivery happens first. setImmediate is just more explicit
 *     and slightly more predictable in timing.
 *
 * The 'sentiment' npm package:
 *   - Synchronous AFINN-165 word scoring (~1ms, no network call, no async)
 *   - Returns score: -n to +n (we normalize to -5 to +5 range for display)
 *   - No API key, no rate limits, no latency — ideal for hot-path adjacent work
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Sentiment from 'sentiment';
import redis from '../lib/redis.js';

const sentimentAnalyzer = new Sentiment();

// Keep last N messages for weather computation
const WEATHER_WINDOW = 20;

// TTL for the room weather hash — expire if room goes quiet
const WEATHER_TTL = 120; // seconds

/**
 * analyzeMessage(text) → { score: number }
 *
 * Synchronous sentiment scoring using AFINN-165 word list.
 * Each recognized word has a valence score (e.g., "love" = +3, "hate" = -3).
 * The score is the sum of all word scores, normalized by token count.
 *
 * We clamp to -5 to +5 for display consistency.
 * Examples:
 *   "This is great, I love it!" → score ≈ 3
 *   "I'm frustrated and angry"  → score ≈ -3
 *   "The meeting is at 3pm"     → score ≈ 0 (neutral, no scored words)
 *
 * @param {string} text
 * @returns {{ score: number }}  score clamped to [-5, 5]
 */
export function analyzeMessage(text) {
  try {
    const result = sentimentAnalyzer.analyze(text);
    // result.comparative is score normalized by word count (range roughly -5 to +5)
    const clamped = Math.max(-5, Math.min(5, result.comparative));
    return { score: clamped };
  } catch (err) {
    console.error('[sentiment] analyzeMessage error:', err.message);
    return { score: 0 }; // Neutral fallback
  }
}

/**
 * updateRoomWeather(roomId, score, timestamp)
 *
 * Updates Redis with the latest sentiment score, then derives the room's
 * emotional weather state from the rolling window of scores.
 *
 * ⚠️  ALWAYS call this via setImmediate in roomHandler.js:
 *     setImmediate(() => updateRoomWeather(roomId, score, Date.now()))
 *
 *   "setImmediate defers to the next iteration of the event loop —
 *    message is delivered to clients BEFORE weather computation begins."
 *
 * @param {string} roomId
 * @param {number} score      Sentiment score from analyzeMessage (-5 to 5)
 * @param {number} timestamp  Unix timestamp in ms (Date.now())
 */
export async function updateRoomWeather(roomId, score, timestamp) {
  try {
    // ── Step 1: Append score + timestamp to rolling window ─────────────────
    // Use LPUSH + LTRIM to maintain a bounded list of the last 20 scores.
    // LPUSH inserts at the head (newest first). LTRIM trims to keep only [0, N-1].
    // This is the same pattern used in roomHandler.js for message history.
    //
    // We pipeline these 4 writes into ONE round trip.
    const writePipeline = redis.pipeline();
    writePipeline.lpush(`weather:${roomId}`,   String(score));
    writePipeline.ltrim(`weather:${roomId}`,   0, WEATHER_WINDOW - 1);
    writePipeline.lpush(`weatherts:${roomId}`, String(timestamp));
    writePipeline.ltrim(`weatherts:${roomId}`, 0, WEATHER_WINDOW - 1);
    await writePipeline.exec();

    // ── Step 2: Read the rolling window for computation ────────────────────
    // Separate pipeline — reads after writes ensures we see our own writes.
    const readPipeline = redis.pipeline();
    readPipeline.lrange(`weather:${roomId}`,   0, WEATHER_WINDOW - 1);
    readPipeline.lrange(`weatherts:${roomId}`, 0, WEATHER_WINDOW - 1);
    const [[, rawScores], [, rawTimestamps]] = await readPipeline.exec();

    // Parse stored strings back to numbers
    const scores     = (rawScores     || []).map(s  => parseFloat(s));
    const timestamps = (rawTimestamps || []).map(ts => parseInt(ts, 10));

    if (scores.length === 0) return;

    // ── Step 3: Compute weather metrics ───────────────────────────────────
    // avgScore: mean of the rolling window — positive = warm/heated, negative = tense
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    // velocity: number of messages in the last 60 seconds
    // High velocity means rapid conversation (heated or stormy)
    const now      = Date.now();
    const velocity = timestamps.filter(ts => now - ts < 60_000).length;

    // volatility: standard deviation of scores — measures emotional swings
    // Low volatility + positive = consistently warm
    // High volatility = erratic mood (stormy even if avg is positive)
    const mean       = avgScore;
    const variance   = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length;
    const volatility = Math.sqrt(variance);

    // ── Step 4: Determine emotional weather state ──────────────────────────
    // States (in priority order — most extreme checked first):
    //   'stormy'  — highly positive/fast OR deeply negative/erratic
    //   'warm'    — consistently positive, low volatility
    //   'heated'  — positive but emotionally swinging
    //   'tense'   — negative without much volatility
    //   'calm'    — neutral/default
    let state;
    if (avgScore > 4 || velocity > 15) {
      state = 'stormy';   // Overwhelming positivity OR very fast-paced
    } else if (avgScore > 2 && volatility < 1) {
      state = 'warm';     // Consistently good vibes, stable
    } else if (avgScore > 2) {
      state = 'heated';   // Generally positive but moody/volatile
    } else if (avgScore < -2 && volatility > 2) {
      state = 'stormy';   // Negative AND chaotic — true storm
    } else if (avgScore < -2) {
      state = 'tense';    // Negative but steady (uncomfortable silence)
    } else {
      state = 'calm';     // Neutral range — baseline state
    }

    // ── Step 5: Persist computed weather to Redis HASH ─────────────────────
    // HSET stores all weather fields atomically.
    // TTL 120s — if the room goes quiet, weather expires rather than staying stale.
    // The room list / chat header can read HGETALL "roomweather:{roomId}" for display.
    await redis.hset(`roomweather:${roomId}`, {
      state,
      avgScore: String(avgScore.toFixed(2)),
      velocity: String(velocity),
      volatility: String(volatility.toFixed(2)),
    });
    await redis.expire(`roomweather:${roomId}`, WEATHER_TTL);

    // ── Step 6: Publish weather update via Redis pub/sub ───────────────────
    // Channel "weather:{roomId}" — pubsub.js subscribes to "weather:*"
    // and forwards to io.to(roomId).emit('weather_update', payload)
    const weatherPayload = JSON.stringify({ state, avgScore, velocity, volatility });
    await redis.publish(`weather:${roomId}`, weatherPayload);

    console.log(`[weather] Room ${roomId}: ${state} (avg=${avgScore.toFixed(2)}, vel=${velocity}, vol=${volatility.toFixed(2)})`);

  } catch (err) {
    // Never let weather computation crash message delivery
    console.error('[weather] updateRoomWeather error:', err.message);
  }
}
