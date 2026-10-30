export function EmptyWorkspace() {
  return (
    <section className="empty" aria-labelledby="empty-heading">
      <h2 id="empty-heading" className="empty-title">
        No investigation yet
      </h2>
      <p className="empty-text">
        Enter a public repository above. Last Commit reads its metadata, recent commits, README and open issues from the
        GitHub API, then Gemma 4 interprets that evidence. Nothing appears below until a live investigation finishes.
      </p>
      <div className="empty-frame" aria-hidden="true">
        <div className="empty-col">
          <p className="empty-slot">Identity and metrics</p>
          <p className="empty-slot">Activity signal</p>
          <p className="empty-slot">Findings</p>
          <p className="empty-slot">Source ledger</p>
        </div>
        <div className="empty-col">
          <p className="empty-slot">Contribution missions</p>
          <p className="empty-slot">Revival plan</p>
        </div>
      </div>
    </section>
  );
}
