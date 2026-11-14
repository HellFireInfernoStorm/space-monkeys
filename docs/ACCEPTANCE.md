# Acceptance checklist

What the challenge asks for, as a list we tick off. Tick an item only after checking it on the deployed site (or say where it was checked), and write the date and how.

Format for a ticked item: `- [x] Item (2026-11-15, checked on the live site with Barnard's Star)`

## A. Required by the challenge objective

- [ ] The tool is on the public web; no login needed
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
- [ ] Spectrum on the fly for a chosen point ("extra kudos" in the challenge text)
- [ ] Add together images taken at different times (stacking). Built and checked locally on 2026-11-14 (live data, local servers, WISE 0855 Stack view in the browser); not yet on a deployed site
- [ ] Subtract images taken at different times (difference image)
- [ ] The user can choose the field of view
- [ ] Overlay of Gaia or WISE data
- [ ] Coordinates in the URL, so the tool can be embedded elsewhere
- [ ] Metadata display, such as contamination flags
- [ ] Uses public tools such as Astropy and Aladin

## D. Our layers

- [ ] Layer 1: wavelength-matched blink and difference images
- [ ] Layer 2: motion-tracked stacking, with WISE 0855
- [ ] Layer 3: click a point for spectrum and light curve, cross-checked once against IRSA's Spectrophotometry Tool
- [ ] Layer 4: WISE-era versus SPHEREx comparison (at least the link to WiseView)
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

Nothing on a deployed site. From the data spike on 2026-11-14 (throwaway scripts, not this code):

- The archive search returns exposures for all five targets.
- WISE 0855 appears at a signal-to-noise ratio of about 18.7 in a motion-tracked stack of 47 exposures.

From the project's own code, run locally in live mode on 2026-11-14 (not a deployed site):

- `/api/stack` for WISE 0855 at 4.4 to 5.0 micrometres: 46 exposures, tracked stack S/N 18.6; two visit stacks show the object stepping about 4 arcseconds west, as predicted (`docs/SCIENCE.md`, section 6). Seen in the browser in the Stack view, and the view came back after reloading the page.
- Barnard's Star blink and difference views load 30 real frames at 1.0 to 1.2 micrometres in the browser.
