/**
 * src/components/OnlineAvatars.jsx
 * Stacked overlapping avatar circles showing who's currently in the room.
 * Displays an elegant popover tooltip below each avatar on mouse hover.
 */

import React from 'react';
import AvatarShape from './AvatarShape';
import './OnlineAvatars.css';

function AvatarTooltip({ user }) {
  const name = user.displayName || 'Anonymous';
  const traits = [user.response, user.medium].filter(Boolean).join(' · ');

  return (
    <div
      className="online-avatar"
      style={{ '--avatar-color': user.color || '#6366f1' }}
      aria-label={`${name} (${traits || 'online'})`}
    >
      <div className="online-avatar__ring">
        <AvatarShape
          shape={user.avatar || 'circle'}
          color={user.color  || '#6366f1'}
          size={18}
        />
      </div>

      {/* Refined downward-pointing tooltip */}
      <div className="online-avatar__tooltip" role="tooltip">
        <span className="online-avatar__tooltip-dot" aria-hidden="true" />
        <div className="online-avatar__tooltip-content">
          <span className="online-avatar__tooltip-name">{name}</span>
          {traits && (
            <span className="online-avatar__tooltip-trait">{traits}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OnlineAvatars({ users = [] }) {
  const MAX_SHOWN = 4;
  const shown    = users.slice(0, MAX_SHOWN);
  const overflow = users.length - MAX_SHOWN;
  const overflowUsers = overflow > 0 ? users.slice(MAX_SHOWN) : [];

  return (
    <div className="online-avatars" aria-label={`${users.length} members online`}>
      <div className="online-avatars__stack">
        {shown.map(u => (
          <AvatarTooltip key={u.userId} user={u} />
        ))}
        {overflow > 0 && (
          <div className="online-avatar online-avatar--overflow">
            +{overflow}
            <div className="online-avatar__tooltip online-avatar__tooltip--overflow" role="tooltip">
              <span className="online-avatar__tooltip-name">+{overflow} more online</span>
              <span className="online-avatar__tooltip-trait">
                {overflowUsers.map(u => u.displayName || 'Anonymous').join(', ')}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
