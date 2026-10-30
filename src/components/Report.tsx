import { useEffect, useRef, useState } from 'react';
import type { EvidenceRecord, Finding, InvestigationReport, Mission } from '../../shared/types.ts';
import { reportToMarkdown } from '../../shared/markdown.ts';
import { ago, dateOnly, formatNumber, paragraphs } from '../format.ts';
import { EvidenceLedger, EvidenceRefs } from './Evidence.tsx';

type ById = Map<string, EvidenceRecord>;

const FINDING_LABEL: Record<Finding['type'], string> = {
  positive: 'Positive signal',
  concern: 'Potential concern',
  unknown: 'Unknown',
};

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {paragraphs(text).map((part, index) => (
        <p key={index}>{part}</p>
      ))}
    </>
  );
}

function Identity({ report }: { report: InvestigationReport }) {
  const { repository: repo } = report;
  return (
    <header className="identity">
      <div className="identity-top">
        <h2 className="identity-name">
          <a href={repo.url} target="_blank" rel="noopener noreferrer">
            <span className="identity-owner">{repo.owner}/</span>
            {repo.name}
          </a>
        </h2>
        {repo.archived ? <span className="tag tag--warn">Archived</span> : null}
        {repo.isFork ? <span className="tag">Fork</span> : null}
      </div>
      {repo.description ? <p className="identity-desc">{repo.description}</p> : <p className="identity-desc muted">No description set.</p>}
      <dl className="metrics">
        <div>
          <dt>Language</dt>
          <dd>{repo.language ?? '—'}</dd>
        </div>
        <div>
          <dt>Stars</dt>
          <dd className="mono">{formatNumber(repo.stars)}</dd>
        </div>
        <div>
          <dt>Forks</dt>
          <dd className="mono">{formatNumber(repo.forks)}</dd>
        </div>
        <div>
          <dt>Open issues + PRs</dt>
          <dd className="mono">{formatNumber(repo.openIssuesCount)}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd className="mono">{dateOnly(repo.createdAt)}</dd>
        </div>
        <div>
          <dt>Last push</dt>
          <dd className="mono">{dateOnly(repo.pushedAt)}</dd>
        </div>
        <div>
          <dt>License</dt>
          <dd className="mono">{repo.license ?? '—'}</dd>
        </div>
        <div>
          <dt>Archived</dt>
          <dd className="mono">{repo.archived ? 'Yes' : 'No'}</dd>
        </div>
      </dl>
    </header>
  );
}

function Activity({ report, byId }: { report: InvestigationReport; byId: ById }) {
  const { activity, analysis } = report;
  const ai = analysis.activityInterpretation;
  return (
    <section className="section" aria-labelledby="activity-heading">
      <div className="section-head">
        <h2 id="activity-heading">Activity assessment</h2>
        <span className="tag tag--signal" data-category={activity.category}>
          {activity.label}
        </span>
      </div>
      <div className="block block--verified">
        <p className="block-label">
          <span className="tag tag--verified">Verified evidence</span> Computed from GitHub timestamps
        </p>
        <dl className="facts">
          <div>
            <dt>Last push</dt>
            <dd className="mono">
              {dateOnly(activity.lastPushAt)}
              {activity.daysSincePush !== null ? <span className="muted"> · {ago(activity.daysSincePush)}</span> : null}
            </dd>
          </div>
          <div>
            <dt>Latest sampled commit</dt>
            <dd className="mono">
              {activity.lastCommitAt ? dateOnly(activity.lastCommitAt) : 'unavailable'}
              {activity.daysSinceLastCommit !== null ? <span className="muted"> · {ago(activity.daysSinceLastCommit)}</span> : null}
            </dd>
          </div>
          {activity.windows.map((w) => (
            <div key={w.days}>
              <dt>Sampled commits, {w.days} days</dt>
              <dd className="mono">
                {w.atLeast ? '≥ ' : ''}
                {w.count}
              </dd>
            </div>
          ))}
          <div>
            <dt>Created</dt>
            <dd className="mono">{dateOnly(activity.createdAt)}</dd>
          </div>
        </dl>
        <p className="rule">{activity.rule}</p>
        {activity.caveats.length > 0 ? (
          <ul className="caveats">
            {activity.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="block block--model">
        <p className="block-label">
          <span className="tag tag--model">Gemma interpretation</span>
          {ai.supported ? null : <span className="tag tag--warn">No valid evidence cited</span>}
        </p>
        <p className="lead">{ai.assessment}</p>
        <Paragraphs text={ai.reasoning} />
        <p className="refs-line">
          <span className="label">Evidence</span> <EvidenceRefs ids={ai.evidenceIds} byId={byId} />
        </p>
      </div>
    </section>
  );
}

function Summary({ report }: { report: InvestigationReport }) {
  return (
    <section className="section" aria-labelledby="summary-heading">
      <div className="section-head">
        <h2 id="summary-heading">Project explanation</h2>
        <span className="tag tag--model">Gemma interpretation</span>
      </div>
      <div className="prose">
        <Paragraphs text={report.analysis.repositorySummary} />
      </div>
    </section>
  );
}

function Findings({ findings, byId }: { findings: Finding[]; byId: ById }) {
  return (
    <section className="section" aria-labelledby="findings-heading">
      <div className="section-head">
        <h2 id="findings-heading">Findings</h2>
        <span className="tag tag--model">Gemma interpretation</span>
      </div>
      <ol className="findings">
        {findings.map((finding, index) => (
          <li key={index} className="finding" data-type={finding.type}>
            <div className="finding-head">
              <span className="finding-type" data-type={finding.type}>
                {FINDING_LABEL[finding.type]}
              </span>
              <span className="finding-confidence mono">Confidence: {finding.confidence}</span>
              {finding.supported ? null : <span className="tag tag--warn">Unsupported</span>}
            </div>
            <h3>{finding.title}</h3>
            <Paragraphs text={finding.explanation} />
            <p className="refs-line">
              <span className="label">Evidence</span> <EvidenceRefs ids={finding.evidenceIds} byId={byId} />
            </p>
            <p className="action">
              <span className="tag tag--action">Suggested action</span> {finding.verificationStep}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Missions({ missions, byId }: { missions: Mission[]; byId: ById }) {
  return (
    <section className="section missions" aria-labelledby="missions-heading">
      <div className="section-head">
        <h2 id="missions-heading">Contribution missions</h2>
        <span className="tag tag--action">Suggested actions</span>
      </div>
      <p className="section-note">Recommendations, not confirmed defects. Verify each one on GitHub before starting.</p>
      <ol className="mission-list">
        {missions.map((mission, index) => (
          <li key={index} className="mission">
            <div className="mission-head">
              <span className="mission-n mono">{String(index + 1).padStart(2, '0')}</span>
              <span className="difficulty" data-level={mission.difficulty}>
                {mission.difficulty}
              </span>
              {mission.basis === 'general-exploration' ? <span className="tag">General exploration</span> : null}
            </div>
            <h3>{mission.title}</h3>
            <p>{mission.reason}</p>
            <div className="verify">
              <p className="label">Verify before starting</p>
              <p>{mission.verificationNote}</p>
            </div>
            <ol className="steps">
              {mission.steps.map((step, stepIndex) => (
                <li key={stepIndex}>{step}</li>
              ))}
            </ol>
            <p className="refs-line">
              <span className="label">Evidence</span> <EvidenceRefs ids={mission.evidenceIds} byId={byId} />
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RevivalPlan({ plan }: { plan: string[] }) {
  return (
    <section className="section" aria-labelledby="plan-heading">
      <div className="section-head">
        <h2 id="plan-heading">Revival plan</h2>
        <span className="tag tag--action">Suggested actions</span>
      </div>
      <ol className="plan">
        {plan.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
    </section>
  );
}

function Method({ report }: { report: InvestigationReport }) {
  return (
    <section className="section method" id="method" aria-labelledby="method-heading">
      <div className="section-head">
        <h2 id="method-heading">Method</h2>
      </div>
      <div className="method-grid">
        <div>
          <p className="label">
            <span className="tag tag--verified">Retrieved from GitHub</span>
          </p>
          <ul>
            <li>Repository metadata: description, dates, language, stars, forks, archived flag.</li>
            <li>The 30 most recent commits on the default branch.</li>
            <li>README text, decoded and cut to 8,000 characters for analysis.</li>
            <li>Open issues, with pull requests removed.</li>
          </ul>
        </div>
        <div>
          <p className="label">
            <span className="tag tag--model">Generated by {report.model.id}</span>
          </p>
          <ul>
            <li>The project explanation, findings, missions and revival plan.</li>
            <li>The server checks the output against a schema and resolves every evidence ID against its own records.</li>
            <li>Links come only from those records, never from model text.</li>
          </ul>
        </div>
      </div>
      <p className="section-note">
        Activity categories are heuristics based on dates, not proof of abandonment. Model analysis can be wrong; check it against the
        linked sources.
        {report.model.attempts > 1 ? ` The first model response failed validation, so this report comes from attempt ${report.model.attempts}.` : ''}
      </p>
    </section>
  );
}

function Actions({ report }: { report: InvestigationReport }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const flash = (state: 'copied' | 'failed') => {
    setCopied(state);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied('idle'), 2000);
  };

  const copy = async () => {
    const text = reportToMarkdown(report);
    try {
      await navigator.clipboard.writeText(text);
      flash('copied');
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      flash(ok ? 'copied' : 'failed');
    }
  };

  const download = () => {
    const blob = new Blob([reportToMarkdown(report)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${report.repository.owner}-${report.repository.name}-last-commit.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="actions">
      <button type="button" className="btn btn--secondary" onClick={copy}>
        {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy report'}
      </button>
      <button type="button" className="btn btn--secondary" onClick={download}>
        Download Markdown
      </button>
      <span className="sr-only" role="status">
        {copied === 'copied' ? 'Report copied to clipboard' : copied === 'failed' ? 'Could not copy the report' : ''}
      </span>
    </div>
  );
}

export function Report({ report }: { report: InvestigationReport }) {
  const byId: ById = new Map(report.evidence.map((record) => [record.id, record]));
  const { analysis } = report;
  return (
    <article className="report" aria-label={`Investigation of ${report.repository.fullName}`}>
      <Identity report={report} />
      <Actions report={report} />
      {report.warnings.length > 0 ? (
        <details className="notice notice--warn">
          <summary>{report.warnings.length} validation note{report.warnings.length === 1 ? '' : 's'}</summary>
          <ul className="notice-list">
            {report.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="report-grid">
        <div className="col-main">
          <Activity report={report} byId={byId} />
          <Summary report={report} />
          <Findings findings={analysis.findings} byId={byId} />
          <EvidenceLedger evidence={report.evidence} />
        </div>
        <aside className="col-side" aria-label="Contribution guidance">
          <Missions missions={analysis.missions} byId={byId} />
          <RevivalPlan plan={analysis.revivalPlan} />
        </aside>
      </div>
      <Method report={report} />
    </article>
  );
}
