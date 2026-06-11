# EchoChamber — Full Build Guide (Bottleneck-Hardened)
### Real-time Chat App with Personality-Aware Message Reframing

---

## What is EchoChamber? (1 paragraph — use this everywhere)

> EchoChamber is a real-time chat application where the same message is experienced differently by every recipient based on their personality profile. When users join, they answer 5 rapid-fire questions that generate a unique color identity, abstract avatar, and personality tag stored in Redis. Messages are sent over WebSockets using Socket.io, stored raw in Supabase PostgreSQL, fanned out to all server instances via Redis Pub/Sub, and then reframed by Groq's free Llama 3 API — grouped by personality type so a room of 50 people triggers at most 9 LLM calls, not 49. The room itself has "emotional weather" — a live Canvas animation driven by real-time sentiment analysis that runs asynchronously so it never delays message delivery. Built with Node.js, Express, Socket.io, Redis (Upstash), PostgreSQL (Supabase), Groq API, and React — entirely free to build and host.

---

## Full Tech Stack — All Free

| Layer | Tool | Why |
|---|---|---|
| Frontend | React + Vite + Vercel | Free hosting, fast DX |
| Styling | Tailwind CSS | Utility-first, rapid |
| Real-time | Socket.io (client + server) | WebSocket abstraction with fallbacks |
| Backend | Node.js + Express + Render | Free hosting |
| Cache + Pub/Sub | Redis via Upstash | 10,000 commands/day free |
| Database + Auth | PostgreSQL via Supabase | 500MB free, built-in auth |
| LLM (reframing) | Groq API — Llama 3 | Generous free tier, ~150ms latency |
| Sentiment | `sentiment` npm package | Free, zero API call |
| Visuals | Canvas API | Built into browser |

**Total cost: $0.00**

---

## Bottleneck Audit — All 8 Found and Fixed

Before reading the prompts, understand every problem that was caught and why the fix works.

| # | Bottleneck | Impact | Fix |
|---|---|---|---|
| 1 | 49 Groq calls per message in 50-person room | Exhausts free tier in 1 minute | Group by personality type → max 9 calls + Redis cache |
| 2 | ~104 Redis commands per message → 96 msgs kills free tier | App dies same day | Pipeline commands + cache profiles on socket object + MGET |
| 3 | `KEYS "online:*"` scans entire Redis keyspace | O(N) on all keys, slows with scale | Replace with Redis Set per room: SADD/SREM/SMEMBERS |
| 4 | Supabase auth network call on every REST request | 50 users × every request = 50 round trips | Cache validated tokens in Redis with 5-min TTL |
| 5 | `UPDATE rooms SET message_count+1` row lock contention | Concurrent messages deadlock | Use Redis INCR, sync to Postgres once/minute |
| 6 | Sentiment + weather update blocks message delivery | Adds latency to every send | Run weather update via setImmediate (async, non-blocking) |
| 7 | Canvas requestAnimationFrame runs when tab is hidden | Wastes CPU/battery on background tabs | Pause loop with Page Visibility API |
| 8 | No rate limit on WebSocket send_message event | Trivial to flood server programmatically | Token bucket in Redis: max 30 msg/min per user |

---
---

# PROMPT 1 — Personality Onboarding + Supabase Auth + Redis Profile Storage

```
Build the onboarding and auth system for a real-time chat app called EchoChamber using Node.js + Express + Supabase + Redis (Upstash).

CONCEPT: When a user signs up, they answer 5 rapid-fire questions. Their answers generate a
personality profile stored in Redis that shapes how they experience the chat later.

─────────────────────────────────────────────
BACKEND — build these files:

1. src/auth/supabase.js
   - Initialize Supabase client using SUPABASE_URL and SUPABASE_ANON_KEY from .env
   - Export: signUp(email, password), signIn(email, password), signOut(), getUser(token)

2. src/middleware/auth.js
   - Express middleware that reads Bearer token from Authorization header
   - BOTTLENECK FIX: Cache validated tokens in Redis to avoid a Supabase network call
     on every request:
     * Check Redis: GET "auth:{token}" → if found, use cached userId, skip Supabase
     * If Redis miss: call supabase.getUser(token), then SET "auth:{token}" userId EX 300
     * This means 1 Supabase call per 5-minute window per token, not 1 per request
   - Attach req.user = { id, email } if valid, return 401 if not
   - Add comment explaining why token caching is safe here (tokens are immutable JWTs;
     if a user logs out, their token is invalidated at Supabase level, and the 5-minute
     cache window is an acceptable trade-off for a chat app)

3. src/routes/onboarding.js — POST /api/onboarding
   - Protected route (use auth middleware)
   - Accepts body: { answers: [1,2,1,3,2] } (array of 5 integers, each 1-3)
   - Compute personality traits from answers:
     * Question 1 (mountains/ocean/city) → setting: 'nature'|'ocean'|'urban'
     * Question 2 (3am/noon/6pm) → time: 'night'|'day'|'evening'
     * Question 3 (fix it/feel it/ignore it) → response: 'analytical'|'emotional'|'avoidant'
     * Question 4 (solo/small group/crowd) → social: 'introvert'|'ambivert'|'extrovert'
     * Question 5 (words/images/music) → medium: 'verbal'|'visual'|'auditory'
   - Assign a hex color from a deterministic palette based on answer sum % 12
   - Assign an avatar shape: 'circle'|'triangle'|'square'|'hexagon'|'star' (answer[2] % 5)
   - Compute a typeKey: `${response}:${medium}` (e.g. "analytical:verbal")
     This is the key used later for grouping Groq reframe calls — store it in the profile
   - Store in Redis as HASH key "profile:{userId}":
     { setting, time, response, social, medium, typeKey, color, avatar, userId, displayName }
   - Redis TTL: no expiry (permanent profile)
   - Also store in Supabase table: profiles (userId, color, avatar, personality_json, created_at)
   - Return the full profile object

4. src/routes/profile.js — GET /api/profile/:userId
   - Check Redis first (HGETALL "profile:{userId}")
   - If miss, fetch from Supabase profiles table, re-hydrate Redis
   - Return profile JSON

5. db/schema.sql — Supabase tables:

   CREATE TABLE profiles (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
     color varchar(7),
     avatar varchar(20),
     personality_json jsonb,
     display_name varchar(50),
     created_at timestamptz DEFAULT now()
   );

   CREATE TABLE rooms (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     name varchar(80) UNIQUE,
     created_at timestamptz DEFAULT now()
     -- NOTE: NO message_count column here intentionally.
     -- BOTTLENECK FIX: message_count is stored in Redis as INCR "roomcount:{roomId}"
     -- to avoid row-lock contention when concurrent messages hit the same room.
     -- A background job syncs this to Postgres once per minute.
   );

   CREATE TABLE messages (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     room_id uuid REFERENCES rooms(id),
     sender_id uuid REFERENCES auth.users(id),
     raw_content text,
     sent_at timestamptz DEFAULT now()
   );

   -- Index for fast message history queries
   CREATE INDEX idx_messages_room_sent ON messages(room_id, sent_at DESC);

6. src/jobs/syncRoomCounts.js
   - A setInterval job that runs every 60 seconds
   - KEYS "roomcount:*" → for each key, read value and UPDATE rooms SET synced_count = value
   - This decouples the hot write path (Redis INCR) from Postgres writes
   - Add comment: "This is the write-behind caching pattern"

7. .env.example with all required keys

─────────────────────────────────────────────
FRONTEND — build these React components:

src/pages/Onboarding.jsx:
- 5 question cards shown one at a time (slide animation with CSS transitions)
- Each card has a big question text + 3 clickable option buttons
- Progress bar at top (1/5 → 5/5)
- On final answer: POST /api/onboarding with the answers array
- Store returned profile in React context (ProfileContext)
- Redirect to /chat on success

src/context/ProfileContext.jsx:
- Provides { profile, setProfile, isLoaded }
- On app load: if user is logged in, GET /api/profile/:userId and populate context

src/pages/Auth.jsx:
- Email + password form (sign in / sign up toggle)
- Uses Supabase JS client directly from frontend
- On success: store session token, redirect to /onboarding if no profile exists, else /chat

Add inline comments explaining every decision, especially the two bottleneck fixes above.
Include a README section: "How to set up Supabase and Upstash in 5 minutes"
```

---

## What You're Learning in Prompt 1

**Token caching (Bottleneck 4 fix)**
Supabase `getUser(token)` is a network call — ~50-100ms. In a REST API that's fine once. But multiply by 50 concurrent users all making requests simultaneously and you have 50 parallel round trips to Supabase's auth server. Caching the token→userId mapping in Redis for 5 minutes means after the first validation, every subsequent request for that token is a sub-millisecond Redis lookup.

The trade-off: if a user is force-logged-out (e.g. admin action), their cached token stays valid for up to 5 minutes. For a chat app this is acceptable. For a banking app it wouldn't be.

> Interview answer: "I cached JWT validation results in Redis with a 5-minute TTL. The trade-off is a small staleness window on forced logouts, which is acceptable for a chat app but would need a shorter TTL or a token blocklist for security-critical systems."

**Write-behind caching for room counts (Bottleneck 5 fix)**
`UPDATE rooms SET message_count+1` with concurrent writers causes row-level locks. Two messages arriving at the same millisecond both try to read-increment-write the same row — one waits for the other. Redis `INCR` is atomic by design (single-threaded event loop) — no locks, no waiting. The sync job is "write-behind caching" — writes go fast to cache, and the durable store catches up asynchronously.

> Interview answer: "I used Redis INCR for message counts instead of a Postgres UPDATE to avoid row-lock contention under concurrent writes. A background job syncs the count to Postgres every 60 seconds. This is the write-behind caching pattern."

---
---

# PROMPT 2 — WebSocket Rooms + Redis Pub/Sub + Message History

```
Build the real-time room and messaging system for EchoChamber using Socket.io + Redis (Upstash).
This connects to the backend from Prompt 1.

─────────────────────────────────────────────
BACKEND:

1. src/socket/index.js — Socket.io server setup
   - Initialize Socket.io on the Express HTTP server
   - Auth middleware for Socket.io:
     * Read token from socket.handshake.auth.token
     * Validate with the same Redis token cache from Prompt 1 auth middleware
       (GET "auth:{token}" → userId, or fall back to supabase.getUser if miss)
     * Fetch profile: HGETALL "profile:{userId}"
     * Attach socket.userId and socket.profile AND socket.typeKey = profile.typeKey
     * BOTTLENECK FIX: Store the profile directly on the socket object so we never
       need to re-fetch it from Redis during message handling. Profile only changes
       if user retakes onboarding — handle that by emitting a 'profile_updated' event
       that reconnects the socket.
     * Reject connection if invalid token or no profile found

2. src/socket/roomHandler.js — handle these Socket.io events:

   CLIENT → SERVER events:

   'join_room' ({ roomId }):
   - socket.join(roomId)
   - BOTTLENECK FIX: Use a Redis Set for presence — NOT KEYS pattern:
     * SADD "room:{roomId}:members" userId   ← O(1) add
     * SET "presence:{roomId}:{userId}" "1" EX 30  ← for TTL-based auto-expiry
     * SMEMBERS "room:{roomId}:members" → get all online user IDs
     * For each userId in members, HGETALL "profile:{userId}" → build online user list
     * Use Redis pipeline to batch all HGETALL calls into ONE round trip:
       const pipeline = redis.pipeline()
       memberIds.forEach(id => pipeline.hgetall(`profile:${id}`))
       const profiles = await pipeline.exec()
   - LRANGE "history:{roomId}" 0 49 → send last 50 messages as 'room_history'
   - Emit 'user_joined' to room: { userId, profile }
   - Emit 'online_users' to joining client: array of profiles
   - INCR "roomcount:{roomId}" (room member count, not message count)

   'send_message' ({ roomId, content }):
   - BOTTLENECK FIX: Rate limiting with token bucket in Redis:
     * const key = `ratelimit:${socket.userId}`
     * const count = await redis.incr(key)
     * if count === 1: await redis.expire(key, 60)  ← first message sets 60s window
     * if count > 30: emit 'rate_limited' and return  ← max 30 msg/min
     * Add comment: "incr+expire is not perfectly atomic — use Lua script in production"
   - Validate content: trim, max 500 chars, reject empty
   - Build message object:
     { id: uuid, roomId, senderId: socket.userId,
       rawContent: content, sentAt: new Date().toISOString(),
       senderProfile: socket.profile }  ← use cached profile, no Redis call
   - Use Redis pipeline for all writes in ONE round trip:
     * pipeline.lpush("history:{roomId}", JSON.stringify(message))
     * pipeline.ltrim("history:{roomId}", 0, 49)
     * pipeline.incr("msgcount:{roomId}")   ← message count, synced to DB by job
     * pipeline.publish("room:{roomId}", JSON.stringify(message))
     * await pipeline.exec()
   - Insert into Supabase messages table: fire-and-forget (don't await)
   - Add comment: "Pipeline batches 4 Redis commands into 1 round trip instead of 4"

   'heartbeat' ({ roomId }):
   - SET "presence:{roomId}:{userId}" "1" EX 30
   - Client sends this every 20 seconds

   'leave_room' ({ roomId }):
   - socket.leave(roomId)
   - SREM "room:{roomId}:members" userId
   - DEL "presence:{roomId}:{userId}"
   - Emit 'user_left' to room: { userId }

   on 'disconnect':
   - For every room the socket was in (socket.rooms):
     * SREM "room:{roomId}:members" userId
     * DEL "presence:{roomId}:{userId}"
     * Emit 'user_left' to room

3. src/socket/pubsub.js — Redis Pub/Sub subscriber
   - Create a SEPARATE Redis client for subscribing
     (Upstash requires separate connections for pub vs commands)
   - Subscribe to pattern "room:*"
   - On message: parse roomId from channel, emit to io.to(roomId)
   - This handles cross-instance delivery (the core scaling fix)

4. src/routes/rooms.js:
   GET /api/rooms — list rooms, get message counts from Redis MGET "msgcount:{roomId}"
     for all room IDs fetched from Supabase (use pipeline, one round trip)
   POST /api/rooms — create room (protected)
   GET /api/rooms/:roomId/history — last 50 messages from Supabase

─────────────────────────────────────────────
FRONTEND:

src/hooks/useSocket.js:
- Initialize Socket.io client with auth token from Supabase session
- Manage connection state: connected/disconnected/error
- Send heartbeat every 20 seconds (setInterval, clear on unmount)
- Export: { socket, connected }

src/hooks/useRoom.js (uses useSocket):
- joinRoom(roomId), leaveRoom(roomId)
- sendMessage(content) — enforces 30 msg/min limit client-side too
  (track count in useRef, reset every 60s — client-side guard before server rejects)
- State: { messages, onlineUsers, isLoading }
- On 'room_history': set messages state
- On 'new_message': append to messages (deduplicate by id)
- On 'user_joined' / 'user_left': update onlineUsers
- On 'online_users': set full online list
- On 'rate_limited': show toast "Slow down — max 30 messages per minute"

src/components/RoomList.jsx:
- Shows all available rooms with user count badge
- Click to join a room
- "Create room" button with name input

src/components/MessageList.jsx:
- Renders messages array
- Each message: avatar shape (SVG), color dot, display name, content, time
- Auto-scroll to bottom on new message
- Loading skeleton: 5 placeholder message bubbles (Tailwind animate-pulse)

src/components/MessageInput.jsx:
- Textarea, send on Enter (Shift+Enter = newline)
- Character counter (500 max)
- Disabled when not connected
- Optimistic UI: show message immediately on send

Add inline comments explaining the pipeline batching and Redis Set presence pattern.
```

---

## What You're Learning in Prompt 2

**Redis pipeline — single round trip for multiple commands (Bottleneck 2 fix)**
Every `await redis.someCommand()` is a network round trip to Upstash (~20ms). Four separate commands = 80ms of pure network overhead, plus 4 commands against your daily limit. A pipeline batches all commands into one TCP packet, executes them server-side in sequence, and returns all results in one response. Same effect, 1 round trip, 1 command "credit" per operation.

> Interview answer: "I used Redis pipelines to batch multiple commands into a single round trip. Four individual commands at 20ms each would add 80ms to every message send. The pipeline collapses that to ~20ms regardless of how many commands are in the batch."

**Redis Set for presence vs KEYS scan (Bottleneck 3 fix)**
`KEYS "online:*"` scans every key in Redis — O(total keys). With 500 keys it's slow; with 50,000 it hangs. A Redis Set `"room:{roomId}:members"` gives you O(1) SADD/SREM and O(n members) SMEMBERS — only the members you care about, no global scan. Never use `KEYS` in production.

> Interview answer: "I replaced KEYS pattern matching with a Redis Set per room. KEYS is O(total database keys) and blocks Redis while scanning — it's a known anti-pattern in production. SMEMBERS is O(room members) which is exactly the set you need."

**Profile cached on socket object (Bottleneck 2 fix)**
Attaching `socket.profile` at connection time means zero Redis calls during message handling for the sender's profile. This alone saves ~49 Redis commands per message in a 50-person room for the sender lookup.

---
---

# PROMPT 3 — Groq Reframing (Grouped + Cached) + Room Emotional Weather

```
Add two features to the EchoChamber backend from Prompts 1-2:
1. Groq message reframing — grouped by personality type, Redis-cached
2. Room emotional weather — computed asynchronously, never blocking message delivery

─────────────────────────────────────────────
FEATURE 1: GROQ MESSAGE REFRAMING (bottleneck-hardened)

src/services/groq.js:
- Initialize Groq SDK using GROQ_API_KEY from .env
- Use model: "llama3-8b-8192"
- Export: reframeMessage(rawContent, recipientTypeKey) → string

reframeMessage function:
- typeKey is "response:medium" e.g. "analytical:verbal", "emotional:visual"
- System prompt:
  "You are a subtle communication translator. Reframe how a chat message SOUNDS
   to a specific personality type — same facts, different tone. Under 2 sentences.
   Never reveal you're reframing."
- User prompt:
  "Message: '{rawContent}'\nRecipient type: {typeKey}\nReframe for this personality."
- Do NOT stream here — we deliver to multiple people simultaneously, streaming
  per-group is fine but adds complexity; get the full string and emit at once
- On error: return rawContent unchanged (graceful fallback)

src/services/reframeCache.js:
- Export: getCached(rawContent, typeKey), setCached(rawContent, typeKey, reframed)
- Cache key: "reframe:{sha256(rawContent).slice(0,16)}:{typeKey}"
  Use Node's built-in crypto.createHash('sha256') — no extra package needed
- TTL: 3600 seconds (1 hour)
- getCached returns null on miss

src/socket/reframeHandler.js — the core grouped reframe logic:
Export: reframeAndDeliver(io, message)

async function reframeAndDeliver(io, message) {

  const roomSockets = io.sockets.adapter.rooms.get(message.roomId)
  if (!roomSockets) return

  // Step 1: Group sockets by typeKey — profiles are on socket objects (no Redis calls)
  const groups = {}   // { "analytical:verbal": { socketIds: [], typeKey } }
  for (const socketId of roomSockets) {
    const socket = io.sockets.sockets.get(socketId)
    if (!socket || socket.userId === message.senderId) continue

    const typeKey = socket.typeKey  // ← attached at connection, no lookup needed
    if (!groups[typeKey]) groups[typeKey] = { typeKey, socketIds: [] }
    groups[typeKey].socketIds.push(socketId)
  }

  // Step 2: Check Redis cache for all typeKeys in one pipeline
  const typeKeys = Object.keys(groups)
  const pipeline = redis.pipeline()
  typeKeys.forEach(tk => {
    const cacheKey = `reframe:${hashContent(message.rawContent)}:${tk}`
    pipeline.get(cacheKey)
  })
  const cacheResults = await pipeline.exec()

  // Step 3: Separate hits from misses
  const hits = {}
  const misses = []
  typeKeys.forEach((tk, i) => {
    if (cacheResults[i][1]) hits[tk] = cacheResults[i][1]
    else misses.push(tk)
  })

  // Step 4: Call Groq ONLY for misses — all in parallel (Promise.all)
  // Max 9 calls even for 50-person room (9 personality type combinations)
  const groqResults = await Promise.all(
    misses.map(async (tk) => {
      const reframed = await reframeMessage(message.rawContent, tk)
      return { tk, reframed }
    })
  )

  // Step 5: Write new reframes to Redis cache in one pipeline
  const cachePipeline = redis.pipeline()
  groqResults.forEach(({ tk, reframed }) => {
    const cacheKey = `reframe:${hashContent(message.rawContent)}:${tk}`
    cachePipeline.set(cacheKey, reframed, 'EX', 3600)
    hits[tk] = reframed
  })
  await cachePipeline.exec()

  // Step 6: Deliver to each socket with its reframed version
  for (const [typeKey, group] of Object.entries(groups)) {
    const content = hits[typeKey] || message.rawContent  // fallback to raw
    for (const socketId of group.socketIds) {
      io.to(socketId).emit('new_message', { ...message, content })
    }
  }

  // Step 7: Always send sender their own raw message (no reframing for yourself)
  io.to(message.senderId).emit('new_message', {
    ...message,
    content: message.rawContent
  })
}

Add comments showing the math:
// Room of 50, 5 unique personality types:
// Before: 49 Groq calls
// After: up to 5 Groq calls (cache misses only)
// Second time same message type appears: 0 Groq calls
// Upstash commands: 1 pipeline for cache check + 1 pipeline for cache write = 2 round trips

─────────────────────────────────────────────
FEATURE 2: ROOM EMOTIONAL WEATHER (non-blocking)

src/services/sentiment.js:
- Import 'sentiment' npm package (synchronous, ~1ms, no API call)
- Export: analyzeMessage(text) → { score: -5 to 5 }
- Export: updateRoomWeather(roomId, score, timestamp)

updateRoomWeather function:
- BOTTLENECK FIX: This must NOT block message delivery. Call it with setImmediate:
  setImmediate(() => updateRoomWeather(roomId, score, Date.now()))
  Add comment: "setImmediate defers to the next iteration of the event loop —
  message is delivered to clients before weather computation begins"

Inside updateRoomWeather (runs after message delivery):
- Use Redis pipeline:
  * LPUSH "weather:{roomId}" score
  * LTRIM "weather:{roomId}" 0 19  (last 20 messages)
  * LPUSH "weatherts:{roomId}" timestamp
  * LTRIM "weatherts:{roomId}" 0 19
  await pipeline.exec()

- Then compute weather state (separate reads):
  * scores = LRANGE "weather:{roomId}" 0 19  → parse as floats
  * timestamps = LRANGE "weatherts:{roomId}" 0 19 → parse as ints
  * avgScore = mean(scores)
  * velocity = count messages in last 60 seconds using timestamps
  * volatility = standard deviation of scores

- Determine state:
  * avgScore > 4 OR velocity > 15: 'stormy'
  * avgScore > 2 AND volatility < 1: 'warm'
  * avgScore > 2: 'heated'
  * avgScore < -2 AND volatility > 2: 'stormy'
  * avgScore < -2: 'tense'
  * default: 'calm'

- HSET "roomweather:{roomId}" state avgScore velocity volatility
- SET TTL 120s
- Publish "weather:{roomId}" → { state, avgScore, velocity, volatility }
  (Pub/Sub subscriber forwards this to io.to(roomId).emit('weather_update', ...))

─────────────────────────────────────────────
Modify send_message handler (from Prompt 2) to call both features:

'send_message' handler (final shape):
  1. Rate limit check (Redis token bucket)
  2. Validate + build message object (uses socket.profile — no Redis call)
  3. Pipeline: LPUSH history, LTRIM, INCR msgcount, PUBLISH → await
  4. Supabase insert — fire and forget (don't await)
  5. reframeAndDeliver(io, message) — await this (delivers to clients)
  6. setImmediate(() => {         ← AFTER message delivery
       const { score } = analyzeMessage(message.rawContent)
       updateRoomWeather(message.roomId, score, Date.now())
     })

The message reaches every client BEFORE sentiment is computed.
Weather updates arrive ~5-10ms later as a separate socket event.

─────────────────────────────────────────────
Add inline comments throughout explaining:
- Why setImmediate vs setTimeout(fn, 0) (setImmediate runs before I/O callbacks,
  setTimeout(fn,0) runs after — both are fine here but setImmediate is more explicit)
- Why Promise.all for Groq misses (parallel, not sequential — 5 parallel calls at
  150ms each = 150ms total, NOT 5 × 150ms = 750ms)
- The reframe cache key design (sha256 slice gives stable short key, typeKey
  makes it personality-specific)
```

---

## What You're Learning in Prompt 3

**Grouped Groq calls + parallel Promise.all (Bottleneck 1 fix)**
The fix has two parts. First, group 49 recipients into at most 9 personality types — reducing calls from O(room size) to O(personality types). Second, call Groq for all misses in parallel with `Promise.all`, not sequentially. Sequential would be `misses.length × 150ms`. Parallel is just `150ms` regardless of how many misses there are.

> Interview answer: "I reduced LLM calls from O(room members) to O(personality types) — at most 9 — by grouping recipients. I then fire all cache-miss Groq calls in parallel so total latency is one LLM call's duration regardless of how many groups need reframing."

**setImmediate for non-blocking side effects (Bottleneck 6 fix)**
`setImmediate` defers execution to the next iteration of the Node.js event loop — after the current operation (message delivery) completes. The message reaches all clients, then on the very next tick, sentiment analysis begins. Users never wait for weather updates.

> Interview answer: "I deferred weather computation with setImmediate so it runs after the message delivery emits. The event loop processes the emit first — clients get the message — then sentiment analysis runs on the next tick. Zero added latency to the message delivery path."

**Pipeline for cache check (Bottleneck 2 fix continued)**
Even checking the Groq cache for 9 typeKeys would be 9 Redis round trips without pipelining. The pipeline checks all 9 in one round trip, writes all new results in one round trip. Two total round trips for the entire reframe operation.

---
---

# PROMPT 4 — Full React UI: Chat Interface + Canvas Weather + Performance

```
Build the complete React frontend for EchoChamber. Connects to all backend work from Prompts 1-3.

Design language:
- Background: #0a0a0f (near black) dark, #f4f3f8 light
- Primary accent: #7c6ff7 (soft violet)
- Secondary: #4ecdc4 (teal)
- Message bubbles: semi-transparent backdrop-blur(8px) so Canvas shows through
- Font: 'DM Sans' (Google Fonts) for UI, 'DM Mono' for timestamps
- Cards: rounded-2xl, border border-white/10 dark / border-black/5 light

─────────────────────────────────────────────
PAGES AND COMPONENTS:

src/pages/ChatRoom.jsx — full viewport height layout:
┌─────────────────────────────────────────┐
│ RoomHeader (fixed, 56px)                │
├────────────┬────────────────────────────┤
│ RoomList   │ RoomWeather (Canvas bg)    │
│ (240px)    │   MessageList (scrollable) │
│            │   MessageInput (fixed btm) │
└────────────┴────────────────────────────┘

src/components/RoomWeather.jsx — Canvas ambient background:
BOTTLENECK FIX — Page Visibility API to pause animation when tab is hidden:

  useEffect(() => {
    let animationId
    let isVisible = !document.hidden

    const animate = () => {
      if (!isVisible) return  // ← don't schedule next frame if hidden
      drawWeather(canvasRef.current, weatherState)
      animationId = requestAnimationFrame(animate)
    }

    const handleVisibility = () => {
      isVisible = !document.hidden
      if (isVisible) {
        animationId = requestAnimationFrame(animate)  // resume
      }
      // if hidden, animate() will just not re-schedule itself
    }

    document.addEventListener('visibilitychange', handleVisibility)
    animationId = requestAnimationFrame(animate)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      cancelAnimationFrame(animationId)
    }
  }, [weatherState])

  Add comment: "Without this, requestAnimationFrame runs at 60fps even on background
  tabs, wasting CPU and battery. Page Visibility API pauses the loop for free."

  Weather states and Canvas drawing:
  - CALM: slow breathing gradient, cool blues/teals, ~0.3 opacity
  - WARM: gentle golden glow expanding from center
  - HEATED: rapid warm pulses, amber/coral bleeding from edges
  - TENSE: slow dark ripples, deep indigo
  - STORMY: sharp erratic flashes, red tint
  - Interpolate between states with lerp over 3 seconds on state change
  - prefers-reduced-motion: replace animation with static tinted background:
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // just fill canvas with a static tint matching the weather state
    }

src/components/MessageList.jsx — with virtualization:
  BOTTLENECK FIX — Only render visible messages:
  - Track scrollTop and containerHeight with a ref + scroll event listener
  - Calculate which messages are in the visible window:
    const ITEM_HEIGHT = 72  // estimated avg message height
    const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - 10)
    const endIndex = Math.min(messages.length, startIndex + visibleCount + 20)
    const visibleMessages = messages.slice(startIndex, endIndex)
  - Render a spacer div above (height = startIndex × ITEM_HEIGHT)
  - Render a spacer div below (height = (messages.length - endIndex) × ITEM_HEIGHT)
  - This keeps DOM nodes constant regardless of chat history length
  - Add comment: "Rendering 5000 messages would create 5000 DOM nodes.
    Virtualization keeps it to ~30 regardless of history length."
  - Auto-scroll to bottom: useEffect that scrolls when messages.length increases,
    BUT only if user was already at the bottom (don't hijack scroll if user is reading history)

src/components/MessageBubble.jsx — wrapped in React.memo:
  export default React.memo(MessageBubble, (prev, next) => {
    return prev.message.id === next.message.id &&
           prev.message.content === next.message.content
    // Only re-render if message content changed (streaming updates)
    // Add comment: "Without memo, every new message re-renders ALL bubbles in the list"
  })

  Features:
  - Avatar: 36px circle with profile.color + avatar shape SVG
  - Own messages: right-aligned, violet accent border
  - Others: left-aligned, white/10 border, semi-transparent backdrop-blur
  - "See Raw" button: appears on hover, fetches GET /api/messages/:id/raw
    Toggle between reframed (default) and raw (italic, muted, "[original]" pill)
  - Streaming: blinking cursor at end of partial content
  - Mount animation: opacity 0→1, translateY 8px→0, 200ms

src/components/MessageInput.jsx:
  - Client-side rate limit guard (mirrors server):
    const msgCount = useRef(0)
    const resetTimer = useRef(null)
    const canSend = () => {
      if (msgCount.current >= 30) return false
      msgCount.current++
      if (!resetTimer.current) {
        resetTimer.current = setTimeout(() => {
          msgCount.current = 0
          resetTimer.current = null
        }, 60000)
      }
      return true
    }
  - Show "Rate limited — wait Xs" message when limit is hit
  - Add comment: "Client-side limit gives instant feedback. Server still enforces
    the real limit — client guard is UX, not security."
  - Auto-growing textarea (rows 1-4), Enter sends, Shift+Enter newlines
  - Character counter > 400 chars, turns red < 20 remaining
  - Optimistic UI: add message to list immediately, mark as 'sending',
    on server confirm update status, on error mark as 'failed' with retry button

src/components/OnlineAvatars.jsx:
  - Stacked color circles (20px, -6px overlap)
  - Each shows profile.color + avatar shape SVG inside
  - Tooltip on hover: displayName
  - Max 5 shown + "+N" overflow indicator

src/components/AvatarShape.jsx:
  - SVG paths for circle/triangle/square/hexagon/star at configurable size
  - Memoized with React.memo (renders constantly in lists)

─────────────────────────────────────────────
ADDITIONAL FEATURES:

Notifications (unread counts):
- Track unread per room in useRef (not state — no re-render on background updates)
- Room sidebar badge: blue dot + count
- document.title: "(3) EchoChamber" when tab is unfocused
- Clear on room switch + document.addEventListener('visibilitychange', clear)

Reconnection UX:
- Socket.io auto-reconnects
- Toast: "Reconnecting..." amber → "Back online" green (auto-dismiss 2s)
- On reconnect: re-join current room, re-fetch last 10 messages to fill any gap

Mobile responsive (below 768px):
- Sidebar hidden by default, hamburger reveals as overlay
- Canvas weather at 0.4 opacity on mobile (less distracting, saves battery)
- MessageInput always pinned to bottom

─────────────────────────────────────────────
ALSO BUILD:

src/hooks/useWeather.js:
- Listens to 'weather_update' socket event
- State: { state, avgScore, velocity }
- Provides to RoomWeather and WeatherIndicator

src/hooks/useUnread.js:
- Tracks unread counts per room in a ref (not state)
- Exposes: getCount(roomId), increment(roomId), clear(roomId)
- Updates document.title as side effect

src/utils/avatarShapes.js:
- SVG path data for all 5 shapes
- getShapePath(shape, size) → string

Include vite.config.js proxying /api and /socket.io to localhost:3001.
Include full README: setup, env vars, local run, Vercel + Render deploy.
```

---

## What You're Learning in Prompt 4

**Page Visibility API (Bottleneck 7 fix)**
`requestAnimationFrame` fires 60 times per second — even on hidden tabs. A user with 5 chat rooms open has 5 Canvas loops running simultaneously. The Page Visibility API's `visibilitychange` event tells you when a tab is backgrounded. Pausing the loop when hidden is a single `if (!isVisible) return` — free performance gain.

> Interview answer: "I pause the Canvas animation when the tab isn't visible using the Page Visibility API. Without it, requestAnimationFrame runs at 60fps on every open tab simultaneously — wasting CPU proportional to how many tabs the user has open."

**React.memo with custom comparator (Bottleneck 2 fix, frontend)**
By default React re-renders a component whenever its parent re-renders. Every new message arriving triggers a re-render of the parent list, which triggers re-renders of all 100 existing MessageBubble components. React.memo with a custom equality check stops this: a bubble only re-renders if its own message content changed (which happens during streaming). 100 messages in view = 99 needless re-renders prevented per incoming message.

> Interview answer: "I wrapped MessageBubble in React.memo with a custom comparator that checks message id and content. Without it, every incoming message re-renders all visible bubbles. With it, only the new bubble renders — O(1) instead of O(visible messages)."

**Client-side rate limit as UX, not security**
The client guard gives instant feedback — the user sees "rate limited" immediately without a server round trip. But it's not the real enforcement: a malicious user can bypass it by deleting the client code. The server Redis token bucket is the real gate. Two layers: client for experience, server for correctness.

> Interview answer: "I enforce rate limits both client-side and server-side. The client guard is purely UX — instant feedback without a round trip. The server is the authoritative enforcer. Never trust the client for security-critical limits."

**Unread count in useRef not useState**
If unread counts lived in state, every background message would trigger a re-render of the entire sidebar. Using a ref means the count updates silently — only the document.title and badge are updated as side effects, without React's reconciliation cycle.

---
---

# Complete Bottleneck Summary — Interview Ready

| Bottleneck | Root Cause | Fix | Pattern Name |
|---|---|---|---|
| 49 Groq calls per message | One LLM call per recipient | Group by personality type + Redis cache | Fan-out with deduplication |
| 104 Redis commands per message | Individual commands, no batching | Pipeline all commands per operation | Command pipelining |
| KEYS scan for presence | Wrong data structure | Redis Set SADD/SREM/SMEMBERS | Appropriate data structure selection |
| Supabase auth on every request | No caching of validated tokens | Cache token→userId in Redis 5min TTL | Cache-aside with TTL |
| Row lock on message_count | Concurrent Postgres UPDATE | Redis INCR + async sync job | Write-behind caching |
| Weather blocks message delivery | Synchronous side effect | setImmediate defers to next tick | Async side effects |
| Canvas runs on hidden tabs | rAF has no visibility check | Page Visibility API pause/resume | Resource lifecycle management |
| WebSocket flooding | No server-side rate limit | Token bucket in Redis per user | Token bucket rate limiting |

---

# Full Interview Cheat Sheet

| Question | Your Answer |
|---|---|
| What does this app do? | "Same message, different experience per recipient. Groq reframes tone by personality type — max 9 LLM calls per message regardless of room size." |
| How did you handle the LLM scaling problem? | "Grouped recipients by personality type — 9 combinations max — and cached reframes in Redis. 50-person room goes from 49 calls to 5 or fewer." |
| Why Redis Pub/Sub? | "Cross-instance message delivery. User A on Server 1 sends a message — Redis Pub/Sub fans it to Server 2 where User B is connected." |
| What data structure for presence? | "Redis Set per room. SADD on join, SREM on leave, SMEMBERS for the list. Never KEYS — that scans the whole database." |
| How do you avoid blocking message delivery? | "setImmediate defers weather computation to after the emit. Message reaches clients first, sentiment runs on the next event loop tick." |
| How do you scale Redis commands under free tier? | "Pipeline. Four individual commands = 4 round trips. Pipeline = 1 round trip. Reduces both latency and command count." |
| What happens if Groq is down? | "Graceful fallback — raw message delivered unchanged. App degrades to normal chat, nothing breaks." |
| How would you scale beyond free tier? | "Redis cluster for throughput, Groq paid tier or self-hosted Ollama for LLM, Supabase Pro for DB, multiple Render instances all connected via same Redis Pub/Sub." |

---

*Build order: Prompt 1 (2-3 days) → Prompt 2 (3-4 days) → Prompt 3 (3-4 days) → Prompt 4 (3-4 days). Total: ~2 weeks.*