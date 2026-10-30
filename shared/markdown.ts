import type { EvidenceRecord, InvestigationReport } from './types.ts';

function esc(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/([\\`*_[\]<>|])/g, '\\$1');
}

function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : 'unknown';
}

function refs(ids: string[], byId: Map<string, EvidenceRecord>): string {
  if (ids.length === 0) return 'none cited';
  return ids
    .map((id) => {
      const record = byId.get(id);
      return record ? `[${id}](${record.url})` : id;
    })
    .join(', ');
}

const TYPE_LABEL: Record<EvidenceRecord['sourceType'], string> = {
  metadata: 'Metadata',
  activity: 'Computed',
  readme: 'README',
  commit: 'Commit',
  issue: 'Issue',
  status: 'Status',
};

/** Formats a validated report as Markdown. Verified evidence, model interpretation and suggested actions stay labelled. */
export function reportToMarkdown(report: InvestigationReport): string {
  const { repository: repo, activity, analysis, evidence, sections } = report;
  const byId = new Map(evidence.map((record) => [record.id, record]));
  const out: string[] = [];

  out.push(`# ${esc(repo.fullName)}: Last Commit investigation`, '');
  out.push(
    `Generated ${report.generatedAt} · Analysis by \`${report.model.id}\` via ${report.model.via} · Source: [${repo.url}](${repo.url})`,
    '',
    '> Activity signals are heuristics, not proof that a project is abandoned. Model analysis and suggested actions need human verification against the linked GitHub sources.',
    '',
  );

  out.push('## Repository', '');
  if (repo.description) out.push(esc(repo.description), '');
  out.push(
    '| Field | Value |',
    '| --- | --- |',
    `| Language | ${esc(repo.language ?? 'not reported')} |`,
    `| License | ${esc(repo.license ?? 'not reported')} |`,
    `| Stars | ${repo.stars} |`,
    `| Forks | ${repo.forks} |`,
    `| Open issues and pull requests (GitHub count) | ${repo.openIssuesCount} |`,
    `| Default branch | ${esc(repo.defaultBranch)} |`,
    `| Created | ${day(repo.createdAt)} |`,
    `| Last push | ${day(repo.pushedAt)} |`,
    `| Archived | ${repo.archived ? 'yes' : 'no'} |`,
    '',
  );

  out.push('## Activity signal', '');
  out.push(`**${activity.label}** (computed from GitHub timestamps)`, '');
  out.push(
    `- Last push: ${day(activity.lastPushAt)}${activity.daysSincePush !== null ? ` (${activity.daysSincePush} days ago)` : ''}`,
    `- Latest sampled commit: ${day(activity.lastCommitAt)}${activity.daysSinceLastCommit !== null ? ` (${activity.daysSinceLastCommit} days ago)` : ''}`,
    ...activity.windows.map((w) => `- Sampled commits in the last ${w.days} days: ${w.atLeast ? 'at least ' : ''}${w.count}`),
    `- Rule: ${esc(activity.rule)}`,
    ...activity.caveats.map((c) => `- Caveat: ${esc(c)}`),
    '',
  );
  out.push(
    '**Gemma interpretation**',
    '',
    esc(analysis.activityInterpretation.assessment),
    '',
    esc(analysis.activityInterpretation.reasoning),
    '',
    `Evidence: ${refs(analysis.activityInterpretation.evidenceIds, byId)}`,
    '',
  );

  out.push('## Project explanation (Gemma interpretation)', '', esc(analysis.repositorySummary), '');

  out.push('## Findings (Gemma interpretation)', '');
  analysis.findings.forEach((finding, index) => {
    out.push(`### ${index + 1}. ${esc(finding.title)}`, '');
    out.push(`Type: ${finding.type} · Confidence: ${finding.confidence}`, '');
    out.push(esc(finding.explanation), '');
    out.push(`Evidence: ${refs(finding.evidenceIds, byId)}`);
    if (!finding.supported) out.push('', '_No valid evidence was cited for this finding. Treat it as unverified._');
    out.push('', `Suggested action: ${esc(finding.verificationStep)}`, '');
  });

  out.push('## Contribution missions (suggested actions)', '');
  analysis.missions.forEach((mission, index) => {
    const basis = mission.basis === 'evidence-based' ? 'evidence-based' : 'general exploration task, not a known problem';
    out.push(`### ${index + 1}. ${esc(mission.title)} (${mission.difficulty}, ${basis})`, '');
    out.push(esc(mission.reason), '');
    out.push(`Verify before starting: ${esc(mission.verificationNote)}`, '');
    mission.steps.forEach((step, stepIndex) => out.push(`${stepIndex + 1}. ${esc(step)}`));
    out.push('', `Evidence: ${refs(mission.evidenceIds, byId)}`, '');
  });

  out.push('## Revival plan (suggested actions)', '');
  analysis.revivalPlan.forEach((step, index) => out.push(`${index + 1}. ${esc(step)}`));
  out.push('');

  out.push('## Source ledger (verified evidence)', '');
  out.push('| ID | Type | Date | Excerpt | Source |', '| --- | --- | --- | --- | --- |');
  for (const record of evidence) {
    out.push(
      `| ${record.id} | ${TYPE_LABEL[record.sourceType]} | ${day(record.date)} | ${esc(record.excerpt)} | [${esc(record.title)}](${record.url}) |`,
    );
  }
  out.push('');

  out.push(
    '## Source availability',
    '',
    `- Commits: ${sections.commits.status}. ${esc(sections.commits.detail)}`,
    `- README: ${sections.readme.status}. ${esc(sections.readme.detail)}`,
    `- Open issues: ${sections.issues.status}. ${esc(sections.issues.detail)}`,
    '',
  );

  if (report.warnings.length > 0) {
    out.push('## Validation notes', '', ...report.warnings.map((warning) => `- ${esc(warning)}`), '');
  }

  out.push(
    '## Method',
    '',
    `Repository facts, dates and evidence excerpts were retrieved from the GitHub REST API. Activity categories and day counts are computed by Last Commit from those timestamps. The explanation, findings, missions and revival plan were generated by ${report.model.id} from that evidence; the server checked the output against a schema and resolved every evidence ID against its own records. Model output can be wrong. Check each claim against the linked sources before acting on it.`,
    '',
  );

  return out.join('\n');
}
