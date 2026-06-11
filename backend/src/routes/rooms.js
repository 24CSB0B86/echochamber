/**
 * src/routes/rooms.js
 * ─────────────────────────────────────────────────────────────────────────────
 * REST endpoints for rooms:
 *   GET  /api/rooms              — list all rooms with live message counts
 *   POST /api/rooms              — create a room (protected)
 *   GET  /api/rooms/:roomId/history — last 50 messages from Supabase
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router }   from 'express';
import { v4 as uuid } from 'uuid';
import redis          from '../lib/redis.js';
import { supabaseAdmin, createUserClient } from '../auth/supabase.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// ────────────────────────────────────────────────────────────────────────────
// GET /api/rooms — list rooms with live message counts
// ────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    // Fetch room list from Supabase (source of truth for room metadata)
    const { data: rooms, error } = await supabaseAdmin
      .from('rooms')
      .select('id, name, description, created_at, synced_count')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[rooms] Supabase fetch error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch rooms' });
    }

    if (!rooms || rooms.length === 0) {
      return res.json({ rooms: [] });
    }

    // ── Pipeline: fetch all live message counts in ONE round trip ────────────
    // Without pipeline: rooms.length × ~20ms network calls.
    // With pipeline: all MGET calls batched into 1 TCP packet → ~20ms total.
    const pipeline = redis.pipeline();
    rooms.forEach(room => pipeline.get(`msgcount:${room.id}`));
    const countResults = await pipeline.exec();

    const enriched = rooms.map((room, i) => {
      const [err, liveCount] = countResults[i];
      return {
        ...room,
        // Use live Redis count if available, fall back to DB synced_count
        messageCount: !err && liveCount != null
          ? parseInt(liveCount, 10)
          : (room.synced_count ?? 0),
      };
    });

    return res.json({ rooms: enriched });
  } catch (err) {
    console.error('[rooms] GET / error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/rooms — create a room (auth required)
// ────────────────────────────────────────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  const { name, description } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const userClient = createUserClient(req.token);
    const { data, error } = await userClient
      .from('rooms')
      .insert({
        id:          uuid(),
        name:        name.trim().slice(0, 80),
        description: description?.trim().slice(0, 200) || null,
        created_by:  req.user.id,
      })
      .select()
      .single();

    if (error) {
      console.error('[rooms] POST error:', error.message);
      return res.status(500).json({ error: 'Failed to create room' });
    }

    return res.status(201).json({ room: data });
  } catch (err) {
    console.error('[rooms] POST error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/rooms/:roomId/history — last 50 messages from Supabase
// ────────────────────────────────────────────────────────────────────────────
router.get('/:roomId/history', async (req, res) => {
  const { roomId } = req.params;

  try {
    const { data, error } = await supabaseAdmin
      .from('messages')
      .select(`
        id, content, sent_at, sender_id,
        profiles:sender_id ( display_name, color, avatar, personality_json )
      `)
      .eq('room_id', roomId)
      .order('sent_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[rooms] history error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch history' });
    }

    // Reverse so oldest-first for display
    return res.json({ messages: (data || []).reverse() });
  } catch (err) {
    console.error('[rooms] history error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
