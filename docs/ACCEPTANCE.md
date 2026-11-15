# Acceptance checklist

What the challenge asks for, as a list we tick off. Tick an item only after checking it on the deployed site (or say where it was checked), and write the date and how.

Format for a ticked item: `- [x] Item (2026-11-15, checked on the live site with Barnard's Star)`

## A. Required by the challenge objective

- [x] The tool is on the public web; no login needed (2026-11-15, unauthenticated HTTPS requests to `https://spaceshift.earth` and the original Azure frontend address returned HTTP 200; the API health endpoint returned HTTP 200 and allowed both frontend origins. The user confirmed both addresses work. Deployed API mode was `mock`; this does not verify real-data features.)
- [ ] The user can enter Right Ascension and Declination
- [ ] The tool shows SPHEREx images of that patch of sky
- [ ] The images play in time order like a short video
- [ ] A moving object is easy to spot in the playback
- [ ] It is quick: a first view appears within a few seconds for the test targets

## B. The five test targets

For each: the object is found from its name, real SPHEREx frames load, and the expected behaviour is visible.

- [ ] **Barnard's Star**: motion of about 10 arcseconds a year is visible
- [ ] **Epsilon Indi B**: the brown dwarf pair is shown at its present position and its motion is visible
- [ ] **WISE 0855**: found at its present position (not the 2010 position in the challenge text); visible in the motion-tracked stack
- [ ] **RW Aurigae**: brightness change is visible in wavelength-matched frames or in the light curve
- [ ] **R Draconis**: brightness change is visible; the deep-field exposure count is handled without a long wait

## C. Optional considerations from the challenge

- [ ] Easy to update with the latest data release (one configuration change; shown in the demo or the documentation)
- [ ] Creative display of the 102 wavelength bands (for example, one combined image per detector)
- [x] Spectrum on the fly for a chosen point ("extra kudos" in the challenge text) (2026-11-15, checked locally in live mode, not on a deployed site: `/api/photometry` and the spectrum panel, seen in headless-Chrome screenshots; cross-checked against IRSA's Spectrophotometry Tool, see `docs/SCIENCE.md`, section 7. Clicking with a real mouse was not tested; the click-to-position conversion is unit-tested.)
- [x] Add together images taken at different times (stacking). (2026-11-15, checked locally against 46 real WISE 0855 exposures: S/N 14.18 and the same motion at requested sizes 60, 80, 120 and 300 arcseconds; returned image crops and marker offsets covered by regression tests. Stack view was also checked locally in the browser on 2026-11-14; deployment not verified.)
- [ ] Subtract images taken at different times (difference image)
- [ ] The user can choose the field of view
- [ ] Overlay of Gaia or WISE data
- [ ] Coordinates in the URL, so the tool can be embedded elsewhere
- [ ] Metadata display, such as contamination flags
- [ ] Uses public tools such as Astropy and Aladin

## D. Our layers

- [ ] Layer 1: wavelength-matched blink and difference images
- [ ] Layer 2: motion-tracked stacking, with WISE 0855
- [x] Layer 3: click a point for spectrum and light curve, cross-checked once against IRSA's Spectrophotometry Tool (2026-11-15, checked locally in live mode, not on a deployed site. 2MASS check star: our 9 measured exposures are 1.007 to 1.041 times the tool's values, median 1.021; refusals agree in 18 of 19 exposures (`docs/SCIENCE.md`, section 7). Spectrum, light curve, binning and link restore seen in headless-Chrome screenshots; clicking with a real mouse not tested.)
- [x] Layer 4: WISE-era versus SPHEREx comparison (at least the link to WiseView) (2026-11-15, checked locally in live mode, not on a deployed site: AllWISE W2 beside the WISE 0855 SPHEREx stack at 300 arcseconds, seen in headless-Chrome screenshots; 7 of the 8 brightest field stars within 3.2 arcseconds; WISE 0855 found 1.4 arcseconds from its predicted 2010 position (`docs/SCIENCE.md`, section 8). The WiseView link is kept.)
- [ ] Layer 5: automatic flags on moved or changed sources

## E. Submission

- [ ] Project summary, 50 to 200 words
- [ ] Demo: at most 7 slides, or a 30-second video with English subtitles; public link, no login
- [ ] Project details written
- [ ] Use of AI disclosed, from `docs/AI_USAGE.md`
- [ ] NASA data links listed
- [ ] Space agency partner data and all other resources listed, from `docs/RESOURCES.md`
- [ ] No NASA logos, insignia, flags or mission patches in anything AI-generated
- [ ] No names, voices or likenesses of anyone under 18
- [ ] Repository link works for someone who is not signed in
- [ ] Submitted before the deadline (exact time to be confirmed)

## F. Pitch (2026-11-15, 10:00)

- [ ] Five-minute demo rehearsed and timed
- [ ] The demo works with the network off (cached targets) or a recorded fallback exists
- [ ] One sentence each for: impact, creativity, validity, relevance
- [ ] Answers ready for: "How do you know that is not noise?", "What is new compared with IRSA's own tools?", "What happens when new data is released?"

## Verified so far

Deployment/connectivity check, 2026-11-15: `https://spaceshift.earth` and the original Azure Static Web Apps address are publicly reachable over HTTPS. The Azure App Service API allows both frontend origins after the `SM_CORS_ORIGINS` update. The API health endpoint reported `mode: "mock"`; no deployed real-data or science acceptance is claimed by this check.

From the data spike on 2026-11-14 (throwaway scripts, not this code):

- The archive search returns exposures for all five targets.
- WISE 0855 appears at a signal-to-noise ratio of about 18.7 in a motion-tracked stack of 47 exposures.

From the project's own code, run locally in live mode on 2026-11-14 (not a deployed site):

- `/api/stack` for WISE 0855 at 4.4 to 5.0 micrometres: 46 exposures, tracked stack S/N 18.6; two visit stacks show the object stepping about 4 arcseconds west, as predicted (`docs/SCIENCE.md`, section 6). Seen in the browser in the Stack view, and the view came back after reloading the page.
- Barnard's Star blink and difference views load 30 real frames at 1.0 to 1.2 micrometres in the browser.

Layer 3, `/api/photometry` in live mode, run locally through the endpoint code on 2026-11-15 (not a deployed site; seen in headless-Chrome screenshots; cross-checked against IRSA's Spectrophotometry Tool on the 2MASS check star, median ratio 1.021). IRSA's search service returned intermittent 502 errors during these runs, so some collections were missing; results with failed searches are not cached:

- 2MASS check star in the RW Aurigae field (RA 76.97773, Dec +30.37557, H = 9.64, reference 0.143 Jy), 1.6 to 1.8 micrometres, complete search: 19 matching exposures (as in pull request #5); 9 measured at 0.1298 to 0.1466 Jy (pull request #5: 0.1296 to 0.1462 Jy), 10 refused (as in pull request #5). Scatter between exposures 3.8 %; the background-only error bars are about 0.1 mJy.
- RW Aurigae, 0.746 to 1.117 micrometres, one collection of four searched: 11 of 38 exposures measured (0.073 to 0.181 Jy across that wavelength range), 27 with a flagged core.
- R Draconis, 0.746 to 1.117 micrometres: 0 of 69 measured; every aperture holds flagged pixels (saturated), as expected from pull request #5.
- WISE 0855, 4.4 to 5.0 micrometres, measured along its motion, one collection of four searched: 46 matching exposures (as in the stack), 22 measured, 24 with a flagged or missing aperture pixel. Inverse-variance weighted mean 0.554 ± 0.043 mJy (expected about 0.5 mJy: 0.58 from the stack, 0.47 from its WISE magnitude). Median S/N of one exposure 2.4, so only the binned value means anything. **Not a clean check:** the known field star is 4 to 11 arcseconds away at every visit, inside the 18.5-arcsecond aperture, so the aperture flux includes it. Per visit: 0.23 ± 0.28, 0.69 ± 0.09, 0.51 ± 0.05 mJy; not evidence of a brightness change (`docs/SCIENCE.md`, section 7).
