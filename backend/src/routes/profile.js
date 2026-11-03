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
import supabase, { createUserClient } from '../auth/supabase.js';
import { authMiddleware } from '../middleware/auth.js';

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

// ────────────────────────────────────────────────────────────────────────────
// PUT /api/profile (and PATCH /api/profile) — Update user profile & personality
// ────────────────────────────────────────────────────────────────────────────
async function handleUpdateProfile(req, res) {
  try {
    const userId = req.user.id;
    const {
      displayName,
      setting,
      time,
      response,
      social,
      medium,
      color,
      avatar,
    } = req.body || {};

    const redisKey = `profile:${userId}`;
    let existing = await redis.hgetall(redisKey);

    if (!existing || !existing.userId) {
      const { data } = await supabase
        .from('profiles')
        .select('user_id, color, avatar, personality_json, display_name')
        .eq('user_id', userId)
        .single();

      if (data) {
        existing = {
          userId:      data.user_id,
          displayName: data.display_name,
          color:       data.color,
          avatar:      data.avatar,
          ...data.personality_json,
        };
      }
    }

    const updatedSetting  = setting  || existing?.setting  || 'nature';
    const updatedTime     = time     || existing?.time     || 'night';
    const updatedResponse = response || existing?.response || 'analytical';
    const updatedSocial   = social   || existing?.social   || 'ambivert';
    const updatedMedium   = medium   || existing?.medium   || 'verbal';
    const updatedColor    = color    || existing?.color    || '#6366f1';
    const updatedAvatar   = avatar   || existing?.avatar   || 'circle';
    const updatedName     = displayName !== undefined && displayName !== null
      ? displayName.trim() || existing?.displayName || `User${userId.slice(0, 6)}`
      : existing?.displayName || `User${userId.slice(0, 6)}`;

    // Recompute typeKey for Groq reframing grouping
    const updatedTypeKey  = `${updatedResponse}:${updatedMedium}`;

    const updatedProfile = {
      userId,
      displayName: updatedName,
      setting:     updatedSetting,
      time:        updatedTime,
      response:    updatedResponse,
      social:      updatedSocial,
      medium:      updatedMedium,
      typeKey:     updatedTypeKey,
      color:       updatedColor,
      avatar:      updatedAvatar,
    };

    // 1. Update Redis (source of truth for real-time socket connections)
    await redis.hset(redisKey, updatedProfile);

    // 2. Update Supabase (durable persistence)
    const userClient = createUserClient(req.token);
    const { error: dbError } = await userClient
      .from('profiles')
      .upsert({
        user_id:          userId,
        color:            updatedColor,
        avatar:           updatedAvatar,
        display_name:     updatedName,
        personality_json: {
          setting:  updatedSetting,
          time:     updatedTime,
          response: updatedResponse,
          social:   updatedSocial,
          medium:   updatedMedium,
          typeKey:  updatedTypeKey,
        },
      }, { onConflict: 'user_id' });

    if (dbError) {
      console.warn('[profile] Supabase update warning:', dbError.message);
    }

    return res.json({ profile: updatedProfile });
  } catch (err) {
    console.error('[profile] Update error:', err);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
}

router.put('/', authMiddleware, handleUpdateProfile);
router.patch('/', authMiddleware, handleUpdateProfile);

export default router;
