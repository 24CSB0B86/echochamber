/**
 * src/components/AvatarShape.jsx
 * Memoized SVG avatar component — renders the personality shape at any size.
 *
 * Why React.memo?
 *   This component renders inside every message bubble AND in the online users
 *   panel. Without memo, every new message or presence update re-renders ALL
 *   avatar instances in the list. With memo, re-renders only when color or shape
 *   actually changes — which is essentially never during a chat session.
 */

import React from 'react';
import { SHAPES } from '../utils/avatarShapes';

function AvatarShape({ shape = 'circle', color = '#7c6ff7', size = 28, className = '' }) {
  const s   = SHAPES[shape] || SHAPES.circle;
  const Tag = s.type;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill={color}
      className={className}
      aria-hidden="true"
    >
      <Tag {...s.props} />
    </svg>
  );
}

// Only re-render when the visual props actually change.
// shape and color are set at onboarding and never change during a session.
export default React.memo(AvatarShape, (prev, next) =>
  prev.shape === next.shape &&
  prev.color === next.color &&
  prev.size  === next.size
);
