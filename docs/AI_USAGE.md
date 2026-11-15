# AI usage log

The project page must say how we used AI. This log is the source for that statement. Add a line whenever an AI tool wrote or substantially shaped code, text, images or analysis. One line per piece of work is enough; do not log every prompt.

Rules that apply to everything listed here:

- No NASA logos, insignia, flags or mission patches in AI-generated material.
- No names, voices or likenesses of anyone under 18.
- A person on the team is responsible for each item and should have read it. The last column records whether that has happened.

| Date | Person | Tool | What the AI did | Where the result is | Reviewed by a person? |
| --- | --- | --- | --- | --- | --- |
| 2026-11-14 | Dinura | Claude Code (Anthropic) | Ran a throwaway data test: searched the SPHEREx archive, compared two ways of downloading image patches, stacked exposures of WISE 0855, read the flag definitions from the files | Findings in `docs/SCIENCE.md` and decisions D-011 and D-012. The test scripts are not in this repository | Not yet |
| 2026-11-14 | Dinura | Claude Code (Anthropic) | Wrote the repository scaffold: instructions, documents, templates, back end with mock data, front end shell, tests, `.github` (issue templates, pull request template, CI workflow, labels), `scripts/`, the `.do/app.yaml` draft, the docs | Everything in the first commit | Not yet |
| 2026-11-14 | Deeshan | Codex (OpenAI) | Shaped the guided sky viewer design and implemented the front-end redesign for issue #2 | `PRODUCT.md`, `DESIGN.md`, `frontend/`, and this pull request | Not yet |
| 2026-11-14 | Issue #4 assignee | OpenAI Codex | Corrected bilinear masking to reject incomplete footprints, added regression coverage and invalidated affected caches | `backend/app/resample.py`, cache versions and `backend/tests/test_live_frames.py` | Not yet |
| 2026-11-14 | Issue #4 assignee | OpenAI Codex | Replaced peak-pixel S/N with a PSF measurement and local empty-aperture scatter; centred targets on odd grids; added regression tests | `backend/app/stacking.py`, `backend/app/mock.py` and backend tests | Not yet |
| 2026-11-14 | Issue #4 assignee | OpenAI Codex | Added a fixed catalogue neighbour to WISE 0855 visit fits and bootstrap samples; tested centroid recovery and sky-to-grid wiring | `backend/app/stacking.py`, `backend/app/stack_service.py` and backend tests | Not yet |
| 2026-11-14 | Issue #4 assignee | OpenAI Codex | Reproduced real-data stack and saturation checks; corrected science and architecture notes and WISE target description; added a repeatable live-check script and static-detection regression | `docs/SCIENCE.md`, `docs/ARCHITECTURE.md`, `backend/app/targets.py`, `backend/scripts/check_accuracy.py` and tests | Not yet |
| 2026-11-14 | Issue #4 assignee | OpenAI Codex | Corrected detector-band endpoints using the issue's supplied ranges; tested overlap and full wavelength coverage | `backend/app/bands.py`, backend tests and `docs/SCIENCE.md` | Not yet |
| 2026-11-14 | Issue #4 assignee | OpenAI Codex | Reproduced the supplied comparison star on 19 real exposures, added a strict diagnostic aperture and regression tests, and documented measured flux ranges | `backend/scripts/check_accuracy.py`, `backend/tests/test_accuracy_check.py`, `docs/SCIENCE.md` and PR #5 | Not yet |
| 2026-11-15 | Issue #4 assignee | OpenAI Codex | Addressed PR #5 review: measured on an internal grid before cropping, selected known neighbours by sky proximity, prevented failed-search stack caching, suppressed saturated-core motion, added regressions and reran live checks | Backend stack service, target data, tests, check script and science/acceptance notes | Not yet |
| 2026-11-15 | Deeshan | Codex (OpenAI) | Refined responsive Pick, Watch, Compare, dated thumbnails, keyboard shortcuts and design documentation | `frontend/`, design docs and PR #3 | Not yet |
| 2026-11-15 | Deeshan | Codex and two audit agents (OpenAI) | Reviewed responsive layout and keyboard behavior and fixed viewer, form and map issues | `frontend/` and PR #3 | Not yet |
| 2026-11-15 | Deeshan | ChatGPT Image Generation and Codex (OpenAI) | Generated the approved two-exposure favicon concept and prepared the 64 px browser PNG | `frontend/public/favicon.png` | User approved the preview |
| 2026-11-15 | Deeshan | Codex (OpenAI) | Resolved PR #3 conflicts preserving both logs; checked merged backend and viewer; fixed odd-grid marker positioning, form error focus order and zero-wavelength validation; restored API-owned target notes | `frontend/`, regression test and PR #3 | Not yet |

## Draft statement for the project page

Keep this current; copy it to the project page at submission.

> We used AI coding assistants (Claude Code, and others listed in our repository's AI usage log) to help write code, tests and documentation, and to run early data tests. Team members directed the work and are responsible for the result. The browser favicon is AI-generated. The viewer labels synthetic mock observations and identifies live SPHEREx data. No NASA branding was used in or added to any AI-generated material.

Change the second and third sentences if they stop being true.
