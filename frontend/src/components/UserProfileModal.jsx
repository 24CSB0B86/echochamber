/**
 * src/components/UserProfileModal.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * User Profile & Personality Customization Panel.
 *
 * Allows users to:
 *   - Edit their Display Name
 *   - Customize their Avatar Shape (circle, triangle, square, hexagon, star)
 *   - Customize their Personality Accent Color (12 curated dark-mode hues)
 *   - Directly change their 5 Personality Profile dimensions:
 *       1. Response (analytical / emotional / avoidant)
 *       2. Medium (verbal / visual / auditory)
 *       3. Setting (nature / ocean / urban)
 *       4. Time (night / day / evening)
 *       5. Social (introvert / ambivert / extrovert)
 *   - Retake the full onboarding quiz
 *   - Sign out
 *
 * When saved:
 *   - PUT /api/profile updates Redis + Supabase
 *   - ProfileContext is updated
 *   - socket.emit('profile_updated') reconnects socket with new typeKey
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useProfile } from '../context/ProfileContext';
import AvatarShape from './AvatarShape';
import './UserProfileModal.css';

const COLOR_OPTIONS = [
  { hex: '#6366f1', label: 'Iris' },
  { hex: '#818cf8', label: 'Lavender' },
  { hex: '#14b8a6', label: 'Teal' },
  { hex: '#10b981', label: 'Emerald' },
  { hex: '#0ea5e9', label: 'Sky' },
  { hex: '#f59e0b', label: 'Amber' },
  { hex: '#f43f5e', label: 'Rose' },
  { hex: '#ec4899', label: 'Pink' },
  { hex: '#8b5cf6', label: 'Purple' },
  { hex: '#06b6d4', label: 'Cyan' },
  { hex: '#84cc16', label: 'Lime' },
  { hex: '#eab308', label: 'Sun' },
];

const SHAPE_OPTIONS = [
  { id: 'circle',   label: 'Circle' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'square',   label: 'Square' },
  { id: 'hexagon',  label: 'Hexagon' },
  { id: 'star',     label: 'Star' },
];

const DIMENSIONS = [
  {
    key: 'response',
    title: 'Tone Shift & Stress Response',
    subtitle: 'Governs how incoming messages are emotionally reframed for you',
    options: [
      { value: 'analytical', label: 'Analytical', icon: '🧠', desc: 'Direct logic, facts first, clear problem solving' },
      { value: 'emotional',  label: 'Emotional',  icon: '💜', desc: 'Warm empathy, feeling validated, heartfelt tone' },
      { value: 'avoidant',   label: 'Avoidant',   icon: '🌿', desc: 'Low pressure, spacious, soothing gentle cadence' },
    ],
  },
  {
    key: 'medium',
    title: 'Thinking Medium',
    subtitle: 'Shapes the linguistic style and metaphors of reframed text',
    options: [
      { value: 'verbal',   label: 'Verbal',   icon: '✍️', desc: 'Conversational nuance, structured sentences' },
      { value: 'visual',   label: 'Visual',   icon: '👁️', desc: 'Visual imagery, spatial analogies, descriptive terms' },
      { value: 'auditory', label: 'Auditory', icon: '🎵', desc: 'Rhythm, melodic cadence, expressive phrasing' },
    ],
  },
  {
    key: 'setting',
    title: 'World & Setting',
    subtitle: 'Your natural environmental comfort zone',
    options: [
      { value: 'nature', label: 'Mountains', icon: '⛰️', desc: 'Quiet, grounded, serene' },
      { value: 'ocean',  label: 'Ocean Edge', icon: '🌊', desc: 'Expansive, fluid, contemplative' },
      { value: 'urban',  label: 'City Pulse', icon: '🏙️', desc: 'Vibrant, dynamic, energetic' },
    ],
  },
  {
    key: 'time',
    title: 'Time of Day',
    subtitle: 'When your mental clarity peaks',
    options: [
      { value: 'night',   label: '3 AM',  icon: '🌙', desc: 'Quiet stillness, deep focus' },
      { value: 'day',     label: 'Noon',  icon: '☀️', desc: 'High momentum, bright clarity' },
      { value: 'evening', label: '6 PM',  icon: '🌇', desc: 'Golden shift, reflective warmth' },
    ],
  },
  {
    key: 'social',
    title: 'Social Energy',
    subtitle: 'How you engage in group contexts',
    options: [
      { value: 'introvert', label: 'Solo World',  icon: '🧘', desc: 'Deep self-containment' },
      { value: 'ambivert',  label: 'Small Circle',icon: '👥', desc: 'Adaptive, trusted connections' },
      { value: 'extrovert', label: 'The Crowd',   icon: '⚡', desc: 'High momentum, group energy' },
    ],
  },
];

export default function UserProfileModal({ isOpen, onClose, socket, onShowToast }) {
  const { profile, setProfile } = useProfile();
  const navigate = useNavigate();

  // Local draft state
  const [displayName, setDisplayName] = useState('');
  const [color,       setColor]       = useState('#6366f1');
  const [avatar,      setAvatar]      = useState('circle');
  const [traits,      setTraits]      = useState({
    response: 'analytical',
    medium:   'verbal',
    setting:  'nature',
    time:     'night',
    social:   'ambivert',
  });

  const [isSaving,   setIsSaving]   = useState(false);
  const [saveSuccess,setSaveSuccess]= useState(false);
  const [activeTab,  setActiveTab]  = useState('personality'); // 'personality' | 'appearance'

  // Hydrate local state when modal opens or profile changes
  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName || '');
      setColor(profile.color || '#6366f1');
      setAvatar(profile.avatar || 'circle');
      setTraits({
        response: profile.response || 'analytical',
        medium:   profile.medium   || 'verbal',
        setting:  profile.setting  || 'nature',
        time:     profile.time     || 'night',
        social:   profile.social   || 'ambivert',
      });
    }
  }, [profile, isOpen]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !profile) return null;

  const currentTypeKey = `${traits.response}:${traits.medium}`;

  function handleTraitChange(key, value) {
    setTraits(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Session expired. Please sign in again.');
      }

      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiUrl}/api/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          displayName: displayName.trim(),
          color,
          avatar,
          ...traits,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update profile');
      }

      const { profile: updatedProfile } = await res.json();

      // Update ProfileContext
      setProfile(updatedProfile);
      setSaveSuccess(true);

      // Trigger socket reconnect to update server socket.profile & socket.typeKey
      if (socket) {
        socket.emit('profile_updated');
      }

      if (onShowToast) {
        onShowToast(
          `Personality updated to ${traits.response} · ${traits.medium}! Messages will now reframe for your new lens.`,
          'success'
        );
      }

      setTimeout(() => {
        setIsSaving(false);
        onClose();
      }, 350);

    } catch (err) {
      console.error('[UserProfileModal] Save error:', err);
      setIsSaving(false);
      if (onShowToast) {
        onShowToast(err.message || 'Error updating profile', 'error');
      }
    }
  }

  async function handleSignOut() {
    try {
      await supabase.auth.signOut();
      navigate('/');
    } catch (err) {
      console.error('[UserProfileModal] Sign out error:', err);
    }
  }

  return (
    <div className="profile-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="profile-panel" onClick={e => e.stopPropagation()}>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="profile-panel__header">
          <div className="profile-panel__header-info">
            <span className="profile-panel__header-tag">Account & Lens Settings</span>
            <h2 className="profile-panel__title">User Profile & Personality</h2>
          </div>
          <button
            className="profile-panel__close-btn"
            onClick={onClose}
            aria-label="Close profile modal"
          >
            ✕
          </button>
        </div>

        {/* ── Identity Spotlight Card ────────────────────────────────────── */}
        <div className="profile-spotlight" style={{ '--accent-glow': color }}>
          <div className="profile-spotlight__avatar" style={{ '--avatar-color': color }}>
            <AvatarShape shape={avatar} color={color} size={32} />
          </div>
          <div className="profile-spotlight__details">
            <div className="profile-spotlight__name-row">
              <span className="profile-spotlight__display-name">
                {displayName || 'Anonymous User'}
              </span>
              <span className="profile-spotlight__lens-pill">
                ✦ {traits.response} · {traits.medium}
              </span>
            </div>
            <p className="profile-spotlight__desc">
              Your incoming chat messages are subtly translated in real-time to match the{' '}
              <strong>{traits.response}</strong> emotional tone and <strong>{traits.medium}</strong> medium.
            </p>
          </div>
        </div>

        {/* ── Navigation Tabs ────────────────────────────────────────────── */}
        <div className="profile-tabs" role="tablist">
          <button
            className={`profile-tab ${activeTab === 'personality' ? 'profile-tab--active' : ''}`}
            onClick={() => setActiveTab('personality')}
            role="tab"
            aria-selected={activeTab === 'personality'}
          >
            🧠 Personality Traits
          </button>
          <button
            className={`profile-tab ${activeTab === 'appearance' ? 'profile-tab--active' : ''}`}
            onClick={() => setActiveTab('appearance')}
            role="tab"
            aria-selected={activeTab === 'appearance'}
          >
            🎨 Name & Avatar Appearance
          </button>
        </div>

        {/* ── Tab Content ────────────────────────────────────────────────── */}
        <div className="profile-panel__content">

          {activeTab === 'personality' && (
            <div className="profile-dimensions">
              {DIMENSIONS.map(dim => (
                <div key={dim.key} className="profile-dimension-card">
                  <div className="profile-dimension-header">
                    <span className="profile-dimension-title">{dim.title}</span>
                    <span className="profile-dimension-subtitle">{dim.subtitle}</span>
                  </div>

                  <div className="profile-option-grid">
                    {dim.options.map(opt => {
                      const isSelected = traits[dim.key] === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          className={`profile-option-pill ${isSelected ? 'profile-option-pill--selected' : ''}`}
                          onClick={() => handleTraitChange(dim.key, opt.value)}
                        >
                          <span className="profile-option-pill__icon">{opt.icon}</span>
                          <div className="profile-option-pill__text">
                            <span className="profile-option-pill__label">{opt.label}</span>
                            <span className="profile-option-pill__desc">{opt.desc}</span>
                          </div>
                          {isSelected && (
                            <span className="profile-option-pill__check" aria-hidden="true">✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="profile-retake-banner">
                <div className="profile-retake-text">
                  <strong>Prefer guided questions?</strong>
                  <span>You can retake the 5-card personality onboarding quiz anytime.</span>
                </div>
                <button
                  type="button"
                  className="profile-retake-btn"
                  onClick={() => navigate('/onboarding')}
                >
                  Retake Quiz →
                </button>
              </div>
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="profile-appearance">
              {/* Display name field */}
              <div className="profile-field-group">
                <label className="profile-field-label" htmlFor="profile-name-input">
                  Display Name
                </label>
                <div className="profile-input-wrap">
                  <input
                    id="profile-name-input"
                    type="text"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    maxLength={32}
                    placeholder="Enter your chat display name"
                    className="profile-field-input"
                  />
                  <span className="profile-field-counter">{displayName.length}/32</span>
                </div>
              </div>

              {/* Avatar shape selector */}
              <div className="profile-field-group">
                <label className="profile-field-label">Avatar Geometric Shape</label>
                <div className="profile-shapes-grid">
                  {SHAPE_OPTIONS.map(shp => {
                    const isSelected = avatar === shp.id;
                    return (
                      <button
                        key={shp.id}
                        type="button"
                        className={`profile-shape-btn ${isSelected ? 'profile-shape-btn--selected' : ''}`}
                        onClick={() => setAvatar(shp.id)}
                      >
                        <div className="profile-shape-preview">
                          <AvatarShape shape={shp.id} color={color} size={22} />
                        </div>
                        <span className="profile-shape-label">{shp.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Color palette selector */}
              <div className="profile-field-group">
                <label className="profile-field-label">Accent Color Theme</label>
                <div className="profile-colors-grid">
                  {COLOR_OPTIONS.map(clr => {
                    const isSelected = color.toLowerCase() === clr.hex.toLowerCase();
                    return (
                      <button
                        key={clr.hex}
                        type="button"
                        className={`profile-color-circle ${isSelected ? 'profile-color-circle--selected' : ''}`}
                        style={{ '--chip-color': clr.hex }}
                        onClick={() => setColor(clr.hex)}
                        title={clr.label}
                        aria-label={clr.label}
                      >
                        {isSelected && <span className="profile-color-check">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* ── Footer Actions ──────────────────────────────────────────────── */}
        <div className="profile-panel__footer">
          <button
            type="button"
            className="profile-signout-btn"
            onClick={handleSignOut}
          >
            Sign Out
          </button>

          <div className="profile-panel__footer-right">
            <button
              type="button"
              className="profile-cancel-btn"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`profile-save-btn ${saveSuccess ? 'profile-save-btn--success' : ''}`}
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? 'Saving…' : saveSuccess ? 'Saved ✓' : 'Save Changes'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
