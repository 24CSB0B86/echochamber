/**
 * src/hooks/useUnread.js
 * Tracks unread message counts per room WITHOUT triggering re-renders.
 *
 * Why useRef, not useState?
 *   Unread counts update on EVERY incoming message — even for background rooms.
 *   If stored in state, every new message in any room would re-render the entire
 *   sidebar. useRef stores the count without triggering re-renders.
 *   The sidebar badge re-renders only when you switch rooms (reads the ref value).
 *
 * Side effects managed here:
 *   - document.title: "(3) EchoChamber" when window is not focused
 *   - Clear counts when switching rooms or tab becomes visible
 */

import { useRef, useEffect, useCallback } from 'react';

export function useUnread(activeRoomId) {
  // Map of roomId → unread count, stored in a ref (no re-renders)
  const countsRef = useRef({});

  // ── Title update side effect ──────────────────────────────────────────────
  // Runs when counts change — but since counts is a ref, we can't useEffect
  // on it. Call updateTitle() manually after modifying counts.
  const updateTitle = useCallback(() => {
    const total = Object.values(countsRef.current).reduce((a, b) => a + b, 0);
    if (total > 0 && document.hidden) {
      document.title = `(${total}) EchoChamber`;
    } else {
      document.title = 'EchoChamber';
    }
  }, []);

  // ── Clear active room's count when tab becomes visible ───────────────────
  useEffect(() => {
    function handleVisibility() {
      if (!document.hidden && activeRoomId) {
        countsRef.current[activeRoomId] = 0;
        updateTitle();
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [activeRoomId, updateTitle]);

  // ── Clear active room's count when switching rooms ────────────────────────
  useEffect(() => {
    if (activeRoomId) {
      countsRef.current[activeRoomId] = 0;
      updateTitle();
    }
  }, [activeRoomId, updateTitle]);

  // ── Public API ────────────────────────────────────────────────────────────
  const increment = useCallback((roomId) => {
    // Don't increment for the currently active and visible room
    if (roomId === activeRoomId && !document.hidden) return;
    countsRef.current[roomId] = (countsRef.current[roomId] || 0) + 1;
    updateTitle();
  }, [activeRoomId, updateTitle]);

  const clear = useCallback((roomId) => {
    countsRef.current[roomId] = 0;
    updateTitle();
  }, [updateTitle]);

  const getCount = useCallback((roomId) => {
    return countsRef.current[roomId] || 0;
  }, []);

  return { increment, clear, getCount };
}
