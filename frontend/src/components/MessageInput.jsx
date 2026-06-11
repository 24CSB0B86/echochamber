/**
 * src/components/MessageInput.jsx
 * Auto-growing textarea with personality lens indicator + client rate limiting.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import './MessageInput.css';

const MAX_CHARS          = 500;
const CLIENT_RATE_LIMIT  = 30;
const CLIENT_RATE_WINDOW = 60_000;

export default function MessageInput({ onSend, disabled, profile }) {
  const [content, setContent]       = useState('');
  const [rateLimitMsg, setRateLimitMsg] = useState(null);
  const [timeLeft, setTimeLeft]     = useState(0);
  const textareaRef  = useRef(null);

  const msgCount   = useRef(0);
  const resetTimer = useRef(null);

  // Client-side rate limiter
  const canSendRate = useCallback(() => {
    if (msgCount.current >= CLIENT_RATE_LIMIT) return false;
    msgCount.current += 1;
    if (!resetTimer.current) {
      const startTime = Date.now();
      const tick = setInterval(() => {
        const rem = Math.ceil((CLIENT_RATE_WINDOW - (Date.now() - startTime)) / 1000);
        setTimeLeft(rem > 0 ? rem : 0);
        if (rem <= 0) {
          clearInterval(tick);
          msgCount.current   = 0;
          resetTimer.current = null;
          setRateLimitMsg(null);
        }
      }, 1000);
      resetTimer.current = tick;
    }
    if (msgCount.current >= CLIENT_RATE_LIMIT) {
      setRateLimitMsg(true);
      return false;
    }
    return true;
  }, []);

  useEffect(() => () => clearInterval(resetTimer.current), []);

  const remaining = MAX_CHARS - content.length;
  const canSend   = content.trim().length > 0 && !disabled && remaining >= 0;

  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }

  function handleChange(e) {
    setContent(e.target.value.slice(0, MAX_CHARS));
    autoGrow();
  }

  const handleSend = useCallback(() => {
    if (!canSend) return;
    const trimmed = content.trim();
    if (!trimmed) return;
    if (!canSendRate()) return;
    setContent('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    onSend(trimmed);
    textareaRef.current?.focus();
  }, [canSend, canSendRate, content, onSend]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const profileColor = profile?.color;
  const lensType     = [profile?.response, profile?.medium].filter(Boolean);

  return (
    <div className="msg-input" id="message-input-container">
      {/* Rate limit notice */}
      {rateLimitMsg && (
        <div className="msg-input__rate-notice" role="alert">
          ⏳ Rate limited — wait {timeLeft}s
        </div>
      )}

      <div
        className="msg-input__wrapper"
        style={{ '--profile-color': profileColor || '#7c6ff7' }}
      >
        <textarea
          id="message-textarea"
          ref={textareaRef}
          className="msg-input__textarea"
          placeholder={disabled ? 'Connecting…' : 'Message…'}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          aria-label="Message input"
        />

        <div className="msg-input__footer">
          {content.length > 400 && (
            <span
              className={[
                'msg-input__counter',
                remaining < 50  ? 'msg-input__counter--warn' : '',
                remaining <= 20 ? 'msg-input__counter--red'  : '',
              ].filter(Boolean).join(' ')}
              aria-live="polite"
            >
              {remaining}
            </span>
          )}

          <button
            id="send-message-btn"
            className="msg-input__send-btn"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.5"
                 strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Personality lens row */}
      {lensType.length > 0 && (
        <div className="msg-input__lens">
          <span className="msg-input__lens-label">your lens</span>
          {lensType.map((t, i) => (
            <span
              key={i}
              className="msg-input__lens-tag"
              style={{ '--profile-color': profileColor || '#7c6ff7' }}
            >
              {t}
            </span>
          ))}
          <span className="msg-input__lens-hint">messages appear tuned to your style</span>
        </div>
      )}
    </div>
  );
}
