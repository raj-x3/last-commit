import type { Ref } from 'react';
import type { ApiErrorBody } from '../../shared/types.ts';

export function ErrorPanel({ error, panelRef }: { error: ApiErrorBody; panelRef: Ref<HTMLDivElement> }) {
  return (
    <div className="notice notice--error enter" role="alert" tabIndex={-1} ref={panelRef}>
      <p className="notice-title">{error.message}</p>
      {error.hint ? <p>{error.hint}</p> : null}
      {error.retryAfterSeconds ? (
        <p>
          Retry after about <span className="mono">{error.retryAfterSeconds}</span> seconds.
        </p>
      ) : null}
      {error.details && error.details.length > 0 ? (
        <ul className="notice-list">
          {error.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
      <p className="notice-code mono">{error.code}</p>
    </div>
  );
}
