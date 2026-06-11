/**
 * src/components/MessageList.jsx
 * Virtualized message list — renders only visible messages.
 *
 * BOTTLENECK FIX — Virtual List
 * ──────────────────────────────
 * Rendering 5000 messages would create 5000 DOM nodes, each with avatars,
 * text, timestamps — causing severe layout and paint costs.
 * Virtualization keeps DOM nodes constant at ~30 regardless of history length.
 *
 * Implementation:
 *   - Track scrollTop + containerHeight via a scroll listener (no ResizeObserver
 *     overhead — container height is stable in a fixed layout)
 *   - Estimate which messages are in the visible window using ITEM_HEIGHT
 *   - Render spacer divs above and below to maintain correct scroll height
 *   - Buffer: render 10 items above and 20 below visible window to prevent
 *     blank flashes during fast scrolling
 *
 * Auto-scroll:
 *   Only auto-scrolls to bottom when the user was ALREADY at the bottom.
 *   If they're reading history, new messages don't hijack their scroll position.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import MessageBubble from './MessageBubble';
import './MessageList.css';

// Estimated average message height in px (used for virtual window calculation)
// Actual heights vary but this estimate gives good-enough virtualization.
const ITEM_HEIGHT   = 72;
// Buffer above and below the visible window (items, not px)
const BUFFER_ABOVE  = 10;
const BUFFER_BELOW  = 20;

// ── Loading skeleton ──────────────────────────────────────────────────────────
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
              style={{ width: `${30 + (i * 13) % 45}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MessageList({ messages, isLoading, currentUserId, currentUserProfile }) {
  const containerRef  = useRef(null);
  const bottomRef     = useRef(null);
  const [scrollTop, setScrollTop]       = useState(0);
  const [containerH, setContainerH]    = useState(600);
  const wasAtBottomRef = useRef(true);

  // ── Track scroll position ────────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    // Check if user is at (or near) the bottom — within 80px tolerance
    wasAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  // Measure container height once on mount
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerH(el.clientHeight);
  }, []);

  // ── Auto-scroll to bottom on new messages ─────────────────────────────────
  // Only auto-scrolls if the user was already at the bottom.
  // This prevents hijacking the scroll when reading old history.
  useEffect(() => {
    if (wasAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  // ── Virtualization math ───────────────────────────────────────────────────
  const visibleCount = Math.ceil(containerH / ITEM_HEIGHT);
  const startIndex   = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_ABOVE);
  const endIndex     = Math.min(messages.length, startIndex + visibleCount + BUFFER_ABOVE + BUFFER_BELOW);

  const visibleMessages = messages.slice(startIndex, endIndex);
  const spacerTop       = startIndex * ITEM_HEIGHT;
  const spacerBottom    = Math.max(0, (messages.length - endIndex) * ITEM_HEIGHT);

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
          <span className="message-list__empty-icon">💬</span>
          <p>No messages yet. Say hello!</p>
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
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      {/* Spacer above visible window — maintains correct scroll height */}
      {spacerTop > 0 && (
        <div style={{ height: spacerTop, flexShrink: 0 }} aria-hidden="true" />
      )}

      {/* Only the ~30 visible messages are in the DOM */}
      {visibleMessages.map(msg => (
        <MessageBubble
          key={msg.id}
          message={msg}
          isOwn={msg.senderId === currentUserId}
          recipientProfile={currentUserProfile}
        />
      ))}

      {/* Spacer below visible window */}
      {spacerBottom > 0 && (
        <div style={{ height: spacerBottom, flexShrink: 0 }} aria-hidden="true" />
      )}

      {/* Scroll target */}
      <div ref={bottomRef} />
    </div>
  );
}
