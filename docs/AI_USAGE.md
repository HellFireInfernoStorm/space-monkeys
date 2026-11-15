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
| 2026-11-14 | Issue #4 assignee | OpenAI Codex | Corrected bilinear masking to reject incomplete footprints, added regression coverage and invalidated affected caches | `backend/app/resample.py`, cache versions and `backend/tests/test_live_frames.py` | Not yet |
| 2026-11-14 | Issue #4 assignee | OpenAI Codex | Replaced peak-pixel S/N with a PSF measurement and local empty-aperture scatter; centred targets on odd grids; added regression tests | `backend/app/stacking.py`, `backend/app/mock.py` and backend tests | Not yet |
| 2026-11-14 | Issue #4 assignee | OpenAI Codex | Added a fixed catalogue neighbour to WISE 0855 visit fits and bootstrap samples; tested centroid recovery and sky-to-grid wiring | `backend/app/stacking.py`, `backend/app/stack_service.py` and backend tests | Not yet |
| 2026-11-14 | Issue #4 assignee | OpenAI Codex | Reproduced real-data stack and saturation checks; corrected science and architecture notes and WISE target description; added a repeatable live-check script and static-detection regression | `docs/SCIENCE.md`, `docs/ARCHITECTURE.md`, `backend/app/targets.py`, `backend/scripts/check_accuracy.py` and tests | Not yet |
| 2026-11-14 | Issue #4 assignee | OpenAI Codex | Corrected detector-band endpoints using the issue's supplied ranges; tested overlap and full wavelength coverage | `backend/app/bands.py`, backend tests and `docs/SCIENCE.md` | Not yet |
| 2026-11-14 | Issue #4 assignee | OpenAI Codex | Reproduced the supplied comparison star on 19 real exposures, added a strict diagnostic aperture and regression tests, and documented measured flux ranges | `backend/scripts/check_accuracy.py`, `backend/tests/test_accuracy_check.py`, `docs/SCIENCE.md` and PR #5 | Not yet |
| 2026-11-15 | Issue #4 assignee | OpenAI Codex | Addressed PR #5 review: measured on an internal grid before cropping, selected known neighbours by sky proximity, prevented failed-search stack caching, suppressed saturated-core motion, added regressions and reran live checks | Backend stack service, target data, tests, check script and science/acceptance notes | Not yet |
| 2026-11-15 | Issue #7 assignee | Claude Code (Anthropic) | Wrote layer 3: live aperture photometry for `/api/photometry` (moved the 2MASS-checked aperture into the app, null flux for flagged apertures, parallax, caching), the spectrum and light-curve panel with URL state, photometry prewarming, tests and docs; ran the live checks on the 2MASS star, RW Aurigae, R Draconis and WISE 0855 | `backend/app/photometry.py`, `frontend/src/components/PhotometryPanel.tsx`, `frontend/src/photometry.ts`, tests, `scripts/prewarm.py`, `docs/ARCHITECTURE.md`, `docs/ACCEPTANCE.md` and PR #8 | Not yet |
| 2026-11-15 | Issue #7 assignee | Claude Code (Anthropic) | Wrote layer 4: `/api/wise` reading AllWISE Atlas tiles from the AWS mirror (tile lookup by listing, two range requests, resampling onto the SPHEREx field), the WISE-versus-SPHEREx comparison panel with URL state and position markers, tests and docs; ran the alignment and WISE 0855 position checks | `backend/app/wise.py`, `frontend/src/components/WiseCompare.tsx`, `frontend/src/wiseCompare.ts`, tests, `docs/SCIENCE.md` section 8, `docs/ARCHITECTURE.md`, `docs/RESOURCES.md` | Not yet |
| 2026-11-15 | Thisal | OpenAI Codex | Read the current project documentation, implementation, test coverage and assigned layout handoff; summarised how the project addresses the challenge and distinguished implemented features from documented verification limits | Project orientation in the Codex chat; no application changes or new validation runs | Not yet |
| 2026-11-15 | Thisal | OpenAI Codex | Implemented issue #10: controls drawer, centred header, tabbed workbench, sky map controls and confirmed-position navigation; added URL round-trip coverage, ran frontend checks and browser checks, documented partial live validation and archive failures | `frontend/src/`, architecture and layout-validation notes, screenshots and PR #11 | Not yet |
| 2026-11-15 | Thisal | OpenAI Codex | Reran the requested frontend commands and mock/live browser checks; confirmed the real 46-exposure WISE stack and all 30 Barnard frames, playback and moving marker; recorded successful evidence superseding the earlier archive blocker | `docs/LAYOUT_VALIDATION.md`, live screenshots and PR #11; no application code changes | Not yet |
| 2026-11-15 | Thisal | OpenAI Codex | Found and fixed the generic button rule overriding active-tab styles by reducing its selector specificity; checked both selected tabs in the browser and reran frontend checks | `frontend/src/styles.css`, layout-validation notes, screenshots and PR #11 | Not yet |
| 2026-11-15 | Thisal | OpenAI Codex | Addressed PR #11 review: restored focus after leaving expanded map with Esc; corrected the initial 30-arcminute field after canvas resize and kept drawer scrollbar space stable; checked both desktop sizes, zoom preservation and spectrum-first links, then reran frontend checks | `frontend/src/components/AladinPanel.tsx`, `frontend/src/styles.css`, validation notes and review screenshots | Not yet |
| 2026-11-15 | Chetha | Claude Code (Anthropic) | Diagnosed the IRSA 502 outage, found that a deep collection answering with no rows stopped the saved-search fallback, wrote the fix and its tests, and opened issue #13 | `backend/app/live_frames.py`, `backend/tests/test_live_frames.py` and issue #13 | Not yet |

| 2026-11-15 | Repository owner (requested proposal) | OpenAI Codex | Reviewed existing WCS/image alignment and drafted the plate-solving decision proposal with visible matches, quality states and acceptance criteria | GitHub issue #22 | Not yet |

| 2026-11-15 | Repository owner (issue #22) | OpenAI Codex | Implemented independent catalogue alignment verification, visible matches and failure states, URL preference, adversarial tests and validation notes | Plate-solving implementation PR and `docs/PLATE_SOLVING_VALIDATION.md` | Not yet |

## Draft statement for the project page


Keep this current; copy it to the project page at submission.

> We used AI coding assistants (Claude Code, and others listed in our repository's AI usage log) to help write code, tests and documentation, and to run early data tests. Team members directed the work and are responsible for the result. No AI-generated images, video or audio appear in the project. No NASA branding was used in or added to any AI-generated material.

Change the second and third sentences if they stop being true.
