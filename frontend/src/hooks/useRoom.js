/**
 * src/hooks/useRoom.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Room state management hook — wraps useSocket with room-specific logic.
 *
 * Handles:
 *   - join/leave room lifecycle
 *   - incoming messages (deduplication by id)
 *   - online user list
 *   - client-side rate limiting (mirrors server limit of 30 msg/min)
 *   - reconnection: re-join + refetch messages on socket reconnect
 *   - toast notifications
 *
 * Note: weather is now handled by useWeather.js (separate hook) to keep
 * this hook focused. Pass socket from this hook to useWeather.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from './useSocket';

// Client-side rate limit — mirrors server (30 msg/60s window)
const CLIENT_RATE_LIMIT     = 30;
const CLIENT_RATE_WINDOW_MS = 60_000;

export function useRoom(roomId) {
  const { socket, connected } = useSocket(roomId);

  const [messages,    setMessages]    = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [isLoading,   setIsLoading]   = useState(true);
  const [toast,       setToast]       = useState(null);

  // Client-side rate limit tracking — useRef so it doesn't trigger re-renders
  const msgCountRef    = useRef(0);
  const rateLimitTimer = useRef(null);

  // ── Show a toast notification ────────────────────────────────────────────────
  const showToast = useCallback((message, type = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Socket event listeners ───────────────────────────────────────────────────
  useEffect(() => {
    if (!socket || !roomId) return;

    // Join the room
    socket.emit('join_room', { roomId });
    setIsLoading(true);

    // ── room_history: initial load of last 50 messages ─────────────────────────
    socket.on('room_history', ({ messages: history }) => {
      setMessages(history || []);
      setIsLoading(false);
    });

    // ── new_message: real-time message via pub/sub ─────────────────────────────
    socket.on('new_message', (message) => {
      setMessages(prev => {
        // Deduplicate by message id — optimistic UI may have already added it
        if (prev.some(m => m.id === message.id)) return prev;
        return [...prev, message];
      });
    });

    // ── online_users: full list on join ────────────────────────────────────────
    socket.on('online_users', ({ users }) => {
      setOnlineUsers(users || []);
    });

    // ── user_joined / user_left: incremental presence updates ─────────────────
    socket.on('user_joined', ({ userId, profile }) => {
      setOnlineUsers(prev => {
        if (prev.some(u => u.userId === userId)) return prev;
        return [...prev, profile];
      });
    });

    socket.on('user_left', ({ userId }) => {
      setOnlineUsers(prev => prev.filter(u => u.userId !== userId));
    });

    // ── rate_limited: server rejected message ─────────────────────────────────
    socket.on('rate_limited', ({ message }) => {
      showToast(message || 'Slow down — max 30 messages per minute');
    });

    return () => {
      // Leave the room and clean up room-specific listeners only.
      // Do NOT call socket.off('connect') or socket.off('disconnect') here —
      // those are socket-level events managed by socket.io internally.
      // Removing them here breaks auto-reconnection.
      socket.emit('leave_room', { roomId });
      socket.off('room_history');
      socket.off('new_message');
      socket.off('online_users');
      socket.off('user_joined');
      socket.off('user_left');
      socket.off('rate_limited');

      // Reset room state when leaving
      setMessages([]);
      setOnlineUsers([]);
      setIsLoading(true);
    };
  }, [socket, roomId, showToast]);

  // ── Reconnect toasts (socket-level, not room-level) ─────────────────────────
  // Separate from the room effect so cleanup never removes socket.io's own
  // connect/disconnect handlers, which would break auto-reconnection.
  useEffect(() => {
    if (!socket) return;

    function onConnect() {
      showToast('Back online ✓', 'success');
      // Re-join current room after reconnect to recover any missed messages
      if (roomId) socket.emit('join_room', { roomId });
    }
    function onDisconnect() {
      showToast('Reconnecting…', 'warn');
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);     // removes ONLY our specific listener
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]); // intentionally excludes roomId and showToast to keep stable

  // ── sendMessage ───────────────────────────────────────────────────────────────
  const sendMessage = useCallback((content) => {
    if (!socket || !connected || !roomId) return;
    const trimmed = content?.trim();
    if (!trimmed || trimmed.length > 500) return;

    // ── Client-side rate limiting ─────────────────────────────────────────────
    // Client-side limit gives instant feedback. Server still enforces the real
    // limit — this guard is UX, not security.
    msgCountRef.current += 1;
    if (msgCountRef.current === 1) {
      rateLimitTimer.current = setTimeout(() => {
        msgCountRef.current = 0;
      }, CLIENT_RATE_WINDOW_MS);
    }
    if (msgCountRef.current > CLIENT_RATE_LIMIT) {
      showToast('Slow down — max 30 messages per minute');
      return;
    }

    socket.emit('send_message', { roomId, content: trimmed });
  }, [socket, connected, roomId, showToast]);

  // Cleanup rate limit timer on unmount
  useEffect(() => () => clearTimeout(rateLimitTimer.current), []);

  return {
    socket,        // ← exposed so parent can pass to useWeather / useUnread
    messages,
    setMessages,   // ← exposed for optimistic UI in MessageInput
    onlineUsers,
    isLoading,
    connected,
    toast,
    sendMessage,
    showToast,
  };
}
