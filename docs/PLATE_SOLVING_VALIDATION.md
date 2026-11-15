# Plate-solving verification: issue #22

Date: 2026-11-15. PR: [#28](https://github.com/HellFireInfernoStorm/space-monkeys/pull/28).

This is the first deliverable from the approved proposal: an independent, header-seeded star-match check with visible evidence. It does **not** apply corrections, provide blind solving or complete all of #22. The PR stays draft until real-catalogue validation and [licence question #27](https://github.com/HellFireInfernoStorm/space-monkeys/issues/27) are resolved. Do not describe the feature as validated on the real sky.

## Implemented behavior

`GET /api/alignment` checks a known exposure at its displayed centre, excluding the science target at that exposure's date. It reads a bounded 161×161 native-pixel IMAGE/FLAGS patch using byte-range access, detects clean isolated maxima, propagates catalogue positions, matches unambiguously and assesses archive-WCS agreement. A median translation and leave-one-out residual are diagnostics. No correction enters imagery, spectral WCS, wavelength selection, differences, stacks or photometry.

The visible panel shows catalogue crosses, detected circles, true-scale residual lines, RMS offset, compass/scale, crop coverage and a keyboard-accessible match table. Up to 20 overlays are sampled through the visible match list. `matches=0` hides them and is restored by Back/Forward. Changing frames resets the evidence. Difference overlays refer to the input exposure, never detections in the difference image. Stack/WISE views state that they retain unverified archive coordinates.

Mocks use sources from the synthetic scene drawn by the existing renderer, with an injected catalogue offset. Detector 6 gives a reproducible insufficient-reference example. All mock results are labelled synthetic; no real catalogue dump is committed.

## Tests

Backend coverage: known east/north offsets and units; RA wrap and both high-declination signs; insufficient, clustered, collinear, ambiguous and unrelated matches; excessive offsets; explicit outliers; 100 seeded unrelated random fields; blank noise; informational/bad flags, NaNs and edges; rotated/mirrored SIP-distorted original FITS pixels and crop origins; target/neighbour exclusion; malformed/oversized/nonfinite catalogue responses; epoch propagation; 404/422 API behavior; concurrency, timeout, slot release, failure retry and network-free mock success/failure.

Frontend coverage: exact gnomonic projection and handedness, wrap/high declination, behind-plane rejection, provenance/failure wording, URL preference round-trip/history, SVG output and rejecting stale exposure/centre overlays. Actual browser checks supplement the unit tests.

From `backend/`: `python -m pytest -q` (**154 passed, 2 pre-existing skips**), `python -m ruff check .` (passed), `python scripts/export_openapi.py`. From `frontend/`: `npm run gen:api`, `npm run typecheck`, `npm test` (**85 passed**, including five review regressions) and `npm run build` (all passed). The 36 astrometry-specific backend tests were rerun after cleanup; the timeout test uses an event barrier rather than relying on a short sleep.

Sandboxed Windows TestClient initialization hung in asyncio's loopback socket-pair setup. Running with ordinary local socket permissions resolved it without application changes. Existing warnings remain: Starlette/httpx deprecation, Astropy's no-distance proper-motion warning and Vite's large Aladin chunk warning.

## Browser evidence

Checked at 1280×900 and 390×844, plus the narrow default browser panel:

- Initial status, mock success, diagnostic metrics and actual rendered SVG matches (18 sampled symbols for 125 crop-visible matches).
- Checkbox toggled with Space; `matches=0` appeared in the URL; Back restored checked state.
- Slider Home/End changed frames and cleared stale evidence. Detector 6 showed three matches and an insufficient-reference reason, with no accuracy metric.
- Enter opened details; accessibility exposed source IDs, catalogue/detected coordinates, offsets and inclusion state. The scrollable table is focusable.
- Stopping only the isolated test API produced “Failed to fetch. Showing unverified archive coordinates.” The image remained and verification evidence disappeared.
- Mobile page width was 375 CSS pixels inside 390; desktop 1265 inside 1280 (scrollbar accounts for remaining width). A responsive override removes the old 1100-pixel page minimum so the evidence panel is readable.
- Temporary viewport override was reset and isolated preview servers stopped. Existing user servers were left running.

Screenshots: [desktop mock](screenshots/issue-22/desktop-mock.jpg), [mobile details](screenshots/issue-22/mobile-details.jpg), [mobile failure](screenshots/issue-22/mobile-network-failure.jpg). These show our interface and synthetic frames, with the existing credited AllWISE/Aladin map where visible; they are validation evidence, not application assets.

## PR review: cancelled-frame retry

The reviewer reproduced a pending check on frame A becoming permanently disabled after A → B → A. The component now uses a request lifecycle that aborts and resets result/loading/error state when the frame context changes. A response may publish only while its controller and frame context are still current. Cleanup aborts the request on unmount.

Five asynchronous regression tests cover A → B → A with a successful retry, late completion after retry starts, late abort rejection, A completing after B, unmount, failed-request retry and changed centre/target contexts. Browser validation used an isolated mock API with an eight-second alignment-response delay: the initial A button was disabled while pending, returning from B re-enabled it before completion, and retry completed successfully. Evidence: [retry after returning to A](screenshots/issue-22/review-retry.jpg). No new dependency or backend change was needed.

## Real-data attempts (original validation)

Two exposures per target were selected with a 20-probe cap. Archive SIA failures triggered the existing saved-search fallback. Cold/retry worker calls failed at the Gaia connection with `urllib.error.URLError: <urlopen error timed out>`. A documented IRSA Gaia mirror returned HTTP 502 Proxy Error for POST and GET. No real catalogue match, residual distribution or successful fit is claimed.

| Field | Exposure | Wavelength (µm) | Native detections on v2 rerun | First worker call (s) | Retry (s) |
| --- | --- | --- | --- | --- | --- |
| Barnard | `2025W35_2A_0233_2-D1` | 1.0561 | 66 | 24.95 | 34.51 |
| Barnard | `2025W40_1A_0471_1-D1` | 1.0320 | 47 | 21.73 | 35.48 |
| WISE 0855 | `2025W19_1B_0116_1-D6` | 4.9674 | 20 | 23.09 | 36.00 |
| WISE 0855 | `2025W46_1A_0075_4-D6` | 4.4178 | 30 | 30.90 | 29.45 |

Counts came from a separate native-pixel-only rerun with the reviewed v2 detector. They are candidate clean maxima, **not** catalogue-confirmed stars. Timings came from initial v1 failed-connection experiments; they are not successful warm-cache or HTTP response times. Failures are not cached. The HTTP route separately returns by its configured deadline; timed-out readers retain their slot until exit, as tested offline.

Reproduce from `backend/`:

```text
python scripts/check_alignment.py --target barnard --output .cache/alignment-barnard-report.json
python scripts/check_alignment.py --target wise-0855 --output .cache/alignment-wise-report.json
```

The CLI measures full worker calls, not the async HTTP deadline. Its existing archive-search stage can take several minutes during an outage. JSON reports remain in the ignored cache.

## Remaining work

Resolve #27, rerun real matching, publish residual distributions/cache timing and calibrate conservative gates against those results. Evaluate infrared catalogue coverage if Gaia supplies inadequate matches. Then implement accepted corrections consistently across all science consumers, with archive/refined comparison and cache invalidation. Blind solving and stack/WISE constituent checks remain in #22. No deployment or decision-issue closure was performed.
