import { GEMMA_MODEL_ID, MODEL_VIA } from '../../shared/constants.ts';
import { Cobweb, Pumpkin } from './Haunt.tsx';
import { PROJECT_GITHUB_URL } from '../config.ts';
import { Link } from '../router.tsx';

export function Footer() {
  return (
    <footer className="footer">
      <Cobweb className="web--tr" />
      <Pumpkin className="deco-pumpkin deco-pumpkin--foot" />
      <div className="footer-grid">
        <div>
          <p className="footer-name">Last Commit</p>
          <p className="footer-text">Public repository investigations. No accounts and no database: nothing you enter is stored.</p>
        </div>
        <div>
          <p className="label">Sources</p>
          <p className="footer-text">Facts come from the GitHub REST API.</p>
          <p className="footer-text">
            Interpretation comes from <span className="mono">{GEMMA_MODEL_ID}</span> via the {MODEL_VIA}.
          </p>
        </div>
        <div>
          <p className="label">Explore</p>
          <nav className="footer-links" aria-label="Footer">
            <Link to="/#how">How it works</Link>
            <Link to="/#safeguards">Safeguards</Link>
            <Link to="/investigate">Investigate</Link>
            <a href={PROJECT_GITHUB_URL} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </nav>
        </div>
      </div>
      <p className="footer-fine">AI output requires human verification. Activity categories are heuristics, not verdicts.</p>
    </footer>
  );
}
