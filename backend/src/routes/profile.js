/**
 * src/routes/profile.js
 * ─────────────────────────────────────────────────────────────────────────────
 * GET /api/profile/:userId
 *
 * Redis-first read pattern:
 *   1. HGETALL "profile:{userId}" from Redis (O(1), sub-millisecond)
 *   2. On cache miss: query Supabase, re-hydrate Redis, return data
 *
 * This route is called:
 *   - By the frontend ProfileContext on app load (to restore session state)
 *   - By the Socket.io server at connection time (if profile not in Redis)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router } from 'express';
import redis from '../lib/redis.js';
import supabase from '../auth/supabase.js';

const router = Router();

// GET /api/profile/:userId — public route (profiles are not sensitive)
// Auth is not required here so that room participants can load each other's profiles.
router.get('/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    // ── Step 1: Try Redis first ───────────────────────────────────────────────
    // HGETALL returns an object with all hash fields, or null if the key doesn't exist.
    const redisKey = `profile:${userId}`;
    const cached   = await redis.hgetall(redisKey);

    // ioredis returns {} (empty object) for missing hash keys, not null.
    // Check for at least one known field to determine if data exists.
    if (cached && cached.userId) {
      return res.json({ profile: cached, source: 'redis' });
    }

    // ── Step 2: Redis miss → fetch from Supabase ─────────────────────────────
    const { data, error } = await supabase
      .from('profiles')
      .select('user_id, color, avatar, personality_json, display_name, created_at')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Flatten the Supabase row back into the same flat shape we store in Redis
    const profile = {
      userId:      data.user_id,
      displayName: data.display_name,
      color:       data.color,
      avatar:      data.avatar,
      // personality_json stores the deep traits
      ...data.personality_json,
    };

    // ── Step 3: Re-hydrate Redis ──────────────────────────────────────────────
    // This makes the next read fast. No TTL — profiles are permanent.
    await redis.hset(redisKey, profile);

    return res.json({ profile, source: 'supabase' });

  } catch (err) {
    console.error('[profile] Unexpected error:', err);
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

export default router;
