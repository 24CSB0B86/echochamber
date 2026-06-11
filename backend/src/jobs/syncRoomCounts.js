/**
 * src/jobs/syncRoomCounts.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Background job: syncs Redis room message counts → Supabase every 60 seconds.
 *
 * ── BOTTLENECK FIX #5: Write-Behind Caching ──────────────────────────────────
 * Pattern name: "write-behind caching" (also called "write-behind" or "lazy write").
 *
 * The problem with the naive approach:
 *   UPDATE rooms SET synced_count = synced_count + 1 WHERE id = $roomId
 *   ...under concurrent inserts, Postgres acquires a row-level lock:
 *   Two messages arriving at the same millisecond both try to read → increment → write.
 *   One transaction must wait for the other to release the lock. At high throughput
 *   this creates a lock queue and degrades to serial writes.
 *
 * The fix:
 *   Hot write path (per message): INCR "roomcount:{roomId}" in Redis.
 *   Redis INCR is atomic by design — its single-threaded event loop processes
 *   one command at a time, no locks, no waiting, sub-millisecond.
 *
 *   This job runs every 60 seconds and syncs the accumulated counts to Postgres.
 *   The "synced_count" column in the rooms table may lag by up to 60 seconds,
 *   but this is fine for a room list display (nobody needs real-time message counts
 *   in a room list).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import redis from '../lib/redis.js';
import { supabaseAdmin } from '../auth/supabase.js';

// Sync interval: 60 seconds
const SYNC_INTERVAL_MS = 60_000;

/**
 * syncRoomCounts
 * Reads all "roomcount:*" keys from Redis, batches UPDATE queries to Supabase.
 */
async function syncRoomCounts() {
  try {
    // KEYS "roomcount:*" — note: KEYS is O(N) on all Redis keys, which is generally
    // an anti-pattern in production (see Bottleneck #3). However, this job runs only
    // once per minute on a background timer, not on the hot request path.
    // The number of rooms is bounded and small (not per-user), so KEYS is acceptable here.
    // In a very large deployment, replace with SCAN to avoid blocking Redis momentarily.
    const keys = await redis.keys('roomcount:*');

    if (keys.length === 0) return;

    // Read all counts in one pipeline round trip
    const pipeline = redis.pipeline();
    keys.forEach(key => pipeline.get(key));
    const results = await pipeline.exec();

    // Pair each key with its value and build UPDATE promises
    const updates = keys.map((key, i) => {
      const roomId = key.replace('roomcount:', '');
      const count  = parseInt(results[i][1] ?? '0', 10);
      return { roomId, count };
    }).filter(({ count }) => count > 0);

    if (updates.length === 0) return;

    // Batch update Supabase. We could upsert all in one call if rooms exist,
    // but upsert requires knowing the primary key. Instead, fire updates in parallel.
    await Promise.all(
      updates.map(({ roomId, count }) =>
        supabaseAdmin
          .from('rooms')
          .update({ synced_count: count })
          .eq('id', roomId)
      )
    );

    console.log(`[syncRoomCounts] Synced ${updates.length} room(s) to Supabase`);

  } catch (err) {
    // Log but don't crash — the sync job failing doesn't affect chat functionality.
    // Redis counts are the live source of truth; Postgres is the durable backup.
    console.error('[syncRoomCounts] Error during sync:', err.message);
  }
}

/**
 * startSyncJob
 * Call this once from src/index.js to register the recurring job.
 * Returns the interval ID so it can be cleared on graceful shutdown.
 */
export function startSyncJob() {
  console.log(`[syncRoomCounts] Starting write-behind sync every ${SYNC_INTERVAL_MS / 1000}s`);

  // Run once immediately so we don't wait a full minute on startup
  syncRoomCounts();

  return setInterval(syncRoomCounts, SYNC_INTERVAL_MS);
}

export default startSyncJob;
