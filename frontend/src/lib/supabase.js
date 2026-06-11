/**
 * src/lib/supabase.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Frontend Supabase client.
 *
 * The frontend uses the anon key + the Supabase JS SDK to handle:
 *   - Sign up / sign in / sign out (Auth page)
 *   - Session persistence in localStorage (automatic via SDK)
 *
 * We expose the raw supabase client so Auth.jsx can call supabase.auth.* directly.
 * The backend has its OWN supabase client (src/auth/supabase.js) — they share
 * the same project URL but operate independently (different execution contexts).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    '[supabase.js] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Create frontend/.env and add these values from your Supabase project.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);
