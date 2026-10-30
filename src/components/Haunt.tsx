import { useEffect, useRef, type CSSProperties } from 'react';
import { damp, usePrefersReducedMotion } from './motion.ts';

/* ---------- Cobweb: strands from a corner, with sagging rings ---------- */

function buildWeb(): string {
  const strands = 6;
  const parts: string[] = [];
  const point = (r: number, deg: number): [number, number] => [
    +(r * Math.cos((deg * Math.PI) / 180)).toFixed(1),
    +(r * Math.sin((deg * Math.PI) / 180)).toFixed(1),
  ];
  for (let i = 0; i < strands; i++) {
    const [x, y] = point(200, (90 / (strands - 1)) * i);
    parts.push(`M0 0L${x} ${y}`);
  }
  for (const r of [30, 62, 96, 132, 170]) {
    for (let i = 0; i < strands - 1; i++) {
      const a = (90 / (strands - 1)) * i;
      const b = (90 / (strands - 1)) * (i + 1);
      const [x1, y1] = point(r, a);
      const [x2, y2] = point(r, b);
      const [cx, cy] = point(r * 0.84, (a + b) / 2);
      parts.push(`M${x1} ${y1}Q${cx} ${cy} ${x2} ${y2}`);
    }
  }
  return parts.join('');
}
const WEB_PATH = buildWeb();

export function Cobweb({ className = '' }: { className?: string }) {
  return (
    <svg className={`web ${className}`} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <path
        d={WEB_PATH}
        transform={className.includes('web--tr') ? 'translate(200 0) scale(-1 1)' : undefined}
        fill="none"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ---------- Ghost and spider drawings (original shapes) ---------- */

export function Ghost({ className = '' }: { className?: string }) {
  return (
    <svg className={`ghost ${className}`} viewBox="0 0 100 130" aria-hidden="true" focusable="false">
      <path d="M12 124V52C12 22 29 6 50 6s38 16 38 46v72l-12-12-13 12-13-12-13 12-13-12z" fill="currentColor" />
      <ellipse className="ghost-eye" cx="38" cy="50" rx="6" ry="9" />
      <ellipse className="ghost-eye" cx="62" cy="50" rx="6" ry="9" />
      <ellipse className="ghost-eye" cx="50" cy="76" rx="7" ry="10" />
    </svg>
  );
}

export function SpiderDrawing() {
  const legs = 'M24 30Q10 20 4 28M23 34Q8 32 3 42M23 38Q10 44 7 54M25 42Q16 52 14 58';
  return (
    <svg className="spider-art" viewBox="0 0 60 64" aria-hidden="true" focusable="false">
      <g className="spider-legs" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d={legs} />
        <path d={legs} transform="translate(60 0) scale(-1 1)" />
      </g>
      <ellipse cx="30" cy="38" rx="10" ry="13" fill="currentColor" />
      <circle cx="30" cy="22" r="7" fill="currentColor" />
      <circle cx="27.5" cy="21" r="1.4" fill="#ff6b5e" />
      <circle cx="32.5" cy="21" r="1.4" fill="#ff6b5e" />
    </svg>
  );
}

/* ---------- Atmosphere: fog, drifting ghosts, a lantern that follows a mouse pointer ---------- */

const DRIFTERS = [
  { top: '18%', size: 74, dur: 58, delay: -8, o: 0.1 },
  { top: '56%', size: 120, dur: 82, delay: -40, o: 0.08 },
  { top: '78%', size: 54, dur: 46, delay: -22, o: 0.11 },
] as const;

export function Atmosphere() {
  const reduce = usePrefersReducedMotion();
  const lanternRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const lantern = lanternRef.current;
    if (!lantern || reduce || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let vx = 0;
    let vy = 0;
    let tx = x;
    let ty = y;
    let frame = 0;
    let last = 0;
    let shown = false;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      [x, vx] = damp(x, tx, vx, 0.18, dt);
      [y, vy] = damp(y, ty, vy, 0.18, dt);
      lantern.style.transform = `translate3d(${(x - 260).toFixed(1)}px, ${(y - 260).toFixed(1)}px, 0)`;
      if (Math.abs(x - tx) > 0.4 || Math.abs(y - ty) > 0.4 || Math.abs(vx) > 0.4 || Math.abs(vy) > 0.4) {
        frame = requestAnimationFrame(tick);
      } else frame = 0;
    };
    const onMove = (event: PointerEvent) => {
      tx = event.clientX;
      ty = event.clientY;
      if (!shown) {
        shown = true;
        x = tx;
        y = ty;
        lantern.dataset.on = '1';
      }
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    const onLeave = () => {
      shown = false;
      delete lantern.dataset.on;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [reduce]);

  return (
    <div className="atmos" aria-hidden="true">
      <div className="fog fog--a" />
      <div className="fog fog--b" />
      {DRIFTERS.map((d, i) => (
        <div
          className="drifter"
          key={i}
          style={{ top: d.top, '--s': `${d.size}px`, '--dur': `${d.dur}s`, '--delay': `${d.delay}s`, '--o': d.o } as CSSProperties}
        >
          <Ghost />
        </div>
      ))}
      <div ref={lanternRef} className="lantern" />
      <div className="vignette" />
    </div>
  );
}

/* ---------- Halloween extras (original shapes) ---------- */

export function Bat({ className = '' }: { className?: string }) {
  return (
    <svg className={`bat ${className}`} viewBox="0 0 120 56" aria-hidden="true" focusable="false">
      <g className="bat-wing bat-wing--l">
        <path d="M60 26C48 8 28 6 4 12c8 4 10 10 9 18 6-5 12-5 17 1 3-6 9-9 16-6 4-3 9-1 14 1z" fill="currentColor" />
      </g>
      <g className="bat-wing bat-wing--r">
        <path d="M60 26c12-18 32-20 56-14-8 4-10 10-9 18-6-5-12-5-17 1-3-6-9-9-16-6-4-3-9-1-14 1z" fill="currentColor" />
      </g>
      <ellipse cx="60" cy="31" rx="7" ry="11" fill="currentColor" />
      <path d="M54 22l-3-11 8 6zM66 22l3-11-8 6z" fill="currentColor" />
      <circle cx="57.5" cy="28" r="1.3" fill="#ff8a2a" />
      <circle cx="62.5" cy="28" r="1.3" fill="#ff8a2a" />
    </svg>
  );
}

export function Pumpkin({ className = '' }: { className?: string }) {
  return (
    <span className={`pumpkin ${className}`} aria-hidden="true">
      <span className="pumpkin-glow" />
      <svg viewBox="0 0 120 110" focusable="false">
        <defs>
          <radialGradient id="pk-body" cx="50%" cy="40%" r="65%">
            <stop offset="0" stopColor="#d98a3a" />
            <stop offset="0.6" stopColor="#a8501c" />
            <stop offset="1" stopColor="#5c260c" />
          </radialGradient>
        </defs>
        <path d="M56 22c-2-9 2-16 10-18 0 6-2 12-6 18z" fill="#33482a" />
        <ellipse cx="32" cy="64" rx="26" ry="38" fill="#6b2f10" />
        <ellipse cx="88" cy="64" rx="26" ry="38" fill="#6b2f10" />
        <ellipse cx="46" cy="64" rx="26" ry="40" fill="url(#pk-body)" />
        <ellipse cx="74" cy="64" rx="26" ry="40" fill="url(#pk-body)" />
        <ellipse cx="60" cy="64" rx="18" ry="41" fill="#c47030" opacity="0.7" />
        <g className="pumpkin-face" fill="#2a1204">
          <path d="M32 52l14 4-12 12z" />
          <path d="M88 52l-14 4 12 12z" />
          <path d="M58 66l-6 10h12z" />
          <path d="M30 80c8 14 20 16 30 12 10 4 22 2 30-12-8 6-18 8-30 4-12 4-22 2-30-4z" />
        </g>
      </svg>
    </span>
  );
}

/** Edge ghosts and bats that live in the fixed atmosphere layer. Decorative only. */
const FLOATERS = [
  { path: 'a', size: 70, dur: 70, delay: -12, o: 0.1, hue: 'mint' },
  { path: 'b', size: 96, dur: 92, delay: -40, o: 0.085, hue: 'orange' },
  { path: 'c', size: 54, dur: 58, delay: -25, o: 0.11, hue: 'mint' },
  { path: 'd', size: 82, dur: 80, delay: -8, o: 0.07, hue: 'orange' },
  { path: 'b', size: 46, dur: 64, delay: -52, o: 0.1, hue: 'mint' },
  { path: 'a', size: 60, dur: 76, delay: -60, o: 0.07, hue: 'orange' },
  { path: 'c', size: 104, dur: 98, delay: -33, o: 0.07, hue: 'mint' },
] as const;

const BATS = [
  { top: '12%', size: 46, dur: 34, delay: -6 },
  { top: '34%', size: 34, dur: 47, delay: -24 },
  { top: '62%', size: 40, dur: 41, delay: -15 },
] as const;

export function Halloween() {
  return (
    <div className="hw" aria-hidden="true">
      {FLOATERS.map((f, i) => (
        <div
          key={`f${i}`}
          className={`floater floater--${f.path} floater--${f.hue}`}
          style={{ '--s': `${f.size}px`, '--dur': `${f.dur}s`, '--delay': `${f.delay}s`, '--o': f.o } as CSSProperties}
        >
          <Ghost />
        </div>
      ))}
      {BATS.map((b, i) => (
        <div
          key={`b${i}`}
          className="bat-lane"
          style={{ top: b.top, '--s': `${b.size}px`, '--dur': `${b.dur}s`, '--delay': `${b.delay}s` } as CSSProperties}
        >
          <div className="bat-bob">
            <Bat />
          </div>
        </div>
      ))}
    </div>
  );
}
