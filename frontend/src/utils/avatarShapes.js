/**
 * src/utils/avatarShapes.js
 * SVG shape definitions for all 5 personality avatar types.
 * Plain JS — no JSX. Used by AvatarShape.jsx which is the JSX entry point.
 */

// Each shape is defined for a 28×28 viewBox.
// Keys match the 'avatar' field stored in the user profile.
export const SHAPES = {
  circle:   { type: 'circle',  props: { cx: 14, cy: 14, r: 11 } },
  triangle: { type: 'polygon', props: { points: '14,2 26,24 2,24' } },
  square:   { type: 'rect',    props: { x: 2, y: 2, width: 24, height: 24, rx: 4 } },
  hexagon:  { type: 'polygon', props: { points: '14,1 26,7.5 26,20.5 14,27 2,20.5 2,7.5' } },
  star:     { type: 'polygon', props: { points: '14,1 17.5,10 27,10.5 20,17 22.5,27 14,21.5 5.5,27 8,17 1,10.5 10.5,10' } },
};

export const SHAPE_NAMES = Object.keys(SHAPES);
