/**
 * src/components/MessageList.jsx
 * Stable, jitter-free chat stream.
 *
 * Fixes for scroll vibration / shaking:
 *   - Removed naive fixed-height virtualization spacers that caused infinite
 *     scrollHeight feedback loops at the bottom scroll boundary.
 *   - Zero state updates on scroll (no re-renders during scrolling).
 *   - Instant scrollTo on initial room open (no vibrating smooth-scroll fight).
 *   - Smooth scrollTo only when a new message arrives and user is at the bottom.
 *   - Native 120Hz smooth scrolling without CSS scroll-behavior fighting mouse wheel.
 */

import { useEffect, useRef, useCallback } from 'react';
import MessageBubble from './MessageBubble';
import './MessageList.css';

// ── Loading Skeleton ────────────────────────────────────────────────────────
function MessageSkeleton() {
  return (
    <div className="msg-skeleton-list" aria-label="Loading messages">
      {[...Array(6)].map((_, i) => (
        <div key={i} className={`msg-skeleton ${i % 3 === 1 ? 'msg-skeleton--right' : ''}`}>
          <div className="msg-skeleton__avatar skeleton-pulse" />
          <div className="msg-skeleton__body">
            <div className="msg-skeleton__name skeleton-pulse" />
            <div
              className="msg-skeleton__bubble skeleton-pulse"
              style={{ width: `${32 + (i * 13) % 40}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MessageList({ messages = [], isLoading, currentUserId, currentUserProfile }) {
  const containerRef    = useRef(null);
  const wasAtBottomRef  = useRef(true);
  const isInitialLoadRef= useRef(true);
  const prevMsgCountRef = useRef(0);

  // ── Track scroll position without triggering re-renders ────────────────────
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    // User is considered at bottom if within 60px of the bottom edge
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasAtBottomRef.current = distanceToBottom <= 60;
  }, []);

  // ── Scroll to bottom logic ─────────────────────────────────────────────────
  const scrollToBottom = useCallback((instant = false) => {
    const el = containerRef.current;
    if (!el) return;

    if (instant) {
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, []);

  // ── Handle room entry and incoming messages ───────────────────────────────
  useEffect(() => {
    if (isLoading) {
      isInitialLoadRef.current = true;
      return;
    }

    if (!messages.length) {
      prevMsgCountRef.current = 0;
      return;
    }

    const el = containerRef.current;
    if (!el) return;

    // Initial load when opening room: instant scroll to bottom (zero vibration)
    if (isInitialLoadRef.current) {
      // Use requestAnimationFrame so DOM has laid out all bubble heights
      requestAnimationFrame(() => {
        scrollToBottom(true);
        // Double check after any image/avatar paint
        requestAnimationFrame(() => {
          scrollToBottom(true);
          isInitialLoadRef.current = false;
        });
      });
    } else if (messages.length > prevMsgCountRef.current) {
      // New message arrived: only smooth-scroll if user was already at the bottom
      if (wasAtBottomRef.current) {
        requestAnimationFrame(() => {
          scrollToBottom(false);
        });
      }
    }

    prevMsgCountRef.current = messages.length;
  }, [messages, isLoading, scrollToBottom]);

  if (isLoading) {
    return (
      <div className="message-list message-list--loading">
        <MessageSkeleton />
      </div>
    );
  }

  if (!messages.length) {
    return (
      <div className="message-list message-list--empty">
        <div className="message-list__empty-state">
          <div className="message-list__empty-icon" aria-hidden="true">💬</div>
          <p>No messages yet in this room.</p>
          <span>Send the first message below.</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="message-list"
      id="message-list"
      ref={containerRef}
      onScroll={handleScroll}
    >
      <div className="message-list__inner">
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isOwn={msg.senderId === currentUserId}
            recipientProfile={currentUserProfile}
          />
        ))}
      </div>
    </div>
  );
}
