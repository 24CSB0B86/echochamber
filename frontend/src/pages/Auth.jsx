/**
 * src/pages/Auth.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Sign In / Sign Up page.
 *
 * Uses the Supabase JS client directly from the frontend (no API call to backend).
 * Supabase handles all auth logic (email validation, hashing, session management).
 *
 * After successful auth:
 *   - If user has no profile → redirect to /onboarding
 *   - If user has a profile  → redirect to /chat
 *
 * Design: dark glassmorphism card, DM Sans font, violet accent (#7c6ff7)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useProfile } from '../context/ProfileContext';
import './Auth.css';

export default function Auth() {
  const navigate    = useNavigate();
  const { setProfile } = useProfile();

  // Toggle between 'signin' and 'signup' modes
  const [mode,        setMode]        = useState('signin');
  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [message,     setMessage]     = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (mode === 'signup') {
        // ── Sign Up ──────────────────────────────────────────────────────────
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            // Pass displayName as metadata — onboarding route will use it
            data: { display_name: displayName || email.split('@')[0] },
          },
        });

        if (signUpError) throw signUpError;

        if (data.session) {
          // Session is available immediately (email confirmation disabled in Supabase)
          // → go straight to onboarding
          navigate('/onboarding');
        } else {
          // Email confirmation is enabled — tell user to check their inbox
          setMessage('Check your email for a confirmation link, then sign in.');
        }

      } else {
        // ── Sign In ──────────────────────────────────────────────────────────
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) throw signInError;

        const userId = data.user.id;
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';

        // Check if this user already has a profile
        // This determines whether to send them to onboarding or straight to chat
        const profileRes = await fetch(`${apiUrl}/api/profile/${userId}`);

        if (profileRes.ok) {
          const { profile } = await profileRes.json();
          setProfile(profile); // hydrate context immediately
          navigate('/chat');
        } else {
          // No profile → first-time user, send to onboarding
          navigate('/onboarding');
        }
      }

    } catch (err) {
      setError(err.message || 'Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      {/* Ambient gradient orbs — purely decorative */}
      <div className="auth-orb auth-orb--1" aria-hidden="true" />
      <div className="auth-orb auth-orb--2" aria-hidden="true" />

      <div className="auth-card" role="main">
        {/* Logo */}
        <div className="auth-logo" aria-label="EchoChamber logo">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <circle cx="20" cy="20" r="18" stroke="#7c6ff7" strokeWidth="2.5"/>
            <circle cx="20" cy="20" r="11" stroke="#4ecdc4" strokeWidth="2"/>
            <circle cx="20" cy="20" r="5" fill="#7c6ff7"/>
          </svg>
          <h1 className="auth-logo__text">EchoChamber</h1>
        </div>

        <p className="auth-tagline">
          {mode === 'signup'
            ? 'Create your identity. Start the echo.'
            : 'Welcome back to your chamber.'}
        </p>

        {/* Tab switcher */}
        <div className="auth-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={mode === 'signin'}
            className={`auth-tab ${mode === 'signin' ? 'auth-tab--active' : ''}`}
            onClick={() => { setMode('signin'); setError(''); setMessage(''); }}
          >
            Sign In
          </button>
          <button
            role="tab"
            aria-selected={mode === 'signup'}
            className={`auth-tab ${mode === 'signup' ? 'auth-tab--active' : ''}`}
            onClick={() => { setMode('signup'); setError(''); setMessage(''); }}
          >
            Sign Up
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {mode === 'signup' && (
            <div className="auth-field">
              <label htmlFor="auth-name" className="auth-label">Display Name</label>
              <input
                id="auth-name"
                type="text"
                className="auth-input"
                placeholder="How others will see you"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                maxLength={50}
                autoComplete="nickname"
              />
            </div>
          )}

          <div className="auth-field">
            <label htmlFor="auth-email" className="auth-label">Email</label>
            <input
              id="auth-email"
              type="email"
              className="auth-input"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="auth-field">
            <label htmlFor="auth-password" className="auth-label">Password</label>
            <input
              id="auth-password"
              type="password"
              className="auth-input"
              placeholder={mode === 'signup' ? 'Min 6 characters' : 'Your password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </div>

          {error   && <p className="auth-error"   role="alert">{error}</p>}
          {message && <p className="auth-message" role="status">{message}</p>}

          <button
            id="auth-submit-btn"
            type="submit"
            className="auth-btn"
            disabled={loading}
          >
            {loading
              ? <span className="auth-spinner" aria-label="Loading…" />
              : mode === 'signup' ? 'Create Account' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
