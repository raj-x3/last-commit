import { useEffect, useRef } from 'react';
import { GEMMA_MODEL_ID } from '../../shared/constants.ts';
import type { HealthBody } from '../../shared/types.ts';
import { PROJECT_GITHUB_URL } from '../config.ts';
import { SpiderDrawing } from './Haunt.tsx';
import { Link, type Route } from '../router.tsx';
import { usePrefersReducedMotion, useScrollProgress, useSpider } from './motion.ts';

interface Props {
  health: HealthBody | null;
  healthChecked: boolean;
  route: Route;
}

export function Header({ health, healthChecked, route }: Props) {
  const state = !healthChecked ? 'checking' : !health ? 'offline' : health.modelConfigured ? 'ready' : 'no-key';
  const statusText = {
    checking: 'checking server',
    offline: 'server unreachable',
    ready: 'API key configured',
    'no-key': 'API key missing',
  }[state];

  const barRef = useRef<HTMLSpanElement>(null);
  const reduce = usePrefersReducedMotion();
  useScrollProgress(barRef, reduce);
  const threadRef = useRef<HTMLSpanElement>(null);
  const spiderRef = useRef<HTMLSpanElement>(null);
  useSpider(threadRef, spiderRef, reduce);

  // The header is sticky; publish its height so the pinned stage and anchor scrolling clear it.
  useEffect(() => {
    const header = document.querySelector<HTMLElement>('.masthead');
    if (!header) return;
    const publish = () => document.documentElement.style.setProperty('--header-h', `${header.getBoundingClientRect().height}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  return (
    <header className="masthead">
      <div className="masthead-row">
        <Link to="/" className="wordmark" aria-label="Last Commit, home">
          <span className="wordmark-name">Last Commit</span>
          <span className="descriptor">Public repository investigations</span>
        </Link>
        <nav className="masthead-nav" aria-label="Primary">
          <Link to="/#how">How it works</Link>
          <Link to="/investigate" aria-current={route === '/investigate' ? 'page' : undefined}>
            Investigate
          </Link>
          <a href={PROJECT_GITHUB_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </nav>
        <p className="model-badge" data-state={state}>
          <span className="label">Model</span>
          <span className="mono model-id">{GEMMA_MODEL_ID}</span>
          <span className="model-status">
            <span className="dot" aria-hidden="true" />
            <span className="status-text">{statusText}</span>
          </span>
        </p>
      </div>
      <span ref={barRef} className="scroll-progress" aria-hidden="true" />
      <div className="spider-rig" aria-hidden="true">
        <span ref={threadRef} className="spider-thread" />
        <span ref={spiderRef} className="spider">
          <span className="spider-sway">
            <SpiderDrawing />
          </span>
        </span>
      </div>
    </header>
  );
}
