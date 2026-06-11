/**
 * src/pages/Chat.jsx — Premium glassmorphism chat layout
 */

import { useState, useCallback } from 'react';
import { useProfile }   from '../context/ProfileContext';
import { useRoom }      from '../hooks/useRoom';
import { useWeather }   from '../hooks/useWeather';
import { useUnread }    from '../hooks/useUnread';
import RoomList         from '../components/RoomList';
import RoomWeather      from '../components/RoomWeather';
import MessageList      from '../components/MessageList';
import MessageInput     from '../components/MessageInput';
import OnlineAvatars    from '../components/OnlineAvatars';
import './Chat.css';

const WEATHER_META = {
  calm:   { emoji: '🌤', label: 'Calm'   },
  warm:   { emoji: '☀️',  label: 'Warm'  },
  heated: { emoji: '🔥', label: 'Heated' },
  tense:  { emoji: '🌩', label: 'Tense'  },
  stormy: { emoji: '⛈', label: 'Stormy' },
};

export default function Chat() {
  const { profile }             = useProfile();
  const [activeRoomId, setActiveRoomId] = useState(null);
  const [sidebarOpen, setSidebarOpen]   = useState(false);

  const { socket, messages, onlineUsers, isLoading, connected, toast, sendMessage }
    = useRoom(activeRoomId);

  const weather = useWeather(socket, activeRoomId);
  const { increment, clear, getCount } = useUnread(activeRoomId);

  const handleSelectRoom = useCallback((roomId) => {
    setActiveRoomId(roomId);
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
              {/* Room name comes from RoomList — use roomId short form here */}
              room
            </span>
          </div>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Select a room
          </span>
        )}

        {/* Live weather pill */}
        {activeRoomId && weather && (
          <div className={`chat-header__weather chat-header__weather--${weatherState}`}
            title={`Room vibe: ${weatherMeta.label}`}
          >
            <span className="chat-header__weather-dot" aria-hidden="true" />
            {weatherMeta.emoji} {weatherMeta.label}
          </div>
        )}

        <div className="chat-header__spacer" />

        {/* Online avatars */}
        {activeRoomId && <OnlineAvatars users={onlineUsers} />}
      </header>

      {/* ── Main ────────────────────────────────────────────────────── */}
      <main className="chat-main">
        {!activeRoomId ? (
          <div className="chat-main__placeholder">
            <span className="chat-main__placeholder-icon" aria-hidden="true">⬡</span>
            <h2>Pick a room to start</h2>
            <p>Messages adapt to your personality type.</p>
          </div>
        ) : (
          <div className="chat-main__room">
            {/* Canvas ambient weather bg */}
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

      {/* ── Toast ───────────────────────────────────────────────────── */}
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
