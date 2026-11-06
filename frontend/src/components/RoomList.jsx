/**
 * src/components/RoomList.jsx
 * Glassmorphic sidebar: logo, rooms, user profile row with personality type.
 */

import { useState, useEffect } from 'react';
import { useProfile } from '../context/ProfileContext';
import AvatarShape from './AvatarShape';
import { supabase } from '../lib/supabase';
import './RoomList.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function RoomList({ activeRoomId, onSelectRoom, getUnreadCount, onOpenProfile }) {
  const { profile } = useProfile();
  const [rooms,       setRooms]       = useState([]);
  const [isLoading,   setIsLoading]   = useState(true);
  const [showCreate,  setShowCreate]  = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomDesc, setNewRoomDesc] = useState('');
  const [creating,    setCreating]    = useState(false);

  async function fetchRooms() {
    try {
      const res  = await fetch(`${API_URL}/api/rooms`);
      const data = await res.json();
      setRooms(data.rooms || []);
    } catch (err) {
      console.error('[RoomList] fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchRooms();
    const interval = setInterval(fetchRooms, 30_000);
    return () => clearInterval(interval);
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    setCreating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_URL}/api/rooms`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ name: newRoomName.trim(), description: newRoomDesc.trim() }),
      });
      if (res.ok) {
        const { room } = await res.json();
        setRooms(prev => [{ ...room, messageCount: 0 }, ...prev]);
        setNewRoomName('');
        setNewRoomDesc('');
        setShowCreate(false);
        onSelectRoom(room.id, room.name);
      }
    } catch (err) {
      console.error('[RoomList] create error:', err);
    } finally {
      setCreating(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  const personalityType = profile
    ? [profile.response, profile.medium].filter(Boolean).join(' · ')
    : '';

  return (
    <aside className="room-list">
      {/* ── Logo row ──────────────────────────────────────────────────── */}
      <div className="room-list__brand">
        <div className="room-list__brand-icon" aria-hidden="true">⬡</div>
        <span className="room-list__brand-name">EchoChamber</span>
      </div>

      {/* ── Rooms section ─────────────────────────────────────────────── */}
      <div className="room-list__header">
        <span className="room-list__header-label">Rooms</span>
        <button
          id="create-room-btn"
          className="room-list__create-btn"
          onClick={() => setShowCreate(s => !s)}
          aria-label="Create room"
        >
          {showCreate ? '✕' : '+'}
        </button>
      </div>

      {showCreate && (
        <form className="room-list__create-form" onSubmit={handleCreate}>
          <input id="room-name-input" type="text" placeholder="Room name…"
            value={newRoomName} onChange={e => setNewRoomName(e.target.value)}
            maxLength={80} required autoFocus />
          <input id="room-desc-input" type="text" placeholder="Description (optional)"
            value={newRoomDesc} onChange={e => setNewRoomDesc(e.target.value)} maxLength={200} />
          <button id="create-room-submit" type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create Room'}
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="room-list__skeletons">
          {[...Array(5)].map((_, i) => <div key={i} className="room-list__skeleton" />)}
        </div>
      ) : (
        <ul className="room-list__rooms">
          {rooms.length === 0 && (
            <li className="room-list__empty">No rooms yet. Create one!</li>
          )}
          {rooms.map(room => {
            const unread  = getUnreadCount ? getUnreadCount(room.id) : 0;
            const isActive = activeRoomId === room.id;
            return (
              <li
                key={room.id}
                id={`room-${room.id}`}
                className={`room-list__item ${isActive ? 'room-list__item--active' : ''}`}
                onClick={() => onSelectRoom(room.id, room.name)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && onSelectRoom(room.id, room.name)}
              >
                <div className="room-list__item-left">
                  <span className="room-list__hash">#</span>
                  <span className="room-list__item-name">{room.name}</span>
                </div>
                <div className="room-list__item-right">
                  {unread > 0 && <span className="room-list__unread-dot" aria-label={`${unread} unread`} />}
                  {room.messageCount > 0 && (
                    <span className="room-list__item-count">
                      {room.messageCount > 999 ? '999+' : room.messageCount}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── User row (bottom) ─────────────────────────────────────────── */}
      {profile && (
        <div className="room-list__user" onClick={onOpenProfile} title="Customize Profile & Personality">
          <div
            className="room-list__user-avatar"
            style={{ '--profile-color': profile.color || 'var(--accent-primary)' }}
          >
            <AvatarShape shape={profile.avatar || 'circle'} color={profile.color || '#6366f1'} size={18} />
            <span className="room-list__user-online" aria-hidden="true" />
          </div>
          <div className="room-list__user-info">
            <span
              className="room-list__user-name"
              style={{ '--profile-color': profile.color || 'var(--text-primary)' }}
            >
              {profile.displayName || 'You'}
            </span>
            {personalityType && (
              <span className="room-list__user-type">{personalityType}</span>
            )}
          </div>
          <button
            className="room-list__settings-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (onOpenProfile) onOpenProfile();
            }}
            title="Edit profile & personality"
            aria-label="Edit profile & personality"
          >
            ⚙
          </button>
          <button
            className="room-list__signout"
            onClick={(e) => {
              e.stopPropagation();
              handleSignOut();
            }}
            title="Sign out"
            aria-label="Sign out"
          >
            ⏻
          </button>
        </div>
      )}
    </aside>
  );
}
