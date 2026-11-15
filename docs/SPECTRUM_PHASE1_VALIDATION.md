# Spectrum phase 1 validation — 2026-11-15

Issue #19, branch `frontend/spectrum-phase-1`, based on main `0a701fd`.

## Automated checks

`npm run typecheck`, `npm test` (80 tests across 10 files), `npm run build`, and `git diff --check` passed. There is no separate frontend lint command. The build reports the existing large Aladin chunk warning. Backend and API files are unchanged.

Pure helper checks cover band overlap midpoint/clipping, nearest-point radius/ties, error-inclusive ranges, negative values, missing-value lanes, single/empty/hidden geometry, tick density, and exposure metadata. Existing unit conversion and binning tests remain unchanged and pass.

## Browser checks

- Mock WISE 0855: at 1440 × 900, both charts, visible wavelength caveat and closed fold-out fit without tab scrolling (`clientHeight = scrollHeight = 719`). Both SVGs are 792 × 220 CSS pixels, with 12 px tick text. At 1280 × 800 they redraw to 648 × 220; scrolling remains available.
- Loaded with `phot=1&tab=sky`, closed the drawer, then opened Spectrum: no SVGs while hidden; both draw on opening. Switched tabs and opened/closed the controls drawer.
- Pointer selection and keyboard Right/Escape select or clear points. Verified two exposure rings and a single tooltip; the tooltip stayed within the chart bounds. Keyboard selection exposes the existing point label through the SVG accessible name. Binned values also have an accessible numerical label.
- Bin produces three mock WISE points and `bin=1` in the URL. Checked the six API band labels in an all-band mock measurement. Close restores the measurement prompt.
- Live WISE 0855, 4.4–5.0 µm: 46 exposures, 22 measured, 24 unmeasured. The neighbouring-star warning and issue #4 link remain visible. Unmeasured points show their refusal reason and detector/ID in the tooltip; both lanes retain 24 points after binning.
- Live Barnard's Star, 1.0–1.2 µm: 30 exposures, all unmeasured. Both charts draw with a lane, no zero-valued dots; keyboard tooltip shows the API reason including OVERFLOW/BLOOM flags.
- No browser console errors in the mock spectrum-first check. Live screenshots were taken while the independent frame request still showed “Loading frames…”.

## Limits

The negative/single-point cases were checked by helper tests, not by a separate browser fixture. Loading shimmer, reduced motion, clicked-background/Back-to-target, error/empty states, bin persistence after reload and pointer tooltips near every edge were not exhaustively exercised by hand. No measurement accuracy or timing claim is added. Real-data checks use the existing local live backend/cache and do not establish a cold archive request's reliability.

## Screenshots

Before uses untouched main at `0a701fd`; the other screenshots use the phase 1 code. These are application captures, not generated artwork.

- [Before at 1440 × 900](screenshots/spectrum-phase1/before-1440.jpg)
- [After at 1440 × 900 with linked tooltip](screenshots/spectrum-phase1/after-1440-tooltip.jpg)
- [After at 1280 × 800](screenshots/spectrum-phase1/after-1280.jpg)
- [All six API band strips, mock](screenshots/spectrum-phase1/all-bands-mock.jpg)
- [WISE 0855, live warning and missing-value lane](screenshots/spectrum-phase1/wise-live.jpg)
- [Barnard's Star, live all-unmeasured lanes and reason](screenshots/spectrum-phase1/barnard-live.jpg)
