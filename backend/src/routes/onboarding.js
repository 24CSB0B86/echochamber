/**
 * src/routes/onboarding.js
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/onboarding — protected route
 *
 * Accepts 5 answers (integers 1-3) from the onboarding quiz.
 * Computes a deterministic personality profile from those answers.
 * Stores the profile in:
 *   - Redis HASH "profile:{userId}"  (permanent, no TTL — accessed on every socket connect)
 *   - Supabase table "profiles"      (durable storage + analytics)
 *
 * Returns the full profile object to the frontend so it can be stored in context.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import redis from '../lib/redis.js';
import supabase, { createUserClient } from '../auth/supabase.js';

const router = Router();

// ─────────────────────────────────────────────
// Personality mappings — deterministic from answer index
// answer is 1-indexed (1, 2, or 3) → map to trait strings
// ─────────────────────────────────────────────

/** Q1: Where would you rather be? */
const SETTING_MAP  = { 1: 'nature', 2: 'ocean',      3: 'urban'    };

/** Q2: What time feels most like "you"? */
const TIME_MAP     = { 1: 'night',  2: 'day',        3: 'evening'  };

/** Q3: When someone is upset, you... */
const RESPONSE_MAP = { 1: 'analytical', 2: 'emotional', 3: 'avoidant' };

/** Q4: Your ideal group size? */
const SOCIAL_MAP   = { 1: 'introvert', 2: 'ambivert', 3: 'extrovert' };

/** Q5: You think best in... */
const MEDIUM_MAP   = { 1: 'verbal', 2: 'visual',     3: 'auditory' };

// ─────────────────────────────────────────────
// Color palette — 12 deterministic colors (answer sum % 12)
// Curated so each color has a distinct mood matching personality ranges.
// Using HSL values that look great on dark backgrounds.
// ─────────────────────────────────────────────
const COLOR_PALETTE = [
  '#7c6ff7', // violet       — calm, introspective
  '#4ecdc4', // teal         — balanced, social
  '#f7c948', // amber        — energetic, verbal
  '#ff6b6b', // coral        — emotional, warm
  '#a8e6cf', // mint         — nature, analytical
  '#c9b1ff', // lavender     — night, visual
  '#ff9a3c', // orange       — urban, extrovert
  '#00b4d8', // sky blue     — ocean, day
  '#f72585', // pink         — auditory, extrovert
  '#3a86ff', // bright blue  — analytical, evening
  '#80ffdb', // seafoam      — nature, ambivert
  '#ffbe0b', // yellow       — visual, day
];

// Avatar shape mapped from answer[2] (Q3 answer, 0-indexed) modulo 5
// The Q3 answer (1-3) → index 0-2 — we use modulo to spread across all 5 shapes
const AVATAR_SHAPES = ['circle', 'triangle', 'square', 'hexagon', 'star'];

// ─────────────────────────────────────────────
// POST /api/onboarding
// ─────────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  const { answers, displayName, color: customColor, avatar: customAvatar } = req.body;

  // ── Validation ────────────────────────────────────────────────────────────
  if (!Array.isArray(answers) || answers.length !== 5) {
    return res.status(400).json({ error: 'answers must be an array of 5 integers' });
  }

  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    if (!Number.isInteger(a) || a < 1 || a > 3) {
      return res.status(400).json({
        error: `answers[${i}] must be an integer between 1 and 3, got: ${a}`,
      });
    }
  }

  try {
    const userId = req.user.id;

    // ── Compute personality traits ────────────────────────────────────────────
    const setting  = SETTING_MAP[answers[0]];
    const time     = TIME_MAP[answers[1]];
    const response = RESPONSE_MAP[answers[2]];
    const social   = SOCIAL_MAP[answers[3]];
    const medium   = MEDIUM_MAP[answers[4]];

    const typeKey = `${response}:${medium}`;

    // Color: custom if provided, otherwise deterministic from answer sum
    const answerSum = answers.reduce((acc, a) => acc + a, 0);
    const color     = customColor || COLOR_PALETTE[answerSum % 12];

    // Avatar: custom if provided, otherwise from Q3 answer modulo 5
    const avatar    = customAvatar || AVATAR_SHAPES[(answers[2] - 1) % 5];

    const name = displayName?.trim() || `User${userId.slice(0, 6)}`;

    // ── Build profile object ──────────────────────────────────────────────────
    const profile = {
      userId,
      displayName: name,
      setting,
      time,
      response,
      social,
      medium,
      typeKey,
      color,
      avatar,
    };

    // ── Store in Redis HASH (no TTL — permanent) ──────────────────────────────
    // We use HSET to store each field individually so that specific fields can
    // be read without fetching the whole object (e.g. HGET "profile:{userId}" "typeKey").
    // No TTL: the profile must survive indefinitely. Redis memory is small per profile
    // (~200 bytes) and the profile is the source of truth for real-time operations.
    const redisKey = `profile:${userId}`;
    await redis.hset(redisKey, profile);
    // No redis.expire() call — this is intentional. Profiles are permanent.

    // ── Store in Supabase (durable backup + analytics) ────────────────────────
    // Use a user-scoped client (req.token) so Supabase sees auth.uid() = userId.
    // This satisfies the RLS policy "users can upsert their own profile row"
    // without needing a service role key.
    const userClient = createUserClient(req.token);
    const { error: dbError } = await userClient
      .from('profiles')
      .upsert({
        user_id:          userId,
        color,
        avatar,
        display_name:     name,
        personality_json: { setting, time, response, social, medium, typeKey },
      }, { onConflict: 'user_id' }); // upsert so re-taking onboarding works

    if (dbError) {
      console.error('[onboarding] Supabase upsert error:', dbError.message);
      // Don't fail the request — Redis write succeeded, profile is usable.
      // Supabase is the backup; Redis is the live source of truth.
    }

    return res.status(201).json({ profile });

  } catch (err) {
    console.error('[onboarding] Unexpected error:', err);
    return res.status(500).json({ error: 'Failed to save onboarding profile' });
  }
});

export default router;
