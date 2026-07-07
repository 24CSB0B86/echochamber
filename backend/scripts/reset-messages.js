/**
 * scripts/reset-messages.js
 * ─────────────────────────────────────────────────────────────────────────────
 * One-shot admin script: wipes all chat messages and resets message counters.
 *
 * What it does:
 *   1. Deletes ALL rows from the `messages` table (via service-role key — bypasses RLS)
 *   2. Deletes all  msgcount:*  keys from Redis (live message counts)
 *   3. Resets  synced_count = 0  on all rooms in Supabase
 *
 * Usage:
 *   node scripts/reset-messages.js
 *
 * Run from the backend/ directory so dotenv picks up .env correctly.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import Redis      from 'ioredis';
import { createClient } from '@supabase/supabase-js';

// ── Guards ────────────────────────────────────────────────────────────────────
const required = ['SUPABASE_URL', 'REDIS_URL'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌  Missing env var: ${key}`);
    process.exit(1);
  }
}

const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
if (!hasServiceRole) {
  console.warn('⚠️   SUPABASE_SERVICE_ROLE_KEY not set — Supabase steps will be skipped.');
  console.warn('    Add it to .env from: Supabase → Settings → API → service_role key\n');
}

// ── Clients ───────────────────────────────────────────────────────────────────
const supabase = hasServiceRole
  ? createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,  // service role bypasses RLS
      { auth: { persistSession: false } }
    )
  : null;

const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  tls: process.env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
});

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🗑️  EchoChamber — Reset All Messages\n');

  // ── Step 1: Delete all messages from Supabase ────────────────────────────
  if (!supabase) {
    console.log('Step 1/3  ⏭️  Skipped (no SUPABASE_SERVICE_ROLE_KEY).');
    console.log('          → Run this SQL in Supabase → SQL Editor instead:');
    console.log('            DELETE FROM messages;\n');
  } else {
    console.log('Step 1/3  Deleting all messages from Supabase...');
    const { error: msgError, count } = await supabase
      .from('messages')
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000'); // delete all rows

    if (msgError) {
      console.error('❌  Supabase delete failed:', msgError.message);
      process.exit(1);
    }
    console.log(`✅  Deleted ${count ?? 'all'} message(s) from Supabase.\n`);
  }

  // ── Step 2: Delete all msgcount:* keys from Redis ────────────────────────
  console.log('Step 2/3  Resetting Redis message counts (msgcount:*)...');
  const msgCountKeys = await redis.keys('msgcount:*');
  if (msgCountKeys.length === 0) {
    console.log('   (no msgcount keys found — already clean)\n');
  } else {
    await redis.del(...msgCountKeys);
    console.log(`✅  Deleted ${msgCountKeys.length} msgcount key(s) from Redis.\n`);
  }

  // ── Step 3: Reset synced_count = 0 on all rooms in Supabase ─────────────
  if (!supabase) {
    console.log('Step 3/3  ⏭️  Skipped (no SUPABASE_SERVICE_ROLE_KEY).');
    console.log('          → Run this SQL in Supabase → SQL Editor instead:');
    console.log('            UPDATE rooms SET synced_count = 0;\n');
  } else {
    console.log('Step 3/3  Resetting synced_count on all rooms...');
    const { error: roomError } = await supabase
      .from('rooms')
      .update({ synced_count: 0 })
      .neq('id', '00000000-0000-0000-0000-000000000000'); // update all rows

    if (roomError) {
      console.error('❌  Room count reset failed:', roomError.message);
      process.exit(1);
    }
    console.log('✅  All room synced_counts reset to 0.\n');
  }

  console.log('🎉  Done!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌  Unexpected error:', err.message);
  process.exit(1);
});
