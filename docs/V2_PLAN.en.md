# MakeSlide 2.0 — Priorities for the Next Release

> This document is the outcome of a full review of the codebase on 2026-08-03, and sets the direction for the next major version (2.0).
> How it differs from [`FUTURE_ROADMAP.md`](FUTURE_ROADMAP.md): that document asks "what features could we add next"; this one asks "which foundations must be fixed first, so that features have somewhere to grow."
> Every number below was measured on master (commit `2ec2f60d`). The commands are listed in [Appendix A](#appendix-a-how-the-numbers-were-measured).
>
> 中文版：[`V2_PLAN.md`](V2_PLAN.md)

---

## 1. The Short Version

**1.x was about getting the features built. 2.0 should be about surviving a real class.**

The codebase is in better shape than its size suggests. `tsc --noEmit` is clean on both sides, there are 7 `any`s in the entire repository, 2,463 tests run in seconds, and the hard logic is consistently extracted into pure functions with their own tests. The problem is not code quality — it is **structural risk accumulated through growth**: a 3,014-line play page, a context with 419 fields, a single 1.68 MB JS chunk, a classroom screen with no error boundary, and a production image that runs TypeScript source through `npx tsx`.

None of this hurts when one person is developing and demoing to themselves. All of it hurts when a teacher is standing in front of a classroom and thirty students are scanning a QR code with their phones.

---

## 2. Where We Are (Measured)

### 2.1 Scale

| Item | Value |
|---|---:|
| Backend source | 38,484 lines / 146 `.ts` files |
| Frontend source | 58,061 lines / 320 `.ts`·`.tsx` files |
| HTTP routes | 225 |
| Database tables | 34 (`db.ts` is 957 lines of accumulated migrations) |
| i18n keys | 2,420 × 2 locales |
| Backend tests | 226 files / 1,610 cases |
| Frontend tests | 123 files / 853 cases |

### 2.2 What Is Healthy (and Must Not Be Broken in 2.0)

- **Type discipline**: 5 `any`s in the backend, 2 in the frontend; `tsc --noEmit` is clean.
- **Pure-function extraction**: the difficult logic — the difficulty ladder, option shuffling, subtitle alignment, animation geometry, report aggregation — is extracted into unit-testable pure functions. Nearly all 123 frontend test files are of this kind. This is the single most valuable habit in the project.
- **Test speed**: 1,610 backend cases in 23 seconds; 853 frontend cases in a few. Fast enough to run on every change.
- **Account isolation**: account context rides on `AsyncLocalStorage`, and background jobs re-enter the context using the deck's `owner_sub` rather than inheriting whoever triggered them. This design is right.
- **Comment quality**: decision points generally explain *why*, not just *what*.

### 2.3 Risks, by Severity

| # | Problem | Evidence |
|---|---|---|
| R1 | No error boundary on the play page | **Zero** `ErrorBoundary` in the repository; one render exception mid-class blanks the screen |
| R2 | No mobile layout for students | `PlayPage.tsx` contains **2** responsive classes (`sm:`/`md:`/`lg:`) in its entire 3,014 lines |
| R3 | Frontend payload | Main chunk is **1.68 MB** uncompressed, with no route-level code splitting; all 2,420 × 2 i18n keys are inlined |
| R4 | Play page complexity | `PlayPage.tsx` is **3,014 lines with 173 hook calls**; `PlayPageContext` exposes **419 fields** |
| R5 | Production image runs source | The Dockerfile runtime runs `npx tsx backend/src/server.ts`; the `dist/` produced by the build stage is copied in but never used. Process supervision is an outer `while true` — no healthcheck, no graceful shutdown |
| R6 | No CI tests | `.github/workflows/` contains only `release.yml`; push and PR run **no tests at all** |
| R7 | Tests contaminate each other | The full suite reports **5 failures** out of 1,610; all pass in isolation (leaked global mocks, shared DB and fs state) |
| R8 | Realtime is polling | **20 `setInterval`s** in the frontend — synced playback, polls, and export progress are all polling. No SSE or WebSocket outside the Jupyter proxy |
| R9 | Artifacts have no lifecycle | `storage/` holds **5.6 GB across 1,680 decks** with no retention policy; `data/` still carries two 16 MB manual `.bak` files |
| R10 | Oversized backend files | `detail.ts` is 87 KB with **45 routes**; `page-operations.ts` 76 KB, `quizzes.ts` 61 KB, `pipeline.ts` 55 KB; `db.ts` is 957 lines of accumulated migrations |
| R11 | No lint, no component tests, no E2E | No ESLint or Prettier; **zero** frontend component tests (all 123 files test pure functions); `playwright` sits in devDependencies **entirely unused** |
| R12 | No rate limiting | The backend has none. Share links act as capability tokens, so a single public generation endpoint is enough to burn through an account's quota |

---

## 3. Six Priorities for 2.0

Ordered on one principle: **keep the class running, then make changes safe, and only then extend.**

---

### P0-1 Classroom Reliability: Never Go Blank Mid-Class

**The problem.** The play page is the only screen in this product with people waiting in front of it, and it is the least defended in the repository: zero error boundaries. Any render exception — a malformed animation spec, a corrupt poll JSON, an API response whose shape drifted — takes the whole page down. The teacher has no recourse in the moment beyond reloading and hoping.

Related: 20 polling loops with no shared backoff or recovery strategy. When a follower's connection drops, it self-heals on the next poll — and until then the screen sits on a stale slide.

**What to do.**

1. **Three layers of error boundary**: page level (keep the header and a way home), panel level (one sidebar tab crashing must not stop playback), and slide level (a failed render falls back to the source image with an error badge, while paging and audio keep working).
2. **An error reporting channel**: when a boundary trips, record the component stack, deck id, page number, and the last N actions to a new event table. "Something broke in class" should become queryable data rather than a verbal report.
3. **Collapse polling into one hook**: a single `usePolling(fetcher, {interval, backoff, onReconnect})` replacing the 20 scattered `setInterval`s — exponential backoff on failure, immediate catch-up on recovery.
4. **Move synced playback to SSE**: `GET /api/pdfs/:id/sync/stream` pushes page number and playback state, with polling demoted to a fallback. Thirty followers hitting an endpoint every two seconds is pure waste, and it puts a floor under latency equal to the poll interval.

**Done when.** Fault injection: feed the play page a bad animation spec, bad poll data, and a malformed detail response, and confirm paging and audio still work and the errors are recorded. Follower page-change latency under SSE: p95 < 500 ms.

---

### P0-2 Students Are on Phones

**The problem.** Share links and QR codes already exist, which means **the product expects students to join from a phone** — yet `PlayPage.tsx` carries 2 responsive classes across 3,014 lines. Everything a student actually touches (watching slides, hearing narration, answering polls, taking quizzes, asking questions, the adaptive tutor quiz) is packed into a three-column layout designed for a desktop.

**What to do.**

1. **Split out a student layout** rather than shrinking the teacher's: single column, slide first, interaction surfaces rising from a bottom sheet. Same data hooks, different shell.
2. **Touch-first interaction**: 44×44 minimum tap targets for poll and quiz options, no precision pointing required to answer, handwriting annotation off by default on touch devices.
3. **Both orientations usable**: portrait for slide plus subtitles, landscape for fullscreen slide.
4. **Accessibility alongside**: 174 `aria-*` attributes and 34 `role=`s across 320 files is thin. At minimum, bring the primary interaction paths (playback controls, polls, quizzes) up to keyboard- and screen-reader-complete.

**Done when.** At 375×667 and 390×844, a student can complete join → watch → vote → take a quiz → ask a question with no horizontal scrolling, and the same path is completable by keyboard.

---

### P1-3 Frontend Decomposition: Make the Play Page Safe to Change

**The problem.** `PlayPage.tsx` is 3,014 lines with 173 hook calls; `PlayPageContext` carries 419 fields. The practical consequence is that **the blast radius of any change cannot be determined by reading** — only by running it and looking. This is also why all 123 frontend test files test pure functions and none test components: the components as they stand cannot be instantiated in a test.

The 1.68 MB main chunk is the same problem seen from another angle. When everything is on one graph, nothing can be split off it.

**What to do.**

1. **Split the context by domain**: `PlaybackContext` (page, audio, timeline), `AuthoringContext` (editing, regeneration, animation), `ClassroomContext` (sync, polls, questions), `AnalyticsContext` (reports, quizzes). A large share of those 419 fields is consumed by exactly one tab.
2. **Make the playback core a state machine**: playing, paused, waiting, synced, and interactive mode are currently a combination of booleans, and a good number of those combinations are not legal states. Made explicit, bugs like "paused in interactive mode while a page change lands" become impossible by construction rather than by care.
3. **Route-level code splitting**: lazy-load `HomePage`, `PlayPage`, `SettingsPage`, `QuizBuilderPage`, and `RemoteControllerPage`. Today only CodeMirror is split out (472 KB).
4. **Load locales dynamically**: 2,420 keys × 2 locales (305 KB of source) ship in the main bundle, and a user only ever reads one of them. Chunk by locale, and add a key-coverage check so a key present in zh-TW but missing in en fails CI.
5. **Introduce component tests** (Testing Library), covering the student path and playback controls first. No coverage target.

**Done when.** Main chunk < 600 KB; `PlayPage.tsx` < 800 lines; the student path has component tests; changing one sidebar tab does not require touching `PlayPageContext`.

---

### P1-4 Deployment and Operations: Make 2.0 Installable by Someone Else

**The problem.** The Dockerfile has several concrete defects:

- The runtime executes `npx tsx backend/src/server.ts` — it **runs TypeScript source**, while the `backend/dist` produced at such effort in the build stage is `COPY`ed into the image and never touched. Slower startup, more memory, re-transpilation on every restart.
- The runtime stage still installs `make` and `g++` and runs a second full `npm install` including devDependencies. The image is far larger than it needs to be.
- Process supervision is `while true; do ...; sleep 2; done`: no healthcheck, no graceful shutdown (a speech synthesis job in flight is simply killed), and no exit-code handling, so a misconfiguration restarts forever.
- CI has only `release.yml`. **Push and PR run nothing.** All 1,610 backend tests exist solely on developer machines.

**What to do.**

1. Run `node backend/dist/server.js` in the runtime; `npm ci --omit=dev` only; drop the compiler toolchain.
2. Add a `HEALTHCHECK` and give `/api/health` something real to check (DB readable, storage writable, poppler and ffmpeg present).
3. Graceful shutdown on `SIGTERM`: stop accepting work, let in-flight pipelines reach an interruptible point, flush the WAL.
4. **Add `ci.yml`**: run typecheck plus backend and frontend tests on push and PR. This is the highest-return item on the list — an hour of work that protects every change thereafter.
5. Bring the frontend into `npm test` (already recorded in TODO as pending a decision; 2.0 should simply do it).
6. **Artifact lifecycle**: 5.6 GB across 1,680 decks with no retention policy. Add configurable retention (starting with regenerable intermediates such as videos and export ZIPs), orphan collection on deck deletion, and an inventory script.

**Done when.** Image size down ≥ 40%; `docker stop` does not interrupt in-flight speech synthesis; a green CI run is required to merge.

---

### P1-5 A Safety Net for Change

**The problem.** The full suite reports 5 failures out of 1,610, all of which pass in isolation (`figure-reference-image-generation`, share visibility, sync follower). The cause is cross-test contamination of global state: the `setOpenAIClientForTest` mock, `setSystemAuthSettings`, and a shared database and `data/test-storage` (already 29 MB across 1,166 directories).

The real cost is not five red lines. It is that **the team learns to ignore red lines** — once "some of those always fail" becomes common knowledge, a genuine regression has somewhere to hide.

**What to do.**

1. Give every test file its own setup/teardown restoring global state; give each file its own `data/test-storage` directory and clean it up on exit.
2. Fix the 5, require the full suite to be **green**, and enforce that in CI.
3. Find out why the test process does not exit on its own locally without `--test-force-exit`. That means an unclosed handle — a timer, a DB connection, a child process — and it leaks in production too.
4. Adopt ESLint and Prettier, tightening gradually. Start with the rules that catch real incidents: `no-floating-promises`, `no-misused-promises`.
5. Use the already-installed, entirely unused `playwright` for three E2E paths: upload → generate → play; teacher starts sync → student joins → votes; student takes a quiz → views the post-class report.

**Done when.** The full suite is green without `--test-force-exit`; lint, tests, and the three E2E paths gate merges.

---

### P2-6 Backend Boundaries and an API Contract

**The problem.** `detail.ts` packs 45 routes into 87 KB; `page-operations.ts` is 76 KB and `quizzes.ts` 61 KB. These files have reached the point where changing one endpoint means reading two thousand lines to find it.

`db.ts` is 957 lines covering 34 tables as accumulated migrations: a long chain of `if (!columnExists(...)) ALTER TABLE ...`. It works, but there is **no version number, no rollback, and no single source of truth for what the schema is supposed to look like**. TODO already records an incident where a new table was placed inside another block's `tableExists` guard, so every pre-existing database could never receive it — the characteristic failure of this migration style.

The 225 routes have no OpenAPI contract, and the frontend's 2,814-line `lib/api/pdfs.ts` is a hand-written mirror of them.

**What to do.**

1. Split `detail.ts`, `page-operations.ts`, and `quizzes.ts` by resource into files under 15 KB. Pure moves, no behavior change, one file at a time, guarded by the existing tests.
2. **Version the schema**: a `schema_version` table plus ordered migration files (`001_*.ts` …), checked and applied in order at startup. Keep the current `columnExists` path as a one-time convergence for existing databases.
3. **Generate OpenAPI from the zod schemas** already used throughout the routes, and derive frontend types from it instead of maintaining the mirror by hand.
4. Close known duplication: `buildContentDisposition` currently has two divergent implementations (recorded in TODO, pending a decision).

**Done when.** No route file exceeds 20 KB; migrations are versioned and can rebuild both from an empty database and from an existing one; frontend API types are generated from the contract.

---

## 4. Two Product-Side Issues Worth Handling Together

Neither is technical debt. Both are the natural result of 1.x growing features quickly.

### 4.1 Feature Density

The play page header is full (already listed in TODO). 2.0 should move to a **task-oriented information architecture**: Author / Teach / Self-study / Report / Export, with visibility driven by deck state and user role. A teacher does not need the tutor-quiz configuration in view, and a student does not need "regenerate all audio."

### 4.2 AI Cost Governance

The foundations exist in `llmUsage` and the weekly quota. 2.0 can add per-account spending caps with soft warnings, cost estimates before generation (particularly full-deck regeneration), a model routing policy (cheap models for drafts, good models for finals), and a degradation chain when a provider fails. Adding a fourth TTS/LLM provider still means editing many scattered places today; `scriptStyleForTtsProvider` and `globalSpeakerVoicesFor` point the right way and should be extended to every provider branch.

---

## 5. Suggested Staging

| Stage | Contents | Bar |
|---|---|---|
| **2.0-alpha** | P0-1 reliability, P0-2 mobile, CI (item 4 of P1-4), green tests (items 1–3 of P1-5) | A real 30-student class runs start to finish without interruption |
| **2.0-beta** | P1-3 frontend decomposition, rest of P1-4 (image, lifecycle), lint + E2E | Main chunk < 600 KB; `docker stop` is safe |
| **2.0** | P2-6 backend boundaries and contract, 4.1 information architecture | A newcomer can add an endpoint in a day and know where to change things |
| **2.1+** | 4.2 cost governance, per-student reporting from `FUTURE_ROADMAP.md` | — |

**Do CI first.** It is the only item that makes every other item cheaper.

---

## 6. Explicitly Out of Scope

- **No framework change.** Fastify + React + SQLite fit this product at this scale, and there is no evidence of a bottleneck from SQLite in WAL mode for single-machine classroom use. A rewrite would consume the entire 2.0 budget.
- **No coverage targets.** The existing habit — extract hard logic into pure functions and test those — works better than a percentage.
- **No microservices.** A 225-route monolith is an asset at this team size, not a liability. The problem is file boundaries, not process boundaries.
- **No play page rewrite.** P1-3 is incremental decomposition (split contexts → state machine → lazy loading); every step stands on its own and can be stopped at any point.

---

## Appendix A: How the Numbers Were Measured

| Figure | Command |
|---|---|
| Source lines | `find backend/src -name '*.ts' \| xargs wc -l`, and the frontend equivalent |
| Route count | `grep -rn "\.\(get\|post\|put\|patch\|delete\)(\s*[\`'\"]/" backend/src/routes` |
| Bundle size | `ls -la frontend/dist/assets` (`index-B0shRI3-.js` = 1,684,924 bytes) |
| Responsive classes | `grep -c "sm:\|md:\|lg:" frontend/src/pages/PlayPage.tsx` |
| Error boundaries | `grep -rln "ErrorBoundary\|componentDidCatch" frontend/src` (no matches) |
| Test results | `MAKESLIDE_TEST=1 npx tsx --test --test-force-exit ./backend/test/*.test.ts` → 1,610 total / 1,604 pass / 5 fail, 23 s |
| Frontend tests | `npx tsx --test 'frontend/src/**/*.test.ts'` → 853 / 853 pass |
| Typecheck | `npm run typecheck` → clean on both sides |
| Storage | `du -sh storage data` (5.6 GB / 85 MB) |

Measured 2026-08-03 against master `2ec2f60d`.
