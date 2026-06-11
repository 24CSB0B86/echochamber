/**
 * src/hooks/useWeather.js
 * Listens to 'weather_update' socket events and returns the current room weather.
 *
 * Takes an already-created socket and roomId as parameters — does NOT create its
 * own socket connection. This avoids opening a second WebSocket when both
 * useRoom and useWeather are used in the same component.
 *
 * Shape returned: { state, avgScore, velocity, volatility }
 *   state:      'calm' | 'warm' | 'heated' | 'tense' | 'stormy'
 *   avgScore:   number (-5 to 5), mean sentiment over last 20 messages
 *   velocity:   number, messages sent in last 60 seconds
 *   volatility: number, std deviation of sentiment scores
 */

import { useState, useEffect } from 'react';

export function useWeather(socket, roomId) {
  const [weather, setWeather] = useState(null);

  useEffect(() => {
    if (!socket || !roomId) return;

    // 'weather_update' is emitted by pubsub.js whenever sentiment.js
    // publishes to Redis channel "weather:{roomId}".
    // It arrives ~5-10ms AFTER 'new_message' (setImmediate on backend)
    // so it never blocks message delivery.
    function handleWeather(data) {
      setWeather(data);
    }

    socket.on('weather_update', handleWeather);

    return () => {
      socket.off('weather_update', handleWeather);
      setWeather(null); // reset when leaving room
    };
  }, [socket, roomId]);

  return weather;
}
