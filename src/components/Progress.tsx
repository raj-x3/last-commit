import type { Stage, StageState } from '../../shared/types.ts';
import { STAGE_LABELS, STAGES, seconds } from '../format.ts';

export interface StageInfo {
  state: 'pending' | StageState;
  detail?: string | undefined;
  ms?: number | undefined;
}

const STATE_TEXT: Record<StageInfo['state'], string> = {
  pending: 'Waiting',
  running: 'Running',
  done: 'Done',
  empty: 'No data',
  unavailable: 'Unavailable',
  failed: 'Failed',
};

export function Progress({ stages }: { stages: Record<Stage, StageInfo> }) {
  return (
    <section className="progress" aria-labelledby="progress-heading">
      <h2 id="progress-heading" className="label">
        Request log
      </h2>
      <ol className="stages" aria-live="polite">
        {STAGES.map((stage) => {
          const info = stages[stage];
          return (
            <li key={stage} className="stage" data-state={info.state}>
              <span className="marker" aria-hidden="true" />
              <span className="stage-name">{STAGE_LABELS[stage]}</span>
              <span className="stage-state mono">{STATE_TEXT[info.state]}</span>
              <span className="stage-detail">{info.detail}</span>
              <span className="stage-ms mono">{seconds(info.ms)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
