/**
 * src/pages/Onboarding.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * 5-question personality quiz with slide-card animation.
 *
 * UX flow:
 *   - One card visible at a time, slides in from the right
 *   - Progress bar fills as user advances
 *   - On final answer: POST /api/onboarding → save profile → redirect to /chat
 *
 * Each question maps to a personality dimension:
 *   Q1 → setting   Q2 → time   Q3 → response   Q4 → social   Q5 → medium
 *
 * Design: dark background, large question text, 3 option buttons per card,
 * smooth CSS transitions (no library needed)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useProfile } from '../context/ProfileContext';
import './Onboarding.css';

// ── Question Data ──────────────────────────────────────────────────────────────
// Each question has a topic label, the question text, and 3 options.
// The index + 1 of the chosen option (1, 2, or 3) is what gets sent to the backend.
const QUESTIONS = [
  {
    id: 'q1',
    topic: 'Your World',
    emoji: '🌍',
    question: 'You have a free weekend. Where do you end up?',
    options: ['Deep in the mountains', 'At the ocean edge', 'Somewhere in the city'],
  },
  {
    id: 'q2',
    topic: 'Your Time',
    emoji: '⏰',
    question: 'Which time of day feels most like you?',
    options: ['3am — when it is quiet', 'Noon — bright and clear', '6pm — the golden shift'],
  },
  {
    id: 'q3',
    topic: 'Your Reaction',
    emoji: '💭',
    question: 'Someone is clearly upset. What is your instinct?',
    options: ['Figure out what went wrong', 'Feel it with them', 'Give them space'],
  },
  {
    id: 'q4',
    topic: 'Your Energy',
    emoji: '⚡',
    question: 'Where do you feel most alive?',
    options: ['Alone, in my own world', 'A small circle I trust', 'A crowd, the bigger the better'],
  },
  {
    id: 'q5',
    topic: 'Your Medium',
    emoji: '🎨',
    question: 'You think best through…',
    options: ['Words and conversations', 'Images and visuals', 'Music and sound'],
  },
];

// Personality traits mapping for fallback computation
const SETTING_MAP  = { 1: 'nature', 2: 'ocean', 3: 'urban' };
const TIME_MAP     = { 1: 'night', 2: 'day', 3: 'evening' };
const RESPONSE_MAP = { 1: 'analytical', 2: 'emotional', 3: 'avoidant' };
const SOCIAL_MAP   = { 1: 'introvert', 2: 'ambivert', 3: 'extrovert' };
const MEDIUM_MAP   = { 1: 'verbal', 2: 'visual', 3: 'auditory' };
const COLOR_PALETTE = [
  '#6366f1', '#818cf8', '#14b8a6', '#10b981',
  '#0ea5e9', '#f59e0b', '#f43f5e', '#ec4899',
  '#8b5cf6', '#06b6d4', '#84cc16', '#eab308'
];
const AVATAR_SHAPES = ['circle', 'triangle', 'square', 'hexagon', 'star'];

export default function Onboarding() {
  const navigate = useNavigate();
  const { profile: existingProfile, setProfile } = useProfile();

  const [currentIndex,  setCurrentIndex]  = useState(0);  // which question we're on (0-4)
  const [answers,       setAnswers]       = useState([]);  // accumulated answers (1-indexed)
  const [slideDir,      setSlideDir]      = useState('in'); // 'in' | 'out' for CSS class
  const [isTransitioning, setTransitioning] = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');

  const containerRef = useRef(null);

  const currentQuestion = QUESTIONS[currentIndex];
  const progress         = ((currentIndex) / QUESTIONS.length) * 100;
  const isLastQuestion   = currentIndex === QUESTIONS.length - 1;

  async function handleOptionSelect(optionIndex) {
    if (isTransitioning || loading) return;

    // optionIndex is 0-based from map; backend expects 1-based answers
    const answer     = optionIndex + 1;
    const newAnswers = [...answers, answer];

    if (!isLastQuestion) {
      // ── Animate slide out + advance ────────────────────────────────────────
      setTransitioning(true);
      setSlideDir('out');

      // Wait for exit animation before changing content
      await delay(280);

      setAnswers(newAnswers);
      setCurrentIndex(i => i + 1);
      setSlideDir('in');

      // Give the browser a frame to apply the 'in' class before removing 'transitioning'
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setTransitioning(false));
      });

    } else {
      // ── Final answer — submit profile ──────────────────────────────────────
      await submitProfile(newAnswers);
    }
  }

  async function submitProfile(allAnswers) {
    setLoading(true);
    setError('');

    try {
      // Get the current Supabase session to extract the access token
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        throw new Error('No active session. Please sign in again.');
      }

      const userId = session.user.id;
      const rawName = session.user.user_metadata?.display_name ||
                      existingProfile?.displayName ||
                      session.user.email?.split('@')[0] ||
                      `User${userId.slice(0, 6)}`;
      const displayName = rawName.trim();
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';

      let savedProfile = null;

      // ── Step 1: Call backend /api/onboarding ─────────────────────────────
      try {
        const res = await fetch(`${apiUrl}/api/onboarding`, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            answers: allAnswers,
            displayName,
            color: existingProfile?.color,
            avatar: existingProfile?.avatar,
          }),
        });

        if (res.ok) {
          const resJson = await res.json();
          if (resJson?.profile) {
            savedProfile = resJson.profile;
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          console.warn('[Onboarding] Backend returned error:', errData.error);
        }
      } catch (fetchErr) {
        console.warn('[Onboarding] Backend fetch failed, falling back to direct Supabase:', fetchErr.message);
      }

      // ── Step 2: Supabase fallback if backend /api/onboarding was unavailable ──
      if (!savedProfile) {
        const setting  = SETTING_MAP[allAnswers[0]]   || 'nature';
        const time     = TIME_MAP[allAnswers[1]]      || 'night';
        const response = RESPONSE_MAP[allAnswers[2]]  || 'analytical';
        const social   = SOCIAL_MAP[allAnswers[3]]    || 'ambivert';
        const medium   = MEDIUM_MAP[allAnswers[4]]    || 'verbal';
        const typeKey  = `${response}:${medium}`;

        const answerSum = allAnswers.reduce((acc, a) => acc + a, 0);
        const color = existingProfile?.color || COLOR_PALETTE[answerSum % 12];
        const avatar = existingProfile?.avatar || AVATAR_SHAPES[(allAnswers[2] - 1) % 5];

        const { error: dbError } = await supabase
          .from('profiles')
          .upsert({
            user_id:          userId,
            color,
            avatar,
            display_name:     displayName,
            personality_json: { setting, time, response, social, medium, typeKey },
          }, { onConflict: 'user_id' });

        if (dbError) {
          throw new Error(dbError.message || 'Failed to save personality profile');
        }

        savedProfile = {
          userId,
          displayName,
          setting,
          time,
          response,
          social,
          medium,
          typeKey,
          color,
          avatar,
        };
      }

      // Store profile in React context so /chat can access it immediately
      setProfile(savedProfile);

      // Small celebratory pause before redirect
      await delay(400);
      navigate('/chat');

    } catch (err) {
      console.error('[Onboarding] Error submitting profile:', err);
      setError(err.message || 'Failed to save profile. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="onboarding-page">
      {/* Ambient background */}
      <div className="onboarding-orb onboarding-orb--1" aria-hidden="true" />
      <div className="onboarding-orb onboarding-orb--2" aria-hidden="true" />

      <div className="onboarding-container">
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="onboarding-header">
          <div className="onboarding-brand">EchoChamber</div>
          <div className="onboarding-step-label" aria-live="polite">
            {currentIndex + 1} / {QUESTIONS.length}
          </div>
        </div>

        {/* ── Progress Bar ───────────────────────────────────────────────────── */}
        <div
          className="onboarding-progress-track"
          role="progressbar"
          aria-valuenow={currentIndex + 1}
          aria-valuemin={1}
          aria-valuemax={QUESTIONS.length}
          aria-label={`Question ${currentIndex + 1} of ${QUESTIONS.length}`}
        >
          {/* Render 5 individual segment dots for visual clarity */}
          {QUESTIONS.map((_, i) => (
            <div
              key={i}
              className={`onboarding-progress-dot ${i <= currentIndex ? 'onboarding-progress-dot--filled' : ''}`}
            />
          ))}
          {/* Animated fill bar underneath */}
          <div
            className="onboarding-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* ── Question Card ──────────────────────────────────────────────────── */}
        <div
          ref={containerRef}
          className={`onboarding-card onboarding-card--${slideDir}`}
          key={currentIndex} /* key change triggers re-mount + CSS animation */
        >
          <div className="onboarding-card__topic">
            <span className="onboarding-card__emoji" aria-hidden="true">
              {currentQuestion.emoji}
            </span>
            {currentQuestion.topic}
          </div>

          <h2 className="onboarding-card__question">
            {currentQuestion.question}
          </h2>

          <div className="onboarding-options" role="group" aria-label="Answer options">
            {currentQuestion.options.map((option, idx) => (
              <button
                key={idx}
                id={`option-${currentQuestion.id}-${idx}`}
                className="onboarding-option"
                onClick={() => handleOptionSelect(idx)}
                disabled={isTransitioning || loading}
              >
                <span className="onboarding-option__number" aria-hidden="true">
                  {idx + 1}
                </span>
                <span className="onboarding-option__text">{option}</span>
                <span className="onboarding-option__arrow" aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Loading State ──────────────────────────────────────────────────── */}
        {loading && (
          <div className="onboarding-loading" aria-live="polite">
            <div className="onboarding-spinner" aria-label="Building your profile…" />
            <p>Building your chamber identity…</p>
          </div>
        )}

        {/* ── Error ─────────────────────────────────────────────────────────── */}
        {error && (
          <p className="onboarding-error" role="alert">{error}</p>
        )}
      </div>
    </div>
  );
}

/** Tiny async delay — avoids setTimeout soup */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
