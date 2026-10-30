import type { FormEvent } from 'react';
import { SAMPLE_REPOSITORY } from '../config.ts';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  running: boolean;
  error: { message: string; hint?: string | undefined } | null;
}

export function InvestigateForm({ value, onChange, onSubmit, onCancel, running, error }: Props) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!running) onSubmit();
  };

  return (
    <section className="control" aria-labelledby="control-heading">
      <h2 id="control-heading" className="label">
        Repository
      </h2>
      <form className="control-form" onSubmit={handleSubmit} noValidate>
        <input
          id="repo-input"
          className="repo-input mono"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="https://github.com/owner/repository"
          aria-label="GitHub repository URL or owner/repository"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'repo-help repo-error' : 'repo-help'}
          value={value}
          readOnly={running}
          onChange={(event) => onChange(event.target.value)}
        />
        {running ? (
          <button key="cancel" type="button" className="btn btn--secondary" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button key="go" type="submit" className="btn btn--primary">
            Investigate
          </button>
        )}
      </form>
      {error ? (
        <p id="repo-error" className="field-error" role="alert">
          {error.message}
          {error.hint ? <span className="field-hint"> {error.hint}</span> : null}
        </p>
      ) : null}
      <p id="repo-help" className="help">
        Public repositories only. Accepts a github.com URL or owner/repository.{' '}
        <button type="button" className="link-button" disabled={running} onClick={() => onChange(SAMPLE_REPOSITORY)}>
          Use sample: <span className="mono">{SAMPLE_REPOSITORY}</span>
        </button>
      </p>
    </section>
  );
}
