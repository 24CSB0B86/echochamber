/**
 * src/components/RoomWeather.jsx
 * Canvas ambient background — radial gradient orbs only.
 *
 * Design: 2-4 slow breathing orbs positioned at fixed proportional coordinates.
 * Each state has its own palette, speeds, and orb counts.
 * States lerp smoothly over 3 seconds when switching.
 *
 * Performance:
 *   - Page Visibility API: RAF loop pauses when tab is hidden
 *   - prefers-reduced-motion: draws a single static gradient, no animation
 *   - Mobile: opacity reduced to 0.4 via CSS
 */

import { useEffect, useRef, useCallback } from 'react';
import './RoomWeather.css';

// ── Orb palettes per state ────────────────────────────────────────────────────
// Each orb: { x, y } (0-1 fractions), r (px), rgba, phase (rad offset)
const PALETTES = {
  calm: {
    speed: 0.008,
    orbs: [
      { x: 0.65, y: 0.35, r: 260, r2: 0.0,  g: 205.0, b: 196.0, a: 0.11, phase: 0    },
      { x: 0.20, y: 0.70, r: 220, r2: 124.0, g: 111.0, b: 247.0, a: 0.09, phase: 2.1  },
    ],
  },
  warm: {
    speed: 0.010,
    orbs: [
      { x: 0.50, y: 0.40, r: 280, r2: 247.0, g: 201.0, b: 72.0,  a: 0.18, phase: 0    },
      { x: 0.75, y: 0.65, r: 180, r2: 255.0, g: 165.0, b: 50.0,  a: 0.10, phase: 1.5  },
    ],
  },
  heated: {
    speed: 0.015,
    orbs: [
      { x: 0.40, y: 0.35, r: 300, r2: 255.0, g: 120.0, b: 50.0,  a: 0.17, phase: 0    },
      { x: 0.75, y: 0.60, r: 200, r2: 247.0, g: 60.0,  b: 60.0,  a: 0.14, phase: 1.2  },
      { x: 0.20, y: 0.55, r: 150, r2: 255.0, g: 170.0, b: 30.0,  a: 0.10, phase: 2.4  },
    ],
  },
  tense: {
    speed: 0.005,
    orbs: [
      { x: 0.50, y: 0.45, r: 280, r2: 60.0,  g: 50.0,  b: 160.0, a: 0.08, phase: 0    },
      { x: 0.25, y: 0.70, r: 180, r2: 124.0, g: 111.0, b: 247.0, a: 0.06, phase: 3.14 },
    ],
  },
  stormy: {
    speed: 0.025,
    orbs: [
      { x: 0.45, y: 0.35, r: 320, r2: 220.0, g: 50.0,  b: 50.0,  a: 0.16, phase: 0    },
      { x: 0.15, y: 0.60, r: 200, r2: 180.0, g: 30.0,  b: 100.0, a: 0.13, phase: 1.0  },
      { x: 0.80, y: 0.55, r: 160, r2: 255.0, g: 80.0,  b: 30.0,  a: 0.12, phase: 2.0  },
      { x: 0.55, y: 0.75, r: 140, r2: 200.0, g: 20.0,  b: 80.0,  a: 0.10, phase: 3.0  },
    ],
  },
};

// Linear interpolate a value
function lerp(a, b, t) { return a + (b - a) * t; }

// Lerp two palette objects — if they have different orb counts, use target count
function lerpPalette(from, to, t) {
  const count = Math.max(from.orbs.length, to.orbs.length);
  const orbs  = [];
  for (let i = 0; i < count; i++) {
    const a = from.orbs[i % from.orbs.length];
    const b = to.orbs[i % to.orbs.length];
    orbs.push({
      x:  lerp(a.x,  b.x,  t),
      y:  lerp(a.y,  b.y,  t),
      r:  lerp(a.r,  b.r,  t),
      r2: lerp(a.r2, b.r2, t),
      g:  lerp(a.g,  b.g,  t),
      b:  lerp(a.b,  b.b,  t),
      a:  lerp(a.a,  b.a,  t),
      phase: lerp(a.phase, b.phase, t),
    });
  }
  return { speed: lerp(from.speed, to.speed, t), orbs };
}

function drawFrame(canvas, palette, t) {
  const ctx = canvas.getContext('2d');
  const W   = canvas.width;
  const H   = canvas.height;

  ctx.clearRect(0, 0, W, H);

  palette.orbs.forEach(orb => {
    // Breathing: radius oscillates by ±12% with individual phase offsets
    const breath = 1 + 0.12 * Math.sin(t + orb.phase);
    const cx     = orb.x * W;
    const cy     = orb.y * H;
    const radius = orb.r * breath;

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0,   `rgba(${orb.r2}, ${orb.g}, ${orb.b}, ${orb.a})`);
    grad.addColorStop(0.5, `rgba(${orb.r2}, ${orb.g}, ${orb.b}, ${orb.a * 0.4})`);
    grad.addColorStop(1,   `rgba(${orb.r2}, ${orb.g}, ${orb.b}, 0)`);

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  });
}

export default function RoomWeather({ weatherState = 'calm' }) {
  const canvasRef       = useRef(null);
  const animationRef    = useRef(null);
  const tRef            = useRef(0);
  const fromPaletteRef  = useRef(PALETTES.calm);
  const toPaletteRef    = useRef(PALETTES.calm);
  const lerpTRef        = useRef(1);
  const isVisibleRef    = useRef(true);

  // Page Visibility API — pause RAF when tab is hidden
  useEffect(() => {
    const onVis = () => { isVisibleRef.current = !document.hidden; };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Trigger a lerp transition when weather state changes
  useEffect(() => {
    const next = PALETTES[weatherState] || PALETTES.calm;
    // Start lerp from whatever the current blended state is
    const current = lerpPalette(fromPaletteRef.current, toPaletteRef.current, lerpTRef.current);
    fromPaletteRef.current = current;
    toPaletteRef.current   = next;
    lerpTRef.current       = 0;
  }, [weatherState]);

  // Resize canvas to fill container
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height } = canvas.getBoundingClientRect();
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width  = width;
      canvas.height = height;
    }
  }, []);

  useEffect(() => {
    // Abort if user prefers reduced motion — just draw a single static frame
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      resize();
      const canvas = canvasRef.current;
      if (canvas) drawFrame(canvas, PALETTES[weatherState] || PALETTES.calm, 0);
      return;
    }

    const animate = () => {
      if (!isVisibleRef.current) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;
      resize();

      // Advance lerp (3s = ~180 frames at 60fps, step 1/180 ≈ 0.0055)
      lerpTRef.current = Math.min(1, lerpTRef.current + 0.0055);
      const palette = lerpPalette(fromPaletteRef.current, toPaletteRef.current, lerpTRef.current);

      // Advance time at speed defined by current palette
      tRef.current += palette.speed;

      drawFrame(canvas, palette, tRef.current);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, []); // eslint-disable-line

  return (
    <canvas
      ref={canvasRef}
      className="room-weather-canvas"
      aria-hidden="true"
    />
  );
}
