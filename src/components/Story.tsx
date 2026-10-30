import { useRef, useState, type CSSProperties } from 'react';
import {
  COMMIT_SAMPLE_SIZE,
  GEMMA_MODEL_ID,
  GITHUB_ENDPOINT_COUNT,
  ISSUE_SCAN_SIZE,
  README_MODEL_CHARS,
} from '../../shared/constants.ts';
import { useCountUp, usePrefersReducedMotion, useReveal, useScrollLine, useTilt } from './motion.ts';
import { Cobweb, Ghost, Pumpkin } from './Haunt.tsx';
import { Link } from '../router.tsx';
import { Stage } from './Stage.tsx';

const REPORT_ROWS = [
  ['Identity and metrics', 'Owner, description, language, stars, forks, dates and archived status, exactly as GitHub returns them.'],
  ['Activity assessment', 'A category computed from the last push date, shown with the dates and the rule behind it. A signal, not proof that a project is abandoned.'],
  ['Findings', 'Positive signals, potential concerns and unknowns. Each cites evidence IDs, states a confidence level and names a step to verify it.'],
  ['Contribution missions', 'Three suggestions with difficulty, steps and a note on what to check first. When the evidence is thin, a mission says it is a general exploration task.'],
  ['Source ledger', 'Every cited record with its date, an excerpt and a link to the real GitHub page.'],
] as const;

const STEPS = [
  {
    title: 'Validate the input',
    text: 'Only github.com owner/repository references are accepted. Extra path segments, other hosts, credentials and odd schemes are rejected before anything is fetched.',
    tech: 'owner/repo → strict parser',
  },
  {
    title: 'Retrieve from GitHub',
    text: 'Metadata, the 30 latest commits, the README and open issues are requested separately. One of the last three failing does not stop the investigation; it is recorded as unavailable.',
    tech: 'api.github.com only · timeouts · size limits',
  },
  {
    title: 'Build evidence records',
    text: 'The server numbers each record and builds its GitHub link itself. Day counts and the activity category are computed here from GitHub timestamps, and marked as computed.',
    tech: 'E01 … En',
  },
  {
    title: 'Ask Gemma',
    text: 'A bounded evidence bundle goes to the model with a fixed JSON schema. If the answer is malformed, the same model gets one retry with the validation errors.',
    tech: `${GEMMA_MODEL_ID} · Gemini API · temperature 0.2`,
  },
  {
    title: 'Validate and show',
    text: 'Unknown evidence IDs are removed. Claims that cite nothing valid are marked unsupported. Links come only from the server’s records, never from model text.',
    tech: 'schema check → report',
  },
] as const;

const SIGNALS = [
  { name: 'Recently active', range: '0 – 90 days', width: 90, tone: 'green' },
  { name: 'Quieter', range: '91 – 365 days', width: 275, tone: 'amber' },
  { name: 'Little recent activity', range: 'Over 365 days', width: 400, tone: 'red' },
] as const;

const NUMBERS = [
  { to: GITHUB_ENDPOINT_COUNT, label: 'GitHub endpoints', note: 'Metadata, commits, README, issues' },
  { to: COMMIT_SAMPLE_SIZE, label: 'Recent commits', note: 'The newest sample, not the full history' },
  { to: ISSUE_SCAN_SIZE, label: 'Items scanned for issues', note: 'Pull requests are excluded from the list' },
  { to: README_MODEL_CHARS, label: 'README characters', note: 'The most Gemma is given to read' },
] as const;

const RECORD_FIELDS = [
  ['id', 'E07'],
  ['type', 'commit'],
  ['title', 'First line of the commit message'],
  ['date', 'Timestamp from GitHub'],
  ['excerpt', 'Short plain-text excerpt'],
  ['url', 'Link built by the server'],
] as const;

const SAFEGUARDS = [
  ['One host', 'Requests go to api.github.com only. Redirects are not followed blindly: at most two, each host-checked.'],
  ['Strict input', 'Only github.com owner/repository references pass. Other hosts, ports, credentials and extra path segments are refused.'],
  ['Bounded work', 'Ten-second timeouts, response size caps, a per-client rate limit and a cap on concurrent investigations.'],
  ['Server-side key', 'The Gemini API key never reaches the browser. The model is called from the server only.'],
  ['Plain text only', 'Repository text is rendered as text. Nothing from a README or commit message is executed or injected as markup.'],
  ['Checked output', 'Model JSON is validated against a schema, retried once on failure, and unknown evidence IDs are dropped.'],
] as const;

const FAQ = [
  [
    'Does it clone or run the repository?',
    'No. It reads public data from the GitHub REST API and never clones, builds or executes anything from the repository.',
  ],
  [
    'Can it read private repositories?',
    'No. It investigates public repositories. A private or missing repository returns a clear error instead of a partial guess.',
  ],
  [
    'What if Gemma is wrong?',
    'It can be. That is why findings cite evidence IDs, state a confidence level and name a way to verify them. Anything citing no valid evidence is marked unsupported.',
  ],
  [
    'Does it fall back to another model?',
    `No. It calls ${GEMMA_MODEL_ID} only. If that model fails, you see the error rather than an answer from something else.`,
  ],
  [
    'Is an inactive repository abandoned?',
    'Not necessarily. Some projects are finished and stable. The activity category is a date-based signal, shown with the dates behind it.',
  ],
] as const;

function Figure({ to, label, note }: { to: number; label: string; note: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = usePrefersReducedMotion();
  useCountUp(ref, to, reduce);
  return (
    <div className="figure" data-reveal>
      <p className="figure-n" aria-label={`${to.toLocaleString('en-US')} ${label}`}>
        <span ref={ref} aria-hidden="true" />
      </p>
      <p className="figure-label">{label}</p>
      <p className="figure-note">{note}</p>
    </div>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="faq">
      {FAQ.map(([question, answer], index) => {
        const isOpen = open === index;
        return (
          <div className="faq-item" key={question} data-open={isOpen || undefined} data-reveal>
            <h3>
              <button
                type="button"
                className="faq-q"
                aria-expanded={isOpen}
                aria-controls={`faq-a-${index}`}
                id={`faq-q-${index}`}
                onClick={() => setOpen(isOpen ? null : index)}
              >
                <span>{question}</span>
                <span className="faq-icon" aria-hidden="true" />
              </button>
            </h3>
            <div className="faq-a" id={`faq-a-${index}`} role="region" aria-labelledby={`faq-q-${index}`}>
              <div>
                <p>{answer}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Story() {
  const rootRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<HTMLOListElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const reduce = usePrefersReducedMotion();

  useReveal(rootRef);
  useScrollLine(stepsRef, fillRef, reduce);
  useTilt(rootRef, reduce);

  return (
    <div ref={rootRef} className="story">
      <Stage />

      <section className="band" id="overview" aria-labelledby="overview-heading">
      <Cobweb className="web--tl" />
        <div className="band-inner">
          <div className="band-head" data-reveal>
            <p className="label">What you get</p>
            <h2 id="overview-heading" className="band-title">
              One report, with the evidence kept apart from the interpretation.
            </h2>
          </div>

          <div className="legend" data-reveal>
            <p>
              <span className="tag tag--verified">Verified evidence</span> Retrieved from GitHub.
            </p>
            <p>
              <span className="tag tag--model">Gemma interpretation</span> Analysis based on that evidence.
            </p>
            <p>
              <span className="tag tag--action">Suggested action</span> Something to check or try, not a confirmed defect.
            </p>
          </div>

          <ol className="rows">
            {REPORT_ROWS.map(([title, text], index) => (
              <li className="row" key={title} data-reveal style={{ '--i': index } as CSSProperties}>
                <span className="row-n mono">{String(index + 1).padStart(2, '0')}</span>
                <h3 className="row-title">{title}</h3>
                <p className="row-text">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="band band--signals" id="signals" aria-labelledby="signals-heading">
        <Ghost className="deco-ghost deco-ghost--r" />
      <Cobweb className="web--tr" />
        <div className="band-inner">
          <div className="band-head" data-reveal>
            <p className="label">Reading activity</p>
            <h2 id="signals-heading" className="band-title">
              Activity is a signal drawn from dates, and the dates are always shown.
            </h2>
          </div>
          <div className="signal" data-reveal>
            <div className="signal-bar" aria-hidden="true">
              {SIGNALS.map((signal, index) => (
                <span
                  key={signal.name}
                  className={`signal-seg signal-seg--${signal.tone}`}
                  style={{ flexGrow: signal.width, '--i': index } as CSSProperties}
                />
              ))}
            </div>
            <ul className="signal-key">
              {SIGNALS.map((signal) => (
                <li key={signal.name}>
                  <span className={`sw sw--${signal.tone}`} aria-hidden="true" />
                  <span className="signal-name">{signal.name}</span>
                  <span className="mono signal-range">{signal.range} since last push</span>
                </li>
              ))}
            </ul>
            <p className="signal-note">
              Segment widths are illustrative, not to scale. Archived repositories are labelled archived whatever their dates. The last push
              can come from any branch, so it can be newer than the latest commit on the default branch.
            </p>
          </div>
        </div>
      </section>

      <section className="band band--read" id="read" aria-labelledby="read-heading">
        <Ghost className="deco-ghost deco-ghost--l" />
      <Cobweb className="web--tl" />
        <div className="band-inner">
          <div className="band-head" data-reveal>
            <p className="label">What gets read</p>
            <h2 id="read-heading" className="band-title">
              A small, bounded slice of the repository, and the limits are stated.
            </h2>
          </div>
          <div className="figures">
            {NUMBERS.map((item) => (
              <Figure key={item.label} to={item.to} label={item.label} note={item.note} />
            ))}
          </div>
          <div className="record" data-reveal>
            <div className="record-head">
              <p className="label">Anatomy of an evidence record</p>
              <p className="record-sub">Every claim in the report points to one of these.</p>
            </div>
            <div className="record-card" data-tilt>
              <dl>
                {RECORD_FIELDS.map(([key, value]) => (
                  <div key={key}>
                    <dt className="mono">{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </section>

      <section className="band band--how" id="how" aria-labelledby="how-heading">
      <Cobweb className="web--tr" />
        <div className="band-inner">
          <div className="band-head" data-reveal>
            <p className="label">How it works</p>
            <h2 id="how-heading" className="band-title">
              Facts come from GitHub. Interpretation comes from Gemma. The server keeps them apart.
            </h2>
          </div>

          <ol ref={stepsRef} className="how-steps">
            <li className="how-line" aria-hidden="true">
              <span ref={fillRef} className="how-line-fill" />
            </li>
            {STEPS.map((step, index) => (
              <li className="how-step" key={step.title} data-reveal>
                <span className="how-node mono" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="how-card">
                  <div className="how-card-inner" data-tilt>
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                    <p className="how-tech mono">{step.tech}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <p className="band-note" data-reveal>
            Activity categories are heuristics based on dates. They are not proof of abandonment. Model output can be wrong, so every
            finding and mission should be checked against its linked sources before you act on it.
          </p>
        </div>
      </section>

      <section className="band band--safe" id="safeguards" aria-labelledby="safe-heading">
        <Ghost className="deco-ghost deco-ghost--r" />
      <Cobweb className="web--tl" />
        <div className="band-inner band-inner--split">
          <div>
            <div className="band-head" data-reveal>
              <p className="label">Safeguards</p>
              <h2 id="safe-heading" className="band-title">
                Built to fetch narrowly and fail visibly.
              </h2>
            </div>
            <dl className="ledger">
              {SAFEGUARDS.map(([term, text], index) => (
                <div className="ledger-row" key={term} data-reveal style={{ '--i': index % 3 } as CSSProperties}>
                  <dt>{term}</dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <div className="band-head" data-reveal>
              <p className="label">Questions</p>
              <h2 className="band-title">Plain answers.</h2>
            </div>
            <Faq />
          </div>
        </div>
      </section>

      <section className="outro" id="start" aria-labelledby="outro-heading">
        <Cobweb className="web--tl" />
        <Cobweb className="web--tr" />
        <Pumpkin className="deco-pumpkin deco-pumpkin--l" />
        <Pumpkin className="deco-pumpkin deco-pumpkin--r" />
        <Ghost className="deco-ghost deco-ghost--l" />
        <div className="outro-inner">
          <p className="label" data-reveal>
            Your turn
          </p>
          <h2 id="outro-heading" className="outro-title" data-reveal style={{ '--i': 1 } as CSSProperties}>
            Is it still alive? Go and find out.
          </h2>
          <p className="outro-text" data-reveal style={{ '--i': 2 } as CSSProperties}>
            Paste a public GitHub URL. You get dates, links and suggestions to verify, not a verdict.
          </p>
          <div data-reveal style={{ '--i': 3 } as CSSProperties}>
            <Link to="/investigate" className="btn btn--light outro-btn">
              Investigate a repository
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
