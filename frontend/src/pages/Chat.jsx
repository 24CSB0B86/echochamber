/**
 * src/pages/Chat.jsx — Minimalist, High-Precision Chat Workspace
 */

import { useState, useCallback } from 'react';
import { useProfile }       from '../context/ProfileContext';
import { useTheme }         from '../context/ThemeContext';
import { useRoom }          from '../hooks/useRoom';
import { useWeather }       from '../hooks/useWeather';
import { useUnread }        from '../hooks/useUnread';
import RoomList             from '../components/RoomList';
import RoomWeather          from '../components/RoomWeather';
import MessageList          from '../components/MessageList';
import MessageInput         from '../components/MessageInput';
import OnlineAvatars        from '../components/OnlineAvatars';
import UserProfileModal     from '../components/UserProfileModal';
import AvatarShape          from '../components/AvatarShape';
import './Chat.css';

const WEATHER_META = {
  calm:   { emoji: '🌤', label: 'Calm',   color: '#14b8a6' },
  warm:   { emoji: '☀️',  label: 'Warm',   color: '#f59e0b' },
  heated: { emoji: '🔥', label: 'Heated', color: '#ff783c' },
  tense:  { emoji: '🌩', label: 'Tense',  color: '#818cf8' },
  stormy: { emoji: '⛈', label: 'Stormy', color: '#f43f5e' },
};

export default function Chat() {
  const { profile } = useProfile();
  const { theme, toggleTheme } = useTheme();
  const [activeRoom, setActiveRoom] = useState({ id: null, name: '' });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  const activeRoomId = activeRoom.id;

  const { socket, messages, onlineUsers, isLoading, connected, toast, sendMessage, showToast }
    = useRoom(activeRoomId);

  const weather = useWeather(socket, activeRoomId);
  const { clear, getCount } = useUnread(activeRoomId);

  const handleSelectRoom = useCallback((roomId, roomName) => {
    setActiveRoom({ id: roomId, name: roomName || 'room' });
    clear(roomId);
    setSidebarOpen(false);
  }, [clear]);

  if (!profile) return null;

  const weatherState = weather?.state || 'calm';
  const weatherMeta  = WEATHER_META[weatherState] || WEATHER_META.calm;

  return (
    <div className={`chat-layout ${sidebarOpen ? 'chat-layout--sidebar-open' : ''}`}>

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className={`chat-sidebar ${sidebarOpen ? 'chat-sidebar--open' : ''}`}>
        <RoomList
          activeRoomId={activeRoomId}
          onSelectRoom={handleSelectRoom}
          getUnreadCount={getCount}
          onOpenProfile={() => setProfileModalOpen(true)}
        />
      </aside>

      {/* ── Mobile overlay ───────────────────────────────────────────── */}
      {sidebarOpen && (
        <div className="chat-sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="chat-header">
        <button
          className="chat-header__hamburger"
          onClick={() => setSidebarOpen(v => !v)}
          aria-label="Toggle sidebar"
        >
          <span /><span /><span />
        </button>

        {activeRoomId ? (
          <div className="chat-header__room">
            <span className="chat-header__hash">#</span>
            <span className="chat-header__room-name" id="active-room-name">
              {activeRoom.name || 'room'}
            </span>
          </div>
        ) : (
          <span className="chat-header__no-room">Select a room</span>
        )}

        {/* Live weather indicator */}
        {activeRoomId && weather && (
          <div
            className={`chat-header__weather chat-header__weather--${weatherState}`}
            title={`Room vibe: ${weatherMeta.label}`}
          >
            <span className="chat-header__weather-dot" aria-hidden="true" />
            <span className="chat-header__weather-label">{weatherMeta.label}</span>
          </div>
        )}

        <div className="chat-header__spacer" />

        {/* ── Right-Side Actions: Online Avatars + Theme Toggle + Profile Button ── */}
        <div className="chat-header__actions">
          {activeRoomId && (
            <div className="chat-header__online-wrap">
              <OnlineAvatars users={onlineUsers} />
            </div>
          )}

          {/* Theme Toggle (Dark / Light) */}
          <button
            className="chat-header__theme-btn"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          <div className="chat-header__divider" aria-hidden="true" />

          {/* User Profile Button */}
          <button
            className="chat-header__profile-btn"
            onClick={() => setProfileModalOpen(true)}
            aria-label="Open profile and personality settings"
            title="Profile & Personality Settings"
          >
            <div
              className="chat-header__profile-avatar"
              style={{ '--profile-color': profile.color || 'var(--accent-primary)' }}
            >
              <AvatarShape shape={profile.avatar || 'circle'} color={profile.color || '#6366f1'} size={15} />
            </div>
            <div className="chat-header__profile-info">
              <span className="chat-header__profile-name">{profile.displayName || 'You'}</span>
              <span className="chat-header__profile-tag">
                {profile.response || 'neutral'} · {profile.medium || 'verbal'}
              </span>
            </div>
          </button>
        </div>
      </header>

      {/* ── Main Area ────────────────────────────────────────────────── */}
      <main className="chat-main">
        {!activeRoomId ? (
          <div className="chat-main__placeholder">
            <div className="chat-main__placeholder-icon" aria-hidden="true">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h2>Select a conversation</h2>
            <p>Every message automatically adapts tone and style to your unique personality lens.</p>
            <button
              className="chat-main__placeholder-btn"
              onClick={() => setSidebarOpen(true)}
            >
              Browse Rooms
            </button>
          </div>
        ) : (
          <div className="chat-main__room">
            {/* Ambient weather canvas */}
            <RoomWeather weatherState={weatherState} />

            <div className="chat-main__messages">
              <MessageList
                messages={messages}
                isLoading={isLoading}
                currentUserId={profile.userId}
                currentUserProfile={profile}
              />
            </div>

            <div className="chat-main__input">
              <MessageInput
                onSend={sendMessage}
                disabled={!connected}
                profile={profile}
              />
            </div>
          </div>
        )}
      </main>

      {/* ── User Profile & Personality Customization Modal ────────────── */}
      <UserProfileModal
        isOpen={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        socket={socket}
        onShowToast={showToast}
        roomId={activeRoomId}
      />

      {/* ── Toast Notifications ───────────────────────────────────────── */}
      {toast && (
        <div
          className={`chat-toast chat-toast--${toast.type}`}
          role="alert"
          id="toast-notification"
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
