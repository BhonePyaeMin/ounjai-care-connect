# OunJai Care Connect

A working prototype of **OunJai Health Services**: find and book caregivers for children, older adults and people with disabilities, with AI matching, a symptom-triage assistant, simulated live tracking, SOS and donations. It follows the design of the Lovable mockup (https://ounjai-care-connect.lovable.app/) and the OunJai project decks.

Built for the AI for Future Workforce Competition / True x Gemini course project (Community & Society track).

## Run it

Requires **Node.js 22.13 or newer** (uses the built-in `node:sqlite`). No `npm install` needed - there are no dependencies.

```bash
npm start
```

Open http://localhost:3000. Data is stored in `data/ounjai.db` (created on first run, with 10 fictional caregivers and 4 donation campaigns).

```bash
npm test
```

Runs the automated suite (unit and API tests, 67 cases).

```bash
node scripts/evaluate.js
```

Re-runs the AI evaluation (matching accuracy, three triage case sets, API speed) and writes `docs/evaluation-results.json`. The Progress 2 report is `docs/OunJai-Progress2-Report.pdf`; the first-run (before-fix) results it quotes are kept in `docs/evaluation-first-run-paraphrases.json` and `docs/evaluation-fresh-first-run.json`. Expected labels were written by students, not clinicians.

Optional settings (environment variables): `PORT`, `HOST`, `OUNJAI_DB` (database path), `ANTHROPIC_API_KEY` (see "AI" below).

## What works

| Area | What it does |
|---|---|
| Accounts | Register with PDPA consent, sign in/out, sessions in HttpOnly cookies, scrypt-hashed passwords, delete-my-account (right to erasure) |
| AI Care Matching | Free-text (English/Thai) needs -> explainable 0-100 score from skills, service type, distance, rating, availability, experience and budget; filters; "why this match?" breakdown |
| AI symptom assistant | Rule-based triage -> Emergency / Urgent / Routine / Self-care, or "Not sure" when nothing is recognised (never reassures). Reasons, advice, 1669 and 1323 hotlines, follow-up questions; handles negation, ages, vitals (temperature, BP, glucose) and Thai. Weak on unfamiliar wording: see the report's evaluation |
| Document analysis | Paste report text for needs/conditions/risk signals; PNG/JPG/PDF upload read by a vision model when an API key is configured |
| Booking | Validated booking with day-off and double-booking checks, fee estimate, cancel, feedback and rating that updates the caregiver's score |
| Live tracking | Simulated GPS (route, ETA, status timeline). "Demo: start the trip now" compresses time so a whole visit plays in about 5 minutes |
| Emergency | Emergency contacts, SOS alert (logged; simulated notification), hotline shortcuts; works without an account |
| Donate | Campaigns with progress and simulated donations |

## AI: what is real and what is not

- **Matching and triage are real, deterministic algorithms** (see `server/matching.js`, `server/triage.js`). They need no API key, run offline and can be audited. The triage **rules decide the urgency level**; nothing generated can lower it.
- **Optional LLM** (`ANTHROPIC_API_KEY`): rewrites the triage result in friendlier language (discarded if an emergency answer does not mention 1669) and reads uploaded images/PDFs. Without a key the app says so honestly instead of pretending. Tested against a mock of the API, not against the live service.
- **Not real in this prototype:** GPS (simulated from distance and time), SMS/push notifications for SOS (logged only), payments (donations are simulated), caregiver data (fictional), caregiver identity verification. Do not use it for real medical decisions.

## Layout

```
server/   index.js (HTTP + API), matching.js, triage.js, nlp.js, tracking.js,
          analyze.js, llm.js, db.js, auth.js, util.js
public/   HTML pages, css/app.css (Lovable design tokens), js/ (vanilla ES modules)
test/     node:test suites
```

## Security and privacy notes

Parameterised SQL only, validated and size-limited input, JSON-only mutating endpoints plus an Origin check (CSRF), strict Content-Security-Policy (no inline scripts), rate limits on login/registration/SOS/AI endpoints, uploads checked by magic bytes and never stored, triage logs keep only level and score (no text, no identity). See `/privacy` in the app. This is a course prototype: have a qualified person review PDPA, medical-claims and security aspects before any real launch.
