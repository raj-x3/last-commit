import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiErrorBody, HealthBody, InvestigationReport, ProgressEvent, Stage } from '../shared/types.ts';
import { ApiFailure, fetchHealth, investigateRepository } from './api.ts';
import { Atmosphere, Cobweb, Ghost, Halloween, Pumpkin } from './components/Haunt.tsx';
import { Terminal } from './components/Terminal.tsx';
import { EmptyWorkspace } from './components/EmptyWorkspace.tsx';
import { ErrorPanel } from './components/ErrorPanel.tsx';
import { Footer } from './components/Footer.tsx';
import { Header } from './components/Header.tsx';
import { InvestigateForm } from './components/InvestigateForm.tsx';
import type { StageInfo } from './components/Progress.tsx';
import { Report } from './components/Report.tsx';
import { Story } from './components/Story.tsx';
import { STAGES } from './format.ts';
import { useLocation } from './router.tsx';

type Stages = Record<Stage, StageInfo>;

const freshStages = (): Stages => ({
  repository: { state: 'pending' },
  commits: { state: 'pending' },
  readme: { state: 'pending' },
  issues: { state: 'pending' },
  analysis: { state: 'pending' },
});

type Status = 'idle' | 'running' | 'done' | 'failed';

const TITLES = {
  '/': 'Last Commit — repository investigations',
  '/investigate': 'Investigate a repository — Last Commit',
} as const;

export function App() {
  const { route, hash, key, navigated } = useLocation();
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [stages, setStages] = useState<Stages>(freshStages);
  const [report, setReport] = useState<InvestigationReport | null>(null);
  const [error, setError] = useState<ApiErrorBody | null>(null);
  const [health, setHealth] = useState<HealthBody | null>(null);
  const [healthChecked, setHealthChecked] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchHealth(controller.signal).then((body) => {
      if (controller.signal.aborted) return;
      setHealth(body);
      setHealthChecked(true);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Each page is its own screen: set the title, then land at the top, at the hash target, or in the input.
  const firstRender = useRef(true);
  useEffect(() => {
    document.title = TITLES[route];
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (target) target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    else window.scrollTo(0, 0);
    if (route === '/investigate' && navigated) document.getElementById('repo-input')?.focus({ preventScroll: true });
  }, [key, route, hash, navigated]);

  // Move focus to the outcome so keyboard and screen reader users land on it.
  useEffect(() => {
    if (status === 'done') reportRef.current?.focus({ preventScroll: false });
    if (status === 'failed') errorRef.current?.focus({ preventScroll: false });
  }, [status]);

  const onEvent = useCallback((event: ProgressEvent) => {
    if (event.type !== 'stage') return;
    setStages((prev) => ({
      ...prev,
      [event.stage]: { state: event.state, detail: event.detail, ms: event.ms },
    }));
  }, []);

  const start = useCallback(async () => {
    const value = input.trim();
    if (!value) {
      setError({ code: 'invalid_input', message: 'Enter a GitHub repository URL.', hint: 'Use https://github.com/owner/repository or owner/repository.' });
      setStatus('failed');
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('running');
    setError(null);
    setReport(null);
    setStages(freshStages());
    try {
      const result = await investigateRepository(value, onEvent, controller.signal);
      if (controller.signal.aborted) return;
      setReport(result);
      setStatus('done');
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof ApiFailure) setError(err.body);
      else setError({ code: 'internal', message: 'The connection to the server was lost.', hint: 'Check that the server is running, then retry.' });
      setStatus('failed');
    }
  }, [input, onEvent]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStatus('idle');
    setStages(freshStages());
  }, []);

  const inputError =
    status === 'failed' && error && (error.code === 'invalid_input' || error.code === 'repo_not_found' || error.code === 'repo_private')
      ? { message: error.message, hint: error.hint }
      : null;
  const showStandaloneError = status === 'failed' && error && !inputError;
  const showProgress = status === 'running' || (status === 'failed' && STAGES.some((s) => stages[s].state !== 'pending'));

  return (
    <>
      <a className="skip" href={route === '/' ? '#overview' : '#workspace'}>
        {route === '/' ? 'Skip to content' : 'Skip to investigation'}
      </a>
      <Atmosphere />
      <Halloween />
      <Header health={health} healthChecked={healthChecked} route={route} />
      {route === '/' ? (
        <Story />
      ) : (
        <>
          <section className="page-hero" aria-labelledby="page-title">
            <Cobweb className="web--tl" />
            <Cobweb className="web--tr" />
            <Pumpkin className="deco-pumpkin deco-pumpkin--l" />
            <Ghost className="deco-ghost deco-ghost--r" />
            <p className="label">New investigation</p>
            <h1 id="page-title" className="page-title">
              Pick a repository you suspect has gone quiet.
            </h1>
            <p className="page-sub">Paste a public GitHub URL and read what the evidence shows.</p>
          </section>
      <main className="shell" id="workspace">
        <InvestigateForm
          value={input}
          onChange={setInput}
          onSubmit={() => void start()}
          onCancel={cancel}
          running={status === 'running'}
          error={inputError}
        />
        {health && !health.modelConfigured ? (
          <div className="notice notice--warn" role="status">
            <p className="notice-title">GEMINI_API_KEY is not set on the server.</p>
            <p>
              Repository data can be retrieved, but no report can be produced until the key is configured. Add it as a server secret
              and restart. It is required for <span className="mono">{health.model}</span>.
            </p>
          </div>
        ) : null}
        {!healthChecked || health ? null : (
          <div className="notice notice--error" role="status">
            <p className="notice-title">The investigation server is unreachable.</p>
            <p>Start it with npm run dev (or npm start after a build) and reload.</p>
          </div>
        )}
        {showProgress ? <Terminal stages={stages} target={input.trim()} /> : null}
        {showStandaloneError && error ? <ErrorPanel error={error} panelRef={errorRef} /> : null}
        {status === 'done' && report ? (
          <div className="report-wrap enter" tabIndex={-1} ref={reportRef}>
            <Report report={report} />
          </div>
        ) : null}
        {status === 'idle' || (status === 'failed' && !showProgress && !showStandaloneError) ? <EmptyWorkspace /> : null}
      </main>
        </>
      )}
      <Footer />
    </>
  );
}
