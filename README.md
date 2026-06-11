# EchoChamber

Real-time personality-aware chat — React + Node.js + Socket.io + Supabase + Redis.

## Features

- **Personality profiles** — 5-question onboarding quiz assigns avatar shape, color, and typeKey
- **Groq message reframing** — messages are rewritten per recipient's personality type (Prompt 3)
- **Room Emotional Weather** — live Canvas ambient background driven by sentiment analysis
- **Horizontal scaling** — Redis pub/sub + instanceId stamp prevents duplicate delivery
- **Performance optimizations** — virtual message list, React.memo, Page Visibility API Canvas pause

---

## Local Setup

### 1. Clone and install

```bash
cd backend  && npm install
cd ../frontend && npm install
```

### 2. Backend environment

Copy `backend/.env.example` to `backend/.env` and fill in:

| Variable | Where to get it |
|----------|----------------|
| `SUPABASE_URL` | Supabase project → Settings → API |
| `SUPABASE_ANON_KEY` | Supabase project → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → service_role (optional, for syncRoomCounts) |
| `REDIS_URL` | Upstash console → Create Database → Redis → ioredis URL (`rediss://...`) |
| `GROQ_API_KEY` | console.groq.com → API Keys → Create API Key |
| `PORT` | `3001` (default) |
| `FRONTEND_URL` | `http://localhost:5173` for local dev |

### 3. Frontend environment

Create `frontend/.env`:
```
VITE_API_URL=http://localhost:3001
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 4. Supabase tables

Run in Supabase SQL editor:

```sql
-- Profiles
create table profiles (
  user_id uuid primary key references auth.users(id),
  display_name text not null,
  color text,
  avatar text,
  personality_json jsonb,
  created_at timestamptz default now()
);

-- Rooms
create table rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  synced_count integer default 0
);

-- Messages
create table messages (
  id uuid primary key,
  room_id uuid references rooms(id),
  sender_id uuid references auth.users(id),
  content text not null,
  sent_at timestamptz default now()
);

-- Enable RLS
alter table profiles enable row level security;
alter table rooms enable row level security;
alter table messages enable row level security;

-- Policies
create policy "Profiles are public" on profiles for select using (true);
create policy "Users update own profile" on profiles for all using (auth.uid() = user_id);
create policy "Rooms are public" on rooms for select using (true);
create policy "Authenticated can create rooms" on rooms for insert with check (auth.role() = 'authenticated');
create policy "Messages are public" on messages for select using (true);
create policy "Authenticated can insert messages" on messages for insert with check (auth.role() = 'authenticated');
```

### 5. Run

```bash
# Terminal 1 — backend
cd backend && npm run dev

# Terminal 2 — frontend
cd frontend && npm run dev
```

Open http://localhost:5173

---

## Deploy

### Backend → Render

1. Create a new Web Service pointing to `backend/`
2. Build command: `npm install`
3. Start command: `npm start`
4. Set all environment variables from `.env`
5. Set `FRONTEND_URL` to your Vercel deployment URL

### Frontend → Vercel

1. Import repo, set Root Directory to `frontend/`
2. Set environment variables:
   - `VITE_API_URL` → your Render backend URL
   - `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
3. Deploy

---

## Architecture

```
Browser
  │  Socket.io (WebSocket)         HTTP (REST)
  ▼                                     ▼
Express + Socket.io server ───── /api/rooms, /api/profile, /api/onboarding
  │              │
  │         Redis (Upstash)
  │    ┌────────────────────────────────────────┐
  │    │  auth:{token}          5-min token cache│
  │    │  profile:{userId}      personality hash │
  │    │  history:{roomId}      last 50 messages │
  │    │  room:{roomId}:members presence set     │
  │    │  presence:{roomId}:{userId}  TTL key    │
  │    │  ratelimit:{userId}    msg count/60s    │
  │    │  msgcount:{roomId}     write-behind ctr │
  │    │  weather:{roomId}      pub/sub channel  │
  │    │  roomweather:{roomId}  weather hash     │
  │    │  reframe:{hash}:{type} Groq cache       │
  │    └────────────────────────────────────────┘
  │              │
  │         Supabase (Postgres)
  │    tables: profiles, rooms, messages
  │    auth: email/password JWT
  │
  └── Groq API (llama-3.1-8b-instant)
       personality-aware message reframing
```

## Bottleneck Fixes Implemented

| # | Fix | File |
|---|-----|------|
| 1 | Groq calls grouped by typeKey (O(room) → O(types)) | `socket/reframeHandler.js` |
| 2 | Promise.all for parallel Groq misses | `socket/reframeHandler.js` |
| 3 | Redis pipeline for batch operations | `routes/rooms.js`, `socket/roomHandler.js` |
| 4 | Redis Sets for presence (vs KEYS scan) | `socket/roomHandler.js` |
| 5 | JWT token cache (5-min TTL) | `middleware/auth.js` |
| 6 | Write-behind cache for message counts | `jobs/syncRoomCounts.js` |
| 7 | setImmediate for non-blocking weather | `socket/roomHandler.js` |
| 8 | Page Visibility API Canvas pause | `components/RoomWeather.jsx` |
| 9 | Virtual message list (~30 DOM nodes) | `components/MessageList.jsx` |
| 10 | React.memo for MessageBubble | `components/MessageBubble.jsx` |
| 11 | instanceId stamp prevents pubsub race | `socket/pubsub.js`, `lib/instanceId.js` |
