import type { EvidenceRecord } from '../../shared/types.ts';
import { dateOnly } from '../format.ts';

const TYPE_LABEL: Record<EvidenceRecord['sourceType'], string> = {
  metadata: 'Metadata',
  activity: 'Computed',
  readme: 'README',
  commit: 'Commit',
  issue: 'Issue',
  status: 'Status',
};

export function EvidenceRefs({ ids, byId }: { ids: string[]; byId: Map<string, EvidenceRecord> }) {
  if (ids.length === 0) return <span className="refs-none mono">No evidence cited</span>;
  return (
    <span className="refs">
      {ids.map((id) => {
        const record = byId.get(id);
        return (
          <span className="ref" key={id}>
            <a className="ref-id mono" href={`#evidence-${id}`}>
              {id}
            </a>
            {record ? (
              <a
                className="ref-ext"
                href={record.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${id} on GitHub: ${record.title}`}
              >
                <span aria-hidden="true">↗</span>
              </a>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

export function EvidenceLedger({ evidence }: { evidence: EvidenceRecord[] }) {
  return (
    <section className="section ledger" aria-labelledby="ledger-heading">
      <div className="section-head">
        <h2 id="ledger-heading">Source ledger</h2>
        <span className="tag tag--verified">Verified evidence</span>
      </div>
      <p className="section-note">
        Retrieved from the GitHub API, except the row marked Computed, which Last Commit derived from GitHub timestamps. Each link
        opens the real GitHub page.
      </p>
      <table className="ledger-table">
        <caption className="sr-only">Evidence records cited by the analysis</caption>
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">Type</th>
            <th scope="col">Date</th>
            <th scope="col">Excerpt</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {evidence.map((record) => (
            <tr key={record.id} id={`evidence-${record.id}`}>
              <td data-label="ID" className="mono ledger-id">
                {record.id}
              </td>
              <td data-label="Type" className="mono">
                {TYPE_LABEL[record.sourceType]}
              </td>
              <td data-label="Date" className="mono">
                {record.date ? dateOnly(record.date) : '—'}
              </td>
              <td data-label="Excerpt" className="ledger-excerpt">
                {record.excerpt}
              </td>
              <td data-label="Source">
                <a href={record.url} target="_blank" rel="noopener noreferrer">
                  {record.title}
                  <span aria-hidden="true"> ↗</span>
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
