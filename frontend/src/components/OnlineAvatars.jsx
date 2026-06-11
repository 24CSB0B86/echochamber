/**
 * src/components/OnlineAvatars.jsx
 * Stacked overlapping avatar circles showing who's in the room.
 * Max 5 shown + "+N" overflow chip.
 */

import React from 'react';
import AvatarShape from './AvatarShape';
import './OnlineAvatars.css';

function AvatarTooltip({ user }) {
  return (
    <div
      className="online-avatar"
      key={user.userId}
      title={user.displayName}
      aria-label={user.displayName}
      style={{ '--avatar-color': user.color || '#7c6ff7' }}
    >
      <div className="online-avatar__ring">
        <AvatarShape
          shape={user.avatar || 'circle'}
          color={user.color  || '#7c6ff7'}
          size={20}
        />
      </div>
      <span className="online-avatar__tooltip">{user.displayName}</span>
    </div>
  );
}

export default function OnlineAvatars({ users = [] }) {
  const MAX_SHOWN = 5;
  const shown    = users.slice(0, MAX_SHOWN);
  const overflow = users.length - MAX_SHOWN;

  return (
    <div className="online-avatars" aria-label={`${users.length} online`}>
      {shown.map(u => (
        <AvatarTooltip key={u.userId} user={u} />
      ))}
      {overflow > 0 && (
        <div className="online-avatar online-avatar--overflow" title={`${overflow} more online`}>
          +{overflow}
        </div>
      )}
    </div>
  );
}
