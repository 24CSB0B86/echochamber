/**
 * src/components/MessageBubble.jsx
 * Glassmorphic chat bubble with tail effect, reframe badge, and "see raw" toggle.
 * Memoized — only re-renders when content or status changes.
 */

import React, { useState } from 'react';
import AvatarShape from './AvatarShape';
import './MessageBubble.css';

// Clock SVG for reframe badge
function ClockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function MessageBubble({ message, isOwn, recipientProfile }) {
  const [showRaw, setShowRaw] = useState(false);

  const { senderProfile, content, rawContent, sentAt, status } = message;
  const profile     = senderProfile || {};
  const displayText = showRaw
    ? (rawContent || content || '')
    : (content    || rawContent || '');

  const isReframed  = !isOwn && content && rawContent && content !== rawContent;
  const isFailed    = status === 'failed';
  const isSending   = status === 'sending';

  const time = sentAt
    ? new Date(sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  // Recipient's personality for the badge: "reframed for analytical · verbal"
  const recipientType = recipientProfile
    ? [recipientProfile.response, recipientProfile.medium].filter(Boolean).join(' · ')
    : '';

  return (
    <div
      className={[
        'msg-bubble',
        isOwn    ? 'msg-bubble--own'     : 'msg-bubble--other',
        isFailed ? 'msg-bubble--failed'  : '',
        isSending? 'msg-bubble--sending' : '',
      ].filter(Boolean).join(' ')}
      id={`msg-${message.id}`}
    >
      {/* Avatar */}
      {!isOwn && (
        <div
          className="msg-bubble__avatar"
          style={{ '--profile-color': profile.color || 'var(--accent-violet)' }}
        >
          <AvatarShape shape={profile.avatar || 'circle'} color="#fff" size={18} />
        </div>
      )}

      <div className="msg-bubble__body">
        {/* Sender name (others only) */}
        {!isOwn && (
          <span
            className="msg-bubble__name"
            style={{ '--profile-color': profile.color || 'var(--accent-violet)' }}
          >
            {profile.displayName || 'Anonymous'}
          </span>
        )}

        {/* Bubble */}
        <div className={[
          'msg-bubble__bubble',
          showRaw    ? 'msg-bubble__bubble--raw'       : '',
          isSending  ? 'msg-bubble__bubble--streaming' : '',
        ].filter(Boolean).join(' ')}>
          <p className="msg-bubble__text">{displayText}</p>
        </div>

        {/* Reframe row: badge + see raw toggle */}
        {isReframed && (
          <div className="msg-bubble__reframe-row">
            <span
              className="msg-bubble__reframe-badge"
              title={`This message was reframed for your personality: ${recipientType}`}
            >
              <ClockIcon />
              reframed{recipientType ? ` for ${recipientType}` : ''}
            </span>
            <button
              className={`msg-bubble__raw-toggle ${showRaw ? 'msg-bubble__raw-toggle--active' : ''}`}
              onClick={() => setShowRaw(v => !v)}
              title={showRaw ? 'Show reframed' : 'Show original'}
            >
              {showRaw ? '[ reframed ]' : '[ see original ]'}
            </button>
          </div>
        )}

        {/* Meta: time + status */}
        <div className="msg-bubble__meta">
          <span className="msg-bubble__time">{time}</span>
          {isSending && <span className="msg-bubble__status">sending…</span>}
          {isFailed  && <span className="msg-bubble__status msg-bubble__status--failed">failed</span>}
        </div>
      </div>

      {/* Own avatar (right side) */}
      {isOwn && (
        <div
          className="msg-bubble__avatar msg-bubble__avatar--own"
          style={{ '--profile-color': profile.color || 'var(--accent-violet)' }}
        >
          <AvatarShape shape={profile.avatar || 'circle'} color="#fff" size={18} />
        </div>
      )}
    </div>
  );
}

// Without memo, every new message re-renders ALL bubbles in the list.
export default React.memo(MessageBubble, (prev, next) =>
  prev.message.id      === next.message.id      &&
  prev.message.content === next.message.content &&
  prev.message.status  === next.message.status  &&
  prev.isOwn           === next.isOwn
);
