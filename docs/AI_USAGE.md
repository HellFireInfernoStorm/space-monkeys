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

- 2026-11-15: Codex refined the responsive Pick, Watch, Compare workflow for issue #2, including keyboard controls, dated thumbnails, and design documentation.

- 2026-11-15: Codex added and verified keyboard shortcuts for exposure playback.

- 2026-11-15: Codex and two audit agents reviewed responsive layout and keyboard behavior and fixed viewer, form, and map UI issues.

- 2026-11-15: ChatGPT Image Generation produced the two-exposure favicon concept selected by the user. Codex prepared the 64 px PNG for the browser tab.

## Draft statement for the project page

Keep this current; copy it to the project page at submission.

> We used AI coding assistants (Claude Code, and others listed in our repository's AI usage log) to help write code, tests and documentation, and to run early data tests. Team members directed the work and are responsible for the result. The browser favicon is AI-generated. The viewer labels synthetic mock observations and identifies live SPHEREx data. No NASA branding was used in or added to any AI-generated material.

Change the second and third sentences if they stop being true.
