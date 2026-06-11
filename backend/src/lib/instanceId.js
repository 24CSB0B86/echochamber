/**
 * src/lib/instanceId.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unique ID for this server process instance.
 *
 * Why this is needed:
 *   roomHandler.js PUBLISHes every message to Redis channel "room:{roomId}".
 *   pubsub.js's subscriber runs in the SAME process and receives that publish.
 *
 *   Without this ID, pubsub.js would emit 'new_message' to the whole room
 *   (raw content) BEFORE reframeAndDeliver finishes sending the per-personality
 *   reframed version. The frontend deduplicates by message ID — whichever
 *   arrives first wins. Pubsub fires during the first await inside
 *   reframeAndDeliver, so raw always arrives first → reframed version is dropped.
 *
 * The fix:
 *   - roomHandler.js stamps every message with { instanceId: INSTANCE_ID }
 *   - pubsub.js checks: if message.instanceId === INSTANCE_ID → SKIP
 *     (this instance already handled delivery via reframeAndDeliver)
 *   - if message.instanceId !== INSTANCE_ID → a DIFFERENT server instance
 *     published this message, so THIS instance must deliver it to its own
 *     clients via reframeAndDeliver (the cross-instance scaling path)
 *
 * Result:
 *   Single-instance: pubsub skips, reframeAndDeliver handles everything ✓
 *   Multi-instance:  pubsub routes cross-instance messages through reframeAndDeliver ✓
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { v4 as uuid } from 'uuid';

// Generated once at process start — unique across restarts and instances
export const INSTANCE_ID = uuid();

console.log(`[EchoChamber] Instance ID: ${INSTANCE_ID.slice(0, 8)}…`);
