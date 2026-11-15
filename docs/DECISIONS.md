# Decision log

Decisions that are settled. Newest at the bottom. Add an entry when a `decision` issue is closed; link the issue. To reopen a decision, open a new `decision` issue rather than quietly doing something else.

Format: number, date, the decision in one or two sentences, the reason, and who decided.

| No. | Date | Decision | Why | Decided by |
| --- | --- | --- | --- | --- |
| D-001 | 2026-11-13 | GitHub Issues are the team's message bus. Each issue carries one area label, one type label (`question`, `blocker`, `decision`, `handoff`) and an assignee. AI tools check their person's assigned issues at the start of a session and before each task. | Works with every AI tool and both operating systems with nothing extra to run; leaves a written record. | Repository owner |
| D-002 | 2026-11-13 | One repository holding both parts. Back end: Python, FastAPI, astropy, PyVO. Front end: React, Vite, TypeScript, static site, Aladin Lite for the sky map. | Python has the astronomy libraries; a static front end is cheap to host and easy to embed. | Repository owner |
| D-003 | 2026-11-13 | The API contract is generated from the FastAPI code into `docs/openapi.json`, and the back end has a mock mode that is the default. | Front-end and back-end work can proceed in parallel; nobody waits for real data. | Repository owner |
| D-004 | 2026-11-13 | All view state lives in the URL. | The challenge asks for coordinate queries by URL so the tool can be embedded and shared. | Repository owner |
| D-005 | 2026-11-13 | Data release and collection names live in configuration only. | New SPHEREx releases arrive often; adding one must be a one-line change. | Repository owner |
| D-006 | 2026-11-13 | Host everything on DigitalOcean App Platform, in a region close to the AWS `us-east-1` data mirror. | One provider for site and API; short network path to the data. | Repository owner |
| D-007 | 2026-11-13 | No Discord or other chat integration. Notifications come from GitHub's own email and mobile alerts; the team talks on WhatsApp. | Team preference. | Repository owner |
| D-008 | 2026-11-14 | The repository owner owns every area for now. | Areas will be reassigned once teammates are onboarded. | Repository owner |
| D-009 | 2026-11-14 | The product is a layered workbench built in fixed order: (1) wavelength-matched blink and difference, (2) motion-tracked stacking, (3) point spectrum and light curve, (4) WISE-era versus SPHEREx comparison, (5) automatic flags on moved or changed sources. Each layer is demo-ready before the next begins. | Always leaves something that works for the pitch, while reaching for the Best Use of Data, Science and Technology awards. | Repository owner |
| D-010 | 2026-11-14 | Team name and repository name: `space-monkeys`. | Team choice. | Repository owner |
| D-011 | 2026-11-14 | Read image patches from the AWS mirror of the SPHEREx archive with byte-range requests, not from the IRSA cutout service. | Measured: 258 patches in 75 seconds from the mirror, against roughly 12 seconds per cutout and rejected requests above about 8 in parallel from the cutout service. | Repository owner, from the data spike |
| D-012 | 2026-11-14 | Search the collections `spherex_dr1`, `spherex_qr3`, `spherex_dr1_deep` and `spherex_qr3_deep` together, and cap the exposures returned per request. | The quick-release collection holds the newest months; deep fields hold thousands of exposures for one position. | Repository owner, from the resources review |
| D-013 | 2026-11-14 | Layer 3 is a fast "quick look" aperture measurement, cross-checked against IRSA's Spectrophotometry Tool, with the same column names as that tool. The pitch leads with time and motion (layers 1, 2 and 5). | IRSA already offers precise spectra, but slowly and for at most 20 sources per run; our distinct value is speed and change over time. | Repository owner, from the resources review |
| D-014 | 2026-11-14 | Layer 4 starts as a link that opens WiseView at the same coordinates; an embedded comparison comes only if time allows. | WiseView already does WISE-era blinking well and takes coordinates in its URL. | Repository owner, from the resources review |
| D-015 | 2026-11-14 | One canonical instruction file for AI tools, `AGENTS.md`, with `CLAUDE.md` as a pointer. | Codex, Cursor and Antigravity read `AGENTS.md` from the repository root; one file cannot drift out of step with itself. | Repository owner |
| D-016 | 2026-11-14 | The repository is public from the start, under the repository owner's personal GitHub account for now. | Gets the prototype where the team can reach it quickly; a move to an organisation can still happen later. | Repository owner |
| D-017 | 2026-11-14 | Our own code and documents are licensed under Apache 2.0 (`LICENSE`). | The Space Apps terms require an open-source licence and apply Apache 2.0 when none is named; it works with every library we use. | Repository owner |
| D-018 | 2026-11-15 | The public product name is spaceshift; the team and repository name stays space-monkeys (D-010). | Agreed by the team in issue #12. | Team |
| D-019 | 2026-11-15 | Use SpaceShift as the public display name, updating the spelling in D-018. | Requested in issue [#35](https://github.com/HellFireInfernoStorm/space-monkeys/issues/35). | Deeshan |

## Open

| Topic | Waiting on |
| --- | --- |
| Exact final submission time | Organisers (deferred on 2026-11-14) |
| Whether to move the repository to a GitHub organisation | Repository owner |
| The six GitHub usernames | Team |
