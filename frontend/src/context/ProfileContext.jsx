/**
 * src/context/ProfileContext.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * React context that holds the current user's personality profile.
 *
 * On app load:
 *   1. Check if user has an active Supabase session
 *   2. If yes, GET /api/profile/:userId to restore the profile into context
 *   3. isLoaded becomes true once the check is complete (success or no profile)
 *
 * Components that need the profile (MessageBubble, Onboarding, etc.) read from
 * this context instead of making their own fetch calls.
 *
 * Shape of profile:
 *   { userId, displayName, setting, time, response, social, medium,
 *     typeKey, color, avatar }
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const ProfileContext = createContext(null);

export function ProfileProvider({ children }) {
  const [profile,  setProfile]  = useState(null);
  const [isLoaded, setIsLoaded] = useState(false); // true once the initial fetch is done

  useEffect(() => {
    /**
     * On mount: check for an existing Supabase session.
     * If a session exists, try to load the profile.
     * This handles the case where the user refreshes the page —
     * the session persists in localStorage via the Supabase SDK.
     */
    async function loadProfile() {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session?.user) {
          // No session — user is not logged in. isLoaded = true, profile stays null.
          setIsLoaded(true);
          return;
        }

        const userId = session.user.id;
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';

        const res = await fetch(`${apiUrl}/api/profile/${userId}`);

        if (res.ok) {
          const { profile: fetchedProfile } = await res.json();
          setProfile(fetchedProfile);
        }
        // 404 means no profile yet → user needs to go through onboarding.
        // We don't throw here — App.jsx handles the redirect logic.

      } catch (err) {
        console.error('[ProfileContext] Error loading profile:', err);
      } finally {
        // Always mark as loaded — consumers must not render auth-dependent
        // UI until isLoaded is true (avoids flash of wrong state).
        setIsLoaded(true);
      }
    }

    loadProfile();
  }, []);

  return (
    <ProfileContext.Provider value={{ profile, setProfile, isLoaded }}>
      {children}
    </ProfileContext.Provider>
  );
}

/**
 * useProfile — convenience hook.
 * Usage: const { profile, setProfile, isLoaded } = useProfile();
 */
export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error('useProfile must be used inside <ProfileProvider>');
  }
  return ctx;
}

export default ProfileContext;
