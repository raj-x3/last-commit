import type { Stage } from '../../shared/types.ts';
import { GEMMA_MODEL_ID } from '../../shared/constants.ts';
import { STAGE_LABELS, STAGES, seconds } from '../format.ts';
import { Cobweb, Ghost } from './Haunt.tsx';
import type { StageInfo } from './Progress.tsx';

/**
 * The request log, drawn as an old rusted terminal. Every line is a real pipeline stage and its real state
 * and timing. The scrolling column behind the glass is decoration (redacted, no real commit data).
 */

const TOKEN: Record<StageInfo['state'], string> = {
  pending: '[    ]',
  running: '[ .. ]',
  done: '[ OK ]',
  empty: '[ -- ]',
  unavailable: '[WARN]',
  failed: '[FAIL]',
};

const STATE_TEXT: Record<StageInfo['state'], string> = {
  pending: 'queued',
  running: 'running',
  done: 'done',
  empty: 'no data',
  unavailable: 'unavailable',
  failed: 'failed',
};

function reel(): string[] {
  let a = 7;
  const next = () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return a / 0x7fffffff;
  };
  return Array.from({ length: 44 }, () => {
    const hash = Array.from({ length: 7 }, () => '0123456789abcdef'[Math.floor(next() * 16)]).join('');
    const bar = '█'.repeat(4 + Math.floor(next() * 18));
    return `commit ${hash}  ${bar}`;
  });
}
const REEL = reel();

export function Terminal({ stages, target }: { stages: Record<Stage, StageInfo>; target: string }) {
  const running = STAGES.some((s) => stages[s].state === 'running');
  return (
    <section className="crt-scene" aria-labelledby="progress-heading">
      <h2 id="progress-heading" className="label">
        Request log
      </h2>
      <div className="crt-wrap">
        <span className="crt-echo crt-echo--a" aria-hidden="true" />
        <span className="crt-echo crt-echo--b" aria-hidden="true" />
        <span className="crt-echo crt-echo--c" aria-hidden="true" />
        <div className="crt-approach">
          <div className="crt-sway">
            <div className="crt">
              <Ghost className="crt-ghost" />
              <Cobweb className="web--tl crt-web" />
              <div className="crt-top" aria-hidden="true">
                <span className="crt-plate">GIT ARCHIVE · TTY-3</span>
                <span className="crt-lamp" data-on={running || undefined} />
              </div>
              <div className="crt-screen">
                <div className="crt-reel" aria-hidden="true">
                  <div>
                    {[...REEL, ...REEL].map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                  </div>
                </div>
                <div className="crt-text">
                  <p className="crt-prompt mono">
                    <span aria-hidden="true">$ </span>
                    <span className="crt-typed">last-commit investigate {target || 'repository'}</span>
                  </p>
                  <ol className="crt-lines mono" aria-live="polite">
                    {STAGES.map((stage) => {
                      const info = stages[stage];
                      return (
                        <li key={stage} className="crt-line" data-state={info.state}>
                          <span className="crt-token" aria-hidden="true">
                            {TOKEN[info.state]}
                          </span>
                          <span className="crt-cmd">{STAGE_LABELS[stage]}</span>
                          <span className="crt-state">{STATE_TEXT[info.state]}</span>
                          <span className="crt-detail">{info.detail}</span>
                          <span className="crt-ms">{seconds(info.ms)}</span>
                        </li>
                      );
                    })}
                  </ol>
                  <p className="crt-foot mono" aria-hidden="true">
                    {running ? `waiting on ${GEMMA_MODEL_ID} and GitHub` : 'idle'}
                    <span className="crt-caret" />
                  </p>
                </div>
                <span className="crt-scan" aria-hidden="true" />
              </div>
              <svg className="crt-rust" aria-hidden="true" focusable="false" preserveAspectRatio="none">
                <filter id="crt-rust-f" x="0" y="0" width="100%" height="100%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.035 0.05" numOctaves="3" seed="5" />
                  <feColorMatrix values="0 0 0 0 0.62  0 0 0 0 0.26  0 0 0 0 0.08  0 0 0 1.5 -0.55" />
                </filter>
                <rect width="100%" height="100%" filter="url(#crt-rust-f)" />
              </svg>
              <span className="crt-rivet crt-rivet--a" aria-hidden="true" />
              <span className="crt-rivet crt-rivet--b" aria-hidden="true" />
              <span className="crt-rivet crt-rivet--c" aria-hidden="true" />
              <span className="crt-rivet crt-rivet--d" aria-hidden="true" />
              <span className="crt-streak crt-streak--a" aria-hidden="true" />
              <span className="crt-streak crt-streak--b" aria-hidden="true" />
              <span className="crt-streak crt-streak--c" aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
