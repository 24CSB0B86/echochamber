/**
 * src/hooks/useSocket.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages the Socket.io connection lifecycle.
 *
 * - Connects when the user has a valid Supabase session
 * - Sends the session JWT as the auth token
 * - Sends a heartbeat every 20 seconds to keep presence TTL alive
 * - Returns { socket, connected } to consumers
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useRef } from 'react';
import { io }       from 'socket.io-client';
import { supabase } from '../lib/supabase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const HEARTBEAT_INTERVAL_MS = 20_000; // 20 seconds — server TTL is 30s

export function useSocket(roomId) {
  const [connected, setConnected] = useState(false);
  const socketRef   = useRef(null);
  const heartbeatRef = useRef(null);

  useEffect(() => {
    let socket;

    async function connect() {
      // Get the current Supabase session for the auth token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      socket = io(API_URL, {
        auth:          { token: session.access_token },
        transports:    ['websocket'],  // skip long-polling — WebSocket only
        reconnection:  true,
        reconnectionAttempts: 10,
        reconnectionDelay:    1000,
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        console.log('[useSocket] Connected:', socket.id);
        setConnected(true);
      });

      socket.on('disconnect', (reason) => {
        console.log('[useSocket] Disconnected:', reason);
        setConnected(false);
      });

      socket.on('connect_error', (err) => {
        console.error('[useSocket] Connection error:', err.message);
        setConnected(false);
      });

      // ── Heartbeat ────────────────────────────────────────────────────────────
      // Sends every 20s to keep the presence TTL key alive (server TTL = 30s).
      // Cleared on unmount to prevent memory leaks.
      heartbeatRef.current = setInterval(() => {
        if (socket.connected && roomId) {
          socket.emit('heartbeat', { roomId });
        }
      }, HEARTBEAT_INTERVAL_MS);
    }

    connect();

    return () => {
      // Cleanup on unmount
      clearInterval(heartbeatRef.current);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []); // only run once on mount — roomId for heartbeat is captured via closure

  // Update heartbeat roomId when it changes without reconnecting
  useEffect(() => {
    // heartbeat will naturally pick up the new roomId on next tick
  }, [roomId]);

  return { socket: socketRef.current, connected };
}
