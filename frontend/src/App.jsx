/**
 * src/App.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Root component: routing + auth guards.
 *
 * Route logic:
 *   /          → Auth page (sign in / sign up)
 *   /onboarding → Onboarding quiz (requires active session)
 *   /chat       → Chat room (requires session + profile)
 *
 * The ProfileProvider wraps everything so all pages share the same profile state.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProfileProvider, useProfile } from './context/ProfileContext';
import Auth        from './pages/Auth';
import Onboarding  from './pages/Onboarding';
import Chat        from './pages/Chat';

// ── Route Guards ──────────────────────────────────────────────────────────────

/**
 * RequireProfile: redirect to /onboarding if user has no profile yet.
 * Wait for isLoaded to avoid flickering redirects on page refresh.
 */
function RequireProfile({ children }) {
  const { profile, isLoaded } = useProfile();

  if (!isLoaded) {
    // Still fetching profile — render nothing (brief flash prevented by isLoaded)
    return null;
  }

  if (!profile) {
    return <Navigate to="/onboarding" replace />;
  }

  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/"            element={<Auth />} />
      <Route path="/onboarding"  element={<Onboarding />} />
      <Route path="/chat"        element={
        <RequireProfile>
          <Chat />
        </RequireProfile>
      } />
      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ProfileProvider>
        <AppRoutes />
      </ProfileProvider>
    </BrowserRouter>
  );
}
