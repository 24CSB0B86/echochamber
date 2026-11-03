/**
 * src/pages/Chat.jsx — Minimalist, High-Precision Chat Workspace
 */

import { useState, useCallback } from 'react';
import { useProfile }       from '../context/ProfileContext';
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

        {/* ── Right-Side Actions: Online Avatars + Profile Button ── */}
        <div className="chat-header__actions">
          {activeRoomId && (
            <div className="chat-header__online-wrap">
              <OnlineAvatars users={onlineUsers} />
            </div>
          )}

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
