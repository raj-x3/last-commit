# Last Commit

Last Commit investigates a public GitHub repository. It retrieves verifiable facts from the GitHub REST API, asks Google's open-weight **Gemma 4** model to interpret that evidence, and returns a structured report with source links and three contribution missions.

It is meant for understanding unfamiliar or quiet repositories. It never declares a project abandoned because of a missing recent commit: activity categories are date-based heuristics, shown next to the dates they come from.

## Live Demo Link
https://last-commit-du3q.onrender.com/

## Pages

- **`/`** is the landing page: a scroll-driven journey, then what the report contains, how activity is read, what gets read, how it works, safeguards and a short FAQ.
- **`/investigate`** is the tool: the "Pick a repository you suspect has gone quiet." heading, the form, progress and the report. The server returns the app shell for this path, so a direct visit or reload works. Navigation between pages uses the History API (`src/router.tsx`) with no extra dependency.

## The opening journey

The opening is one continuous WebGL scene: a rotating helical tunnel with a generic repository card at the entrance and a wireframe core (orbit rings and a stack of report pages) at the far end. Scroll sets how deep the camera is; the spiral spins on its own and never stops. Five stops sit along the way: introduction, **EVIDENCE**, **INTERPRETATION**, **REPORT** and a destination that links to `/investigate`. The icon panels change meaning with depth (commits, files and diffs, then linked findings, then documents and checklists), and link lines appear while you are in the interpretation zone.

How it is built:

- Raw WebGL 1 in `src/cinema/` (no Three.js or GSAP). All positions are computed in the vertex shaders from static buffers, so the CPU only sets uniforms each frame.
- The words are DOM text, so they stay selectable and readable by screen readers. Each frame they are placed along the same depth axis as the camera (small and far, then full size, then passing the camera) with transform and opacity only.
- One animation loop, no React state per frame, no layout reads (measurements are cached on resize), a critically damped spring for scroll smoothing, and the loop pauses when the section is off screen.
- Resolution scales down automatically if frames are slow, and a lighter particle count is used on small screens.
- Fallbacks: with `prefers-reduced-motion`, a single still frame is drawn and the sections read as a normal page. If WebGL is unavailable or the context is lost, the same still layout is used without the canvas.
- Icons and the repository card are drawn once on a 2D canvas at start-up. The card's names and messages are illustration, not real data. GitHub's own logo is not used.

The page-wide drifting ghosts are hidden while the journey is on screen.

## Halloween layer and the rusted terminal

- A closing "Investigate a repository" button ends the landing page, matching the one at the start of the journey.
- While an investigation runs, the request log is drawn as an old rusted terminal (`src/components/Terminal.tsx`). Every line is a real pipeline stage with its real state and timing; the scrolling column behind the glass is redacted decoration, not repository data.
- Floating ghosts, bats, pumpkins, cobwebs and a lantern are decorative, ignore pointer input, use transform/opacity only, and are reduced or removed under `prefers-reduced-motion`.

## Workflow

1. Enter a public repository URL (`https://github.com/owner/repo`) or `owner/repo`.
2. The server validates the input, then fetches metadata, recent commits, the README and open issues from GitHub. The three optional sources are fetched independently; one failing does not end the run.
3. The server builds numbered evidence records (`E01`, `E02`, ...), each with a real GitHub URL.
4. The server sends a bounded evidence bundle to `gemma-4-26b-a4b-it` through the Gemini API.
5. The server validates the JSON the model returns, resolves every evidence ID against its own records, and streams the report to the browser.

The interface separates **verified evidence** (from GitHub), **Gemma interpretation**, and **suggested actions** (recommendations, not confirmed defects).

## Architecture

```
server/        Node.js HTTP server (no framework)
  index.ts       routes, static files, rate limit, security headers
  repoUrl.ts     strict repository URL / owner/repo parser
  github.ts      GitHub REST client (timeouts, size limits, no redirects off-host)
  activity.ts    documented activity heuristic
  evidence.ts    evidence records and stable IDs
  prompt.ts      system prompt and bounded evidence bundle
  gemma.ts       @google/genai call, JSON parsing, one bounded retry
  validate.ts    schema, enum, length and evidence-ID validation
  investigate.ts orchestration and real progress events
shared/        types, constants and the Markdown exporter used by both sides
src/           React + TypeScript interface
  components/Stage.tsx   pinned 3D introduction (CSS 3D transforms, one requestAnimationFrame loop)
  components/Story.tsx   report contents and how-it-works sections
  components/motion.ts   reduced-motion, scroll-reveal and tilt helpers
  story.css              scene and section styles
scripts/       esbuild build and dev scripts
tests/         node:test suites
```

Progress shown in the browser is streamed from the server as each stage starts and finishes (newline-delimited JSON). There are no timers or percentages.

## GitHub endpoints used

All requests go to `https://api.github.com` only. Paths are built from the validated owner and repository.

| Purpose | Endpoint |
| --- | --- |
| Metadata | `GET /repos/{owner}/{repo}` |
| Recent commits (30) | `GET /repos/{owner}/{repo}/commits` |
| README | `GET /repos/{owner}/{repo}/readme` |
| Open issues (50 most recently updated; pull requests removed) | `GET /repos/{owner}/{repo}/issues` |

## Model

- Model ID: `gemma-4-26b-a4b-it`, called through the Gemini API with the official `@google/genai` SDK, from the server only.
- The model writes the project explanation, findings, three missions and the revival plan. It does not supply URLs; links come from the server's evidence records.
- There is no fallback model. If the model is unavailable to your key, the app shows the API error and what to correct.
- This is a hosted API call. Repository content is sent to Google's Gemini API. Nothing runs locally or offline.

## Setup

Requires Node.js 22.18 or newer.

```bash
npm install
cp .env.example .env        # then set GEMINI_API_KEY
npm run dev                 # builds the client and runs the server with --watch
```

Open `http://localhost:3000`. For a production-style run: `npm run build && npm start`.

In Google AI Studio, add `GEMINI_API_KEY` as a secret instead of using `.env`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Calls `gemma-4-26b-a4b-it`. Server-side only. |
| `GITHUB_TOKEN` | No | Raises the GitHub rate limit (60 requests/hour per IP unauthenticated). Use a token with no scopes. |
| `PORT` | No | Defaults to 3000. |
| `RATE_LIMIT_MAX` | No | Investigations per client per 10 minutes. Defaults to 30; `0` disables. |
| `TRUST_PROXY` | No | Set to `1` behind a trusted reverse proxy so the client IP is read from `X-Forwarded-For`. |

`npm run dev` rebuilds the client only at start-up; re-run it after editing files in `src/`.

## Tests

```bash
npm run typecheck
npm test
npm run build
npm run check      # all three
```

Suites cover URL parsing (valid forms, malicious hosts, missing names, traversal), GitHub error mapping (not found, rate limit, timeout, size limit, redirects, partial failures), the activity heuristic, evidence-ID resolution, invalid model output and the single retry, missing credentials, model errors and timeouts, the HTTP API, and Markdown export. Tests use injected fetch and model stubs; they do not call GitHub or Gemini.

### Status of this repository's checks

Recorded when this code was written, in an environment where the npm registry and the GitHub API were blocked:

- `npm test`: 154 tests, all passing.
- Client build with esbuild: succeeds.
- Interface checked in Chromium (desktop and 390 px wide) against fixture data: stage progress, report, evidence links, validation error, no horizontal overflow.
- `npm run typecheck`: **not clean in that environment**. Server, shared and test code had no errors apart from the unresolved `@google/genai` import; `@types/react` and `@types/react-dom` could not be installed, which produced the remaining errors. Run it after `npm install`.
- **Not verified:** a live run against the real GitHub API and the real `gemma-4-26b-a4b-it`. Run one investigation with your key before relying on the output. In particular, Gemma 4's handling of the prompt and the JSON-only instruction has only been exercised through stubs.

## Security notes

- The API key is read from the server environment only and never sent to the browser. Error messages are scrubbed of key-shaped strings.
- Only `github.com` repository URLs and `owner/repo` are accepted. Extra path segments, credentials, ports, other hosts and other schemes are rejected. Requests go only to `api.github.com`, with a timeout, a response-size limit and no cross-host redirects.
- Request bodies are limited to 4 KB. README text sent to the model is limited to 8,000 characters and the whole prompt to about 32,000.
- Repository text and model output are rendered as plain text by React. No untrusted HTML is rendered, and nothing from GitHub or the model is executed.
- The system prompt tells the model to treat the bundle as data, but prompt injection through README or issue text cannot be ruled out. Model output is validated, links are never taken from it, and findings that cite no valid evidence are marked unsupported.
- A Content-Security-Policy restricts the page to its own origin.

## Known limitations

- Activity categories use only the last push date (90 and 365 day thresholds). A push to another branch or tag updates that date.
- Commit counts come from at most the 30 most recent commits on the default branch.
- Only the 50 most recently updated open items are scanned for issues; the GitHub open-issue count includes pull requests.
- The rate limiter is in memory and per process.
- Gemma can misread a README or overstate a finding. Treat every missions and finding as a lead to check against the linked sources, not as a fact. **AI recommendations require human verification.**
