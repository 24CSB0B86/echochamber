/**
 * src/auth/supabase.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Supabase client + auth helper functions for the EchoChamber backend.
 *
 * Clients exported:
 *   supabase           — anon key singleton. Used for auth ops (signIn/signUp/getUser).
 *                        RLS applies; never used for DB writes from the server.
 *
 *   createUserClient() — factory: creates a per-request client scoped to the user's
 *                        own JWT. Supabase sees auth.uid() = the real user, so RLS
 *                        policies ("users can only write their own row") pass correctly.
 *                        Use this in route handlers that have req.token.
 *
 *   supabaseAdmin      — service role key (bypasses RLS entirely). Only for background
 *                        jobs that have no user token (e.g. syncRoomCounts).
 *                        NEVER expose this key to the frontend.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl         = process.env.SUPABASE_URL;
const supabaseAnonKey     = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '[supabase.js] Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env. ' +
    'Copy .env.example → .env and fill in your Supabase project credentials.'
  );
}

// createClient is cheap — one HTTP client, keep each as a singleton.
const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * createUserClient(token)
 * Returns a Supabase client that sends the user's own JWT on every request.
 * Supabase auth.uid() resolves to the real user → RLS policies pass.
 *
 * This is intentionally NOT a singleton — each request gets its own client
 * so tokens never bleed between concurrent requests.
 *
 * @param {string} token  The raw Bearer JWT from req.token (set by authMiddleware)
 */
export function createUserClient(token) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: { persistSession: false },
  });
}

/**
 * Admin client — uses the service role key to bypass RLS.
 * ONLY for background jobs that have no user token (e.g. syncRoomCounts).
 * Falls back to anon client with a warning if the key is not set.
 */
export const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    })
  : (() => {
      console.warn(
        '[supabase.js] SUPABASE_SERVICE_ROLE_KEY not set — ' +
        'supabaseAdmin falling back to anon client. ' +
        'Background DB writes (syncRoomCounts) may fail if RLS is enabled on rooms.'
      );
      return supabase;
    })();

// ─────────────────────────────────────────────
// Auth helpers
// These are thin wrappers so the rest of the codebase never imports
// @supabase/supabase-js directly — easier to swap later.
// ─────────────────────────────────────────────

/**
 * Sign up a new user with email + password.
 * Supabase automatically sends a confirmation email (configurable in dashboard).
 * Returns { data: { user, session }, error }
 */
export async function signUp(email, password) {
  return supabase.auth.signUp({ email, password });
}

/**
 * Sign in an existing user with email + password.
 * Returns { data: { user, session }, error }
 * session.access_token is the JWT we cache in Redis.
 */
export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

/**
 * Sign out the currently authenticated user.
 * This invalidates the session at the Supabase level, which is why the 5-minute
 * Redis token cache in auth middleware is safe — after logout the token is killed
 * server-side; the worst case is a 5-minute staleness window (see auth.js).
 */
export async function signOut() {
  return supabase.auth.signOut();
}

/**
 * Validate a JWT access token and return the associated user.
 * This is a NETWORK CALL (~50-100ms to Supabase's auth server).
 * This is what we cache in Redis to implement Bottleneck Fix #4.
 *
 * Returns { data: { user }, error }
 * user shape: { id: uuid, email: string, ... }
 */
export async function getUser(token) {
  return supabase.auth.getUser(token);
}

export default supabase;
