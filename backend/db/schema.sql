-- ─────────────────────────────────────────────────────────────────────────────
-- EchoChamber — Supabase Schema
-- Run this in Supabase: SQL Editor → New Query → paste + run
--
-- ── Profiles ──────────────────────────────────────────────────────────────────
-- Stores user personality data generated during onboarding.
-- The full personality object is stored in personality_json for flexibility.
-- Individual fields (color, avatar) are promoted to columns for quick queries.
CREATE TABLE IF NOT EXISTS profiles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  color            varchar(7),        -- hex color, e.g. '#7c6ff7'
  avatar           varchar(20),       -- 'circle'|'triangle'|'square'|'hexagon'|'star'
  personality_json jsonb,             -- full profile: { setting, time, response, social, medium, typeKey }
  display_name     varchar(50),
  created_at       timestamptz DEFAULT now()
);

-- Ensure one profile per user
CREATE UNIQUE INDEX IF NOT EXISTS profiles_user_id_idx ON profiles(user_id);

-- ── Rooms ─────────────────────────────────────────────────────────────────────
-- BOTTLENECK FIX #5: NO message_count column here intentionally.
-- Incrementing a Postgres column under concurrent inserts causes row-level lock
-- contention: two messages arriving simultaneously both try to read-increment-write
-- the same row, and one must wait for the other.
--
-- Instead, message counts live in Redis as:  INCR "roomcount:{roomId}"
-- Redis INCR is atomic (single-threaded event loop) — no locks, no waiting.
-- A background job (src/jobs/syncRoomCounts.js) syncs values to Postgres every 60s.
-- This is the "write-behind caching" pattern.
--
-- We keep a synced_count column for historical queries / analytics — it just lags
-- by up to 60 seconds, which is fine for a room list display.
CREATE TABLE IF NOT EXISTS rooms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          varchar(80) UNIQUE NOT NULL,
  description   varchar(200),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  synced_count  integer DEFAULT 0,  -- synced from Redis by background job
  created_at    timestamptz DEFAULT now()
);

-- ── Messages ──────────────────────────────────────────────────────────────────
-- Stores raw message content only.
-- Reframed content is never persisted — it's computed on-the-fly per personality type
-- so each user's experience stays private.
CREATE TABLE IF NOT EXISTS messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     uuid REFERENCES rooms(id) ON DELETE CASCADE,
  sender_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  content     text NOT NULL,
  sent_at     timestamptz DEFAULT now()
);

-- Index for fast message history queries (most recent first per room)
-- This is the access pattern we use: "give me the last 50 messages in room X"
-- Without this index, Postgres would do a full table scan on every history load.
CREATE INDEX IF NOT EXISTS idx_messages_room_sent ON messages(room_id, sent_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security (RLS) Policies
-- ─────────────────────────────────────────────────────────────────────────────

-- ── profiles ──────────────────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Anyone can read profiles (needed for /api/profile/:userId public route)
CREATE POLICY "profiles are publicly readable"
  ON profiles FOR SELECT
  USING (true);

-- Authenticated users can insert/update their own profile row only.
-- auth.uid() is populated by Supabase when a request carries a valid JWT.
-- The backend uses createUserClient(req.token) which forwards the JWT,
-- so auth.uid() = the real user → this policy passes.
CREATE POLICY "users can upsert own profile"
  ON profiles FOR ALL
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── rooms ─────────────────────────────────────────────────────────────────────
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- Anyone can read rooms
CREATE POLICY "rooms are publicly readable"
  ON rooms FOR SELECT
  USING (true);

-- Authenticated users can create rooms
CREATE POLICY "authenticated users can create rooms"
  ON rooms FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Only room creator can update (e.g. rename)
CREATE POLICY "room creator can update"
  ON rooms FOR UPDATE
  USING (auth.uid() = created_by);

-- ── messages ──────────────────────────────────────────────────────────────────
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Anyone can read messages (chat is public within a room)
CREATE POLICY "messages are publicly readable"
  ON messages FOR SELECT
  USING (true);

-- Authenticated users can insert their own messages
CREATE POLICY "authenticated users can send messages"
  ON messages FOR INSERT
  WITH CHECK (auth.uid() = sender_id);
