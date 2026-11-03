/**
 * src/components/MessageBubble.jsx
 * Minimalist, high-end chat bubble with personality reframe badge & original text toggle.
 */

import React, { useState } from 'react';
import AvatarShape from './AvatarShape';
import './MessageBubble.css';

// Subtle lens/sparkle icon for the personality reframe badge
function LensIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
         aria-hidden="true">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
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

  // Recipient's personality for the badge: e.g. "Analytical · Verbal"
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
      {/* Sender Avatar */}
      {!isOwn && (
        <div
          className="msg-bubble__avatar"
          style={{ '--profile-color': profile.color || 'var(--accent-primary)' }}
        >
          <AvatarShape shape={profile.avatar || 'circle'} color="#fff" size={16} />
        </div>
      )}

      <div className="msg-bubble__body">
        {/* Sender Name (Other users only) */}
        {!isOwn && (
          <span
            className="msg-bubble__name"
            style={{ '--profile-color': profile.color || 'var(--text-secondary)' }}
          >
            {profile.displayName || 'Anonymous'}
          </span>
        )}

        {/* Bubble Text */}
        <div className={[
          'msg-bubble__bubble',
          showRaw    ? 'msg-bubble__bubble--raw'       : '',
          isSending  ? 'msg-bubble__bubble--streaming' : '',
        ].filter(Boolean).join(' ')}>
          <p className="msg-bubble__text">{displayText}</p>
        </div>

        {/* Reframe Pill: Badge + Original Toggle */}
        {isReframed && (
          <div className="msg-bubble__reframe-row">
            <span
              className="msg-bubble__reframe-badge"
              title={`Reframed for your personality: ${recipientType}`}
            >
              <LensIcon />
              <span>Adapted for {recipientType || 'your lens'}</span>
            </span>
            <button
              type="button"
              className={`msg-bubble__raw-toggle ${showRaw ? 'msg-bubble__raw-toggle--active' : ''}`}
              onClick={() => setShowRaw(v => !v)}
              title={showRaw ? 'Show adapted message' : 'Show original message'}
            >
              {showRaw ? 'Show adapted' : 'See original'}
            </button>
          </div>
        )}

        {/* Meta: Timestamp + Status */}
        <div className="msg-bubble__meta">
          <span className="msg-bubble__time">{time}</span>
          {isSending && <span className="msg-bubble__status">sending…</span>}
          {isFailed  && <span className="msg-bubble__status msg-bubble__status--failed">failed</span>}
        </div>
      </div>

      {/* Own Avatar (Right) */}
      {isOwn && (
        <div
          className="msg-bubble__avatar msg-bubble__avatar--own"
          style={{ '--profile-color': profile.color || 'var(--accent-primary)' }}
        >
          <AvatarShape shape={profile.avatar || 'circle'} color="#fff" size={16} />
        </div>
      )}
    </div>
  );
}

export default React.memo(MessageBubble, (prev, next) =>
  prev.message.id      === next.message.id      &&
  prev.message.content === next.message.content &&
  prev.message.status  === next.message.status  &&
  prev.isOwn           === next.isOwn           &&
  prev.recipientProfile?.typeKey === next.recipientProfile?.typeKey
);
