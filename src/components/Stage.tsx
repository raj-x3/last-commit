import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { GEMMA_MODEL_ID } from '../../shared/constants.ts';
import { createCinema } from '../cinema/engine.ts';
import { Link } from '../router.tsx';
import { clamp01, damp, smooth, usePrefersReducedMotion } from './motion.ts';

/**
 * The opening: one continuous journey down a rotating helix. Scroll sets how deep the camera is;
 * the spiral spins on its own. The words are DOM text positioned in the same coordinate system:
 * each one starts small and far, reaches full size at its milestone, then passes the camera.
 */

const CENTERS = [0, 0.25, 0.5, 0.75, 1] as const;
const HALF_WIDTH = 0.13;
const RAIL = ['Introduction', 'Evidence', 'Interpretation', 'Report', 'Destination'] as const;

const MILESTONES = [
  {
    kicker: '01 · Milestone',
    word: 'EVIDENCE',
    lede: 'Four sources, straight from the GitHub API.',
    text: 'Repository metadata, recent commits, the README and open issues. Each one becomes a numbered evidence record with a real link back to GitHub. If one source fails, the others still arrive.',
  },
  {
    kicker: '02 · Milestone',
    word: 'INTERPRETATION',
    lede: 'Gemma reads the evidence and nothing else.',
    text: `${GEMMA_MODEL_ID} receives only those records and returns structured JSON. The server checks it against a schema and drops any evidence ID it did not create.`,
  },
  {
    kicker: '03 · Milestone',
    word: 'REPORT',
    lede: 'Findings, missions and a ledger you can open.',
    text: 'Activity signals show the dates behind them. Missions are suggestions to verify before you start, never confirmed defects. Every claim points to a source you can check.',
  },
] as const;

/** Where a milestone is on screen for a given progress: -1 far ahead, 0 in place, +1 passing the camera. */
function local(progress: number, index: number): number {
  return (progress - (CENTERS[index] as number)) / HALF_WIDTH;
}

export function Stage() {
  const reduce = usePrefersReducedMotion();
  const [failed, setFailed] = useState(false);
  const staticLayout = reduce || failed;
  const stageRef = useRef<HTMLElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const depthRef = useRef<HTMLSpanElement>(null);
  const [beat, setBeat] = useState(0);
  const beatRef = useRef(0);

  useEffect(() => {
    const stage = stageRef.current;
    const pin = pinRef.current;
    const canvas = canvasRef.current;
    if (!stage || !pin || !canvas || failed) return;

    const lite = window.matchMedia('(max-width: 899px)').matches || (navigator.hardwareConcurrency ?? 8) <= 4;
    const engine = createCinema(canvas, { lite, onLost: () => setFailed(true) });
    if (!engine) {
      console.warn('Last Commit: the 3D journey could not start (WebGL unavailable or a shader failed). Showing the static layout.');
      setFailed(true);
      return;
    }

    if (reduce) {
      // One still frame from inside the tunnel. No loop, no scroll coupling.
      const draw = () => {
        engine.resize();
        engine.render({ progress: 0.1, speed: 0, pointerX: 0, pointerY: 0, time: 4200 });
      };
      draw();
      window.addEventListener('resize', draw);
      return () => {
        window.removeEventListener('resize', draw);
        engine.dispose();
      };
    }

    const words: HTMLElement[] = [...pin.querySelectorAll<HTMLElement>('[data-ms]')];
    const lastWrite: string[] = words.map(() => '');
    document.documentElement.dataset.cinema = '1';

    // Layout is measured here, on resize only. The frame loop never reads layout.
    let stageTop = 0;
    let range = 1;
    let hh = 0;
    const measure = () => {
      hh = document.querySelector('.masthead')?.getBoundingClientRect().height ?? 0;
      stageTop = stage.getBoundingClientRect().top + window.scrollY;
      range = Math.max(1, stage.offsetHeight - (window.innerHeight - hh));
      engine.resize();
    };
    measure();

    let frame = 0;
    let visible = true;
    let current = -1;
    let velocity = 0;
    let px = 0;
    let py = 0;
    let pvx = 0;
    let pvy = 0;
    let targetX = 0;
    let targetY = 0;
    let lastDepth = -1;
    let last = performance.now();

    const place = (progress: number) => {
      words.forEach((el, i) => {
        const u = local(progress, i);
        const a = Math.abs(u);
        const opacity = a >= 1 ? 0 : 1 - smooth(clamp01((a - 0.4) / 0.6));
        // Far ahead: small and deep. Past the camera: large and close, fading as it goes.
        const z = u < 0 ? u * 760 : u * 520;
        const value = opacity < 0.004 ? 'hidden' : `${opacity.toFixed(3)}|${z.toFixed(1)}|${(u * -22).toFixed(1)}|${(u * 5).toFixed(2)}`;
        if (value === lastWrite[i]) return;
        lastWrite[i] = value;
        const inner = el.firstElementChild as HTMLElement | null;
        if (!inner) return;
        if (value === 'hidden') {
          inner.style.visibility = 'hidden';
          inner.style.opacity = '0';
          return;
        }
        inner.style.visibility = 'visible';
        inner.style.opacity = opacity.toFixed(3);
        inner.style.transform = `translate3d(0, ${(u * -22).toFixed(1)}px, ${z.toFixed(1)}px) rotateX(${(u * 5).toFixed(2)}deg)`;
      });
    };

    const tick = (now: number) => {
      frame = 0;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const target = clamp01((window.scrollY - (stageTop - hh)) / range);
      if (current < 0) current = target;
      else [current, velocity] = damp(current, target, velocity, 0.28, dt);
      [px, pvx] = damp(px, targetX, pvx, 0.4, dt);
      [py, pvy] = damp(py, targetY, pvy, 0.4, dt);

      const progress = clamp01(current);
      engine.render({ progress, speed: Math.abs(velocity), pointerX: px, pointerY: py, time: now });
      place(progress);

      const depthEl = depthRef.current;
      if (depthEl && Math.abs(progress - lastDepth) > 0.0008) {
        lastDepth = progress;
        depthEl.style.transform = `scaleX(${progress.toFixed(4)})`;
      }
      const next = Math.round(progress * (CENTERS.length - 1));
      if (next !== beatRef.current) {
        beatRef.current = next;
        setBeat(next);
      }
      if (visible) frame = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = Boolean(entry?.isIntersecting);
        if (visible) document.documentElement.dataset.cinema = '1';
        else delete document.documentElement.dataset.cinema;
        if (visible && !frame) {
          last = performance.now();
          frame = requestAnimationFrame(tick);
        }
      },
      { rootMargin: '120px 0px' },
    );
    observer.observe(stage);

    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const onPointer = (event: PointerEvent) => {
      const rect = pin.getBoundingClientRect();
      targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    const onLeave = () => {
      targetX = 0;
      targetY = 0;
    };
    if (fine) {
      pin.addEventListener('pointermove', onPointer, { passive: true });
      pin.addEventListener('pointerleave', onLeave);
    }
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(stage);
    const header = document.querySelector('.masthead');
    if (header) resizeObserver.observe(header);
    window.addEventListener('resize', measure);
    frame = requestAnimationFrame(tick);

    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      if (frame) cancelAnimationFrame(frame);
      pin.removeEventListener('pointermove', onPointer);
      pin.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('resize', measure);
      delete document.documentElement.dataset.cinema;
      for (const el of words) {
        const inner = el.firstElementChild as HTMLElement | null;
        if (inner) inner.removeAttribute('style');
      }
      engine.dispose();
    };
  }, [reduce, failed]);

  const hold = (index: number) => !staticLayout && beat !== index;

  return (
    <section
      ref={stageRef}
      className={`cine${staticLayout ? ' cine--static' : ''}`}
      aria-label="Introduction: a journey into a repository"
      data-beat={beat}
    >
      <div ref={pinRef} className="cine-pin">
        <canvas ref={canvasRef} className="cine-canvas" aria-hidden="true" hidden={failed} />
        <div className="cine-veil" aria-hidden="true" />

        <div className="ms-layer">
          <div className="ms ms--intro" data-ms data-active={beat === 0 || undefined} inert={hold(0)}>
            <div className="ms-in">
              <p className="ms-kicker intro-in" style={{ '--d': 0 } as CSSProperties}>
                Is this repository still alive?
              </p>
              <h1 className="hero-mark" aria-label="Last Commit">
                {['LAST', 'COMMIT'].map((word, w) => (
                  <span className="hero-word" aria-hidden="true" key={word}>
                    {[...word].map((ch, i) => (
                      <span className="hero-ch" key={i} style={{ '--i': i + w * 4 } as CSSProperties}>
                        {ch}
                      </span>
                    ))}
                  </span>
                ))}
              </h1>
              <p className="ms-text intro-in" style={{ '--d': 9 } as CSSProperties}>
                Paste a public GitHub URL. Last Commit searches a repository’s dates, README, commits and open issues for signs of life,
                shows what that evidence does and does not say, and suggests where a new contributor could help.
              </p>
              <div className="ms-actions intro-in" style={{ '--d': 11 } as CSSProperties}>
                <Link to="/investigate" className="btn btn--light">
                  Investigate a repository
                </Link>
                <Link to="/#how" className="link-light">
                  How it works <span aria-hidden="true">↓</span>
                </Link>
              </div>
            </div>
          </div>

          {MILESTONES.map((item, index) => (
            <div className="ms" key={item.word} data-ms data-active={beat === index + 1 || undefined} inert={hold(index + 1)}>
              <div className="ms-in" data-tone={index}>
                <p className="ms-kicker">{item.kicker}</p>
                <h2 className="ms-word">{item.word}</h2>
                <p className="ms-lede">{item.lede}</p>
                <p className="ms-text">{item.text}</p>
              </div>
            </div>
          ))}

          <div className="ms ms--end" data-ms data-active={beat === 4 || undefined} inert={hold(4)}>
            <div className="ms-in">
              <p className="ms-kicker">04 · Destination</p>
              <h2 className="ms-word ms-word--end">The journey ends where yours begins.</h2>
              <p className="ms-text">
                Take a public repository you suspect has gone quiet and read what its own history says about it. Everything is cited, and
                everything can be checked.
              </p>
              <div className="ms-actions">
                <Link to="/investigate" className="btn btn--light">
                  Investigate a repository
                </Link>
                <Link to="/#how" className="link-light">
                  How it works <span aria-hidden="true">↓</span>
                </Link>
              </div>
            </div>
          </div>
        </div>

        <ol className="rail" aria-hidden="true">
          {RAIL.map((name, index) => (
            <li key={name} data-on={beat === index || undefined}>
              <span className="rail-tick" />
              <span className="rail-name">{name}</span>
            </li>
          ))}
        </ol>

        <p className="scroll-cue" aria-hidden="true" data-hide={beat > 0 || undefined}>
          <span>Scroll to enter</span>
          <span className="scroll-line" />
        </p>

        <div className="depth" aria-hidden="true">
          <span className="depth-label">Depth</span>
          <span className="depth-track">
            <span ref={depthRef} className="depth-fill" />
          </span>
        </div>
      </div>
    </section>
  );
}
