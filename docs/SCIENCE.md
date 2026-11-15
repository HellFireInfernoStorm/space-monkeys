# Science notes

Nobody on the team is an astronomer. This file holds the facts we have checked, where each came from, and the mistakes they prevent. If you need a fact that is not here, look it up and add it with its source. Do not guess.

"Measured" below means measured by our own data spike on 2026-11-14 from a home connection in Sri Lanka. Server timings will differ.

## 1. What SPHEREx data looks like

- SPHEREx is a NASA space telescope that maps the whole sky in near-infrared light, 0.75 to 5.0 micrometres, about every six months.
- It has six detectors, called bands 1 to 6. Each exposure produces one image per detector: 2040 by 2040 pixels, 6.15 arcseconds per pixel, about 3.5 degrees on a side. One file is about 66 MB.
- The star images are about 7.5 arcseconds wide (full width at half maximum), a little more than one pixel.

| Band | Wavelength range (micrometres) |
| --- | --- |
| 1 | 0.746 to 1.117 |
| 2 | 1.103 to 1.650 |
| 3 | 1.630 to 2.435 |
| 4 | 2.403 to 3.847 |
| 5 | 3.811 to 4.430 |
| 6 | 4.412 to 5.010 |

Source: IRSA SPHEREx tutorial notebooks (see `docs/RESOURCES.md`), with detector endpoints corrected from the team's live check in [issue #4](https://github.com/HellFireInfernoStorm/space-monkeys/issues/4). Adjacent detector ranges overlap; the earlier rounded ranges introduced artificial gaps. This does not change wavelengths measured at a target from `WCS-WAVE`.

### The wavelength changes across each image

This is the fact that most affects our design. Each detector sits behind a filter whose colour changes smoothly from one edge to the other. A star seen at 4.5 micrometres in one exposure is seen at 4.8 micrometres in the next, because the telescope has shifted and the star has landed on a different part of the detector.

**Consequence:** two exposures of the same position usually show it at different wavelengths. If we blink or subtract them, a red star will look as if it changed brightness when it only changed colour. Layer 1 therefore matches exposures by wavelength at the target before comparing them.

The blink view warns about colour when the longest wavelength among its frames is more than 1.25 times the shortest (our choice, `WAVELENGTH_SPREAD_WARNING` in `frontend/src/blink.ts`). Reason: beyond its peak a star's brightness falls roughly as wavelength to the power -2, so a spread of 1.25 alone can change it by about 1.6 times; less than that is smaller than the changes our variable targets show. A narrowed range such as 1.0 to 1.2 micrometres (1.2) is not flagged, though colour can still change a star's brightness there by up to about 1.4 times.

How to get the wavelength at a pixel (from the IRSA tutorial; needs the whole header unit list, not only the image):

```python
spectral_wcs = WCS(header=hdulist["IMAGE"].header, fobj=hdulist, key="W")
spectral_wcs.sip = None
wavelength, bandwidth = spectral_wcs.pixel_to_world(x, y)
```

The `WCS-WAVE` extension holds the lookup table this uses.

### What is in a file

| Extension | Contents |
| --- | --- |
| `IMAGE` | Brightness in MJy/sr. The zodiacal light (sunlight scattered by dust in the solar system) is still included. |
| `FLAGS` | One integer per pixel; each bit marks a problem or a property (section 4) |
| `VARIANCE` | Uncertainty of each pixel, squared |
| `ZODI` | Model of the zodiacal light, not subtracted from `IMAGE` |
| `EPSF` | Shape of a star image at positions across the detector |
| `WCS-WAVE` | Wavelength lookup table |

To turn MJy/sr into a flux for a source, multiply by the solid angle of the pixels. IRSA publishes a solid angle map per detector (see `docs/ARCHITECTURE.md`); as a first approximation a 6.15 arcsecond pixel is 8.89e-10 steradians.

## 2. Positions and motion

- All coordinates in our API are ICRS, in decimal degrees. Proper motions are in milliarcseconds per year, with the right ascension component already multiplied by cos(declination), as catalogues give it. Times are Modified Julian Dates (MJD).
- Nearby stars move across the sky. A catalogue position is correct only for the catalogue's date. Before searching or cutting out an image, move the position to the date of the exposure:

```
ra  = ra0  + pmra  * years / 3_600_000 / cos(dec0)
dec = dec0 + pmdec * years / 3_600_000
```

This straight-line formula ignores parallax and the curvature of the sky. For our targets and a 6.15 arcsecond pixel the error is well under one pixel, so searches, cut-outs and tracking use it. The code is `propagate()` in `backend/app/targets.py`.

- **Parallax** is the yearly wobble caused by Earth going round the Sun: a star appears displaced away from Earth's position, by its parallax times the part of Earth's distance from the Sun seen across the line of sight. For WISE 0855 (439 mas) it moves the star by up to 0.44 arcseconds, and between the two visits we stack (November 2025 and late April 2026, Earth on opposite sides of the Sun) it changes the predicted step by 0.82 arcseconds west and 0.24 north: larger than our measurement error, so the motion table includes it when the parallax is given (`parallax_offset()` in `backend/app/targets.py`; Earth's position from the low-precision solar formula of the Astronomical Almanac, checked against Astropy). Patches are still centred by proper motion alone: parallax is under a tenth of a pixel.
- **WISE 0855 is not where the challenge text says.** The coordinates in the challenge (133.795129, -7.245147) are its position around 2010. It moves 8.15 arcseconds a year. In 2026 it is near 133.7601, -7.2422, about two arcminutes away. Across the SPHEREx data we stack (2025-05-05 to 2026-05-11, 1.02 years) it moves about 8.3 arcseconds, 1.35 pixels; between the two visits with enough exposures, 3.6 arcseconds from proper motion alone.

## 3. The five test targets

Positions are ICRS at epoch 2000.0 from SIMBAD, queried 2026-11-14. `backend/app/targets.py` holds the same numbers.

| Target | RA (deg) | Dec (deg) | Proper motion RA, Dec (mas/yr) | Parallax (mas) | What it is | What to show |
| --- | --- | --- | --- | --- | --- | --- |
| Barnard's Star | 269.452077 | 4.693365 | -801.6, +10362.4 | 547.0 | Red dwarf; fastest-moving star in the sky | Clear motion, about 10 arcseconds a year |
| Epsilon Indi B | 331.044147 | -56.782844 | +3982.0, -2466.8 | 270.7 | A pair of brown dwarfs orbiting the star Epsilon Indi A | Motion of 4.7 arcseconds a year; bright star A is 7 arcminutes away |
| WISE 0855 | 133.818908 | -7.247048 | -8123.7, +673.2 | 439.0 | The coldest known brown dwarf | Needs many exposures stacked; tracking sharpens it slightly, but a static stack also shows it |
| RW Aurigae | 76.956526 | 30.401438 | +7.2, -20.3 | 15.4 | Young variable star (T Tauri type) | Saturated and flagged in 19 of 19 tested frames at 1.6 to 1.8 micrometres |
| R Draconis | 248.167611 | 66.754979 | -20.6, +6.1 | 1.25 | Pulsating red giant (Mira type) | Saturated and flagged in 40 of 40 tested frames at 2.1 to 2.3 micrometres; unsuitable for a light-curve demo there |

Sources: Gaia DR3 through SIMBAD for all except WISE 0855 (Kirkpatrick et al. 2021, bibcode 2021ApJS..253....7K) and the RW Aurigae system entry (van Leeuwen 2007, bibcode 2007A&A...474..653V).

Notes:

- SIMBAD has one entry for Epsilon Indi B, not separate entries for the two brown dwarfs. They are less than one arcsecond apart, far below our pixel size, so we treat them as one source.
- R Draconis is the name SIMBAD knows as `V* R Dra`; RW Aurigae is `V* RW Aur`.
- After strict masking, the shortest detector range (0.746 to 1.117 micrometres) has complete 3 by 3 target cores in 13 of 40 sampled RW Aurigae frames (56 wavelength matches), but 0 of 40 sampled R Draconis frames. R Draconis is probe-capped (400 of 676 candidates, 339 matches among those checked); this is a sampled check, not a claim about every exposure. The earlier ranges remain unusable: 0 of 19 RW Aurigae cores and 0 of 40 R Draconis cores are complete. Bad flags need not mean saturation in every individual exposure; a complete core is a flag-quality check, not a photometric calibration. The five-target list is unchanged.

### How much data each target has

Exposures whose image covers the target position, searched with a 0.005 degree radius on 2026-11-14. A search returns every detector image that overlaps the position, so these counts are images, not sky visits.

| Target | `spherex_dr1` | `spherex_qr3` | `spherex_dr1_deep` | `spherex_qr3_deep` | Date range |
| --- | --- | --- | --- | --- | --- |
| Barnard's Star | 239 | 123 | 0 | 0 | 2025-08-15 to 2026-09-22 |
| Epsilon Indi B | 343 | 120 | 0 | 0 | 2025-04-24 to 2026-10-02 |
| WISE 0855 | 258 | 0 | 0 | 0 | 2025-05-05 to 2026-05-14 |
| RW Aurigae | 226 | 110 | not checked | not checked | not recorded |
| R Draconis | 421 | 126 | 1,226 | 729 | not recorded |

R Draconis lies in one of the survey's deep fields near the north ecliptic pole. It has about 2,500 exposures, which is why the API caps the number returned per request.

### WISE 0855: what we measured

- A typical single exposure at 4.4 to 5.0 micrometres has PSF S/N 4.66: below our detection threshold of 5, and not a reliable visual detection. The earlier approximate 2-sigma statement used a different statistic and is superseded.
- Stacking 46 exposures at 4.4 to 5.0 micrometres gives PSF S/N 14.18 tracked and 11.44 static. Both detect it; tracking sharpens it. These numbers are identical for 60, 80, 120 and 300 arcsecond image requests. Measurements use an internal grid at least 21 pixels wide; only the returned pictures and their marker coordinates are cropped.
- It is not detectable at shorter wavelengths. An unrelated faint source about 7 arcseconds away is visible at short wavelengths; do not mistake it for the target.

## 4. Pixel flags

The `FLAGS` image has one bit per condition. The names and meanings below come from the header of the `FLAGS` extension itself (keywords `MSKNnnnn` and `MSKDnnnn`). The share column is what we measured over 619,458 pixels in patches around WISE 0855.

| Bit | Name | Meaning | Share of pixels | Mask it? |
| --- | --- | --- | --- | --- |
| 0 | TRANSIENT | Transient detected during sample-up-the-ramp readout | 0.58% | yes |
| 1 | OVERFLOW | Overflow detected during readout | 0.02% | yes |
| 2 | SUR_ERROR | Error in onboard processing | 0.41% | yes |
| 6 | NONFUNC | Permanently unusable | 0.35% | yes |
| 7 | DICHROIC | Low efficiency due to dichroic | 0.54% | yes |
| 9 | MISSING_DATA | Onboard data lost | not seen | yes |
| 10 | HOT | Hot pixel | not seen | yes |
| 11 | COLD | Anomalously low signal | 0.05% | yes |
| 12 | FULLSAMPLE | Pixel full sample history is available | not measured | **no, informational** |
| 14 | PHANMISS | Phantom correction was not applied | not seen | yes |
| 15 | NONLINEAR | Nonlinearity correction cannot be applied reliably | not seen | yes |
| 17 | PERSIST | Persistent charge above threshold | 0.26% | yes |
| 19 | OUTLIER | Pixel flagged by outlier detection | 1.54% | yes |
| 20 | CROSSTALK | Pixel affected by crosstalk | about 0 | yes |
| 21 | SOURCE | Pixel mapped to a known source | 44.5% | **no, informational** |
| 22 | GHOST | Affected by a bright source inside the exposure | not seen | yes |
| 23 | GHOST_FPA | Affected by a bright source on another detector | not seen | yes |
| 24 | GHOST_EXT | Affected by a bright source outside the field of view | not seen | yes |
| 25 | STREAK | Pixel affected by a streak | 0.07% | yes |
| 26 | BLOOM | Pixel part of a bloom artifact | not seen | yes |
| 27 | SNOWBALL | Pixel part of a snowball artifact | not seen | yes |
| 28 | HALO | Pixel part of a transient halo | 1.47% | yes |

**The trap:** bit 21 is set on nearly half of all pixels, including the very stars we want to look at. Masking "any flag set" throws the targets away. Use `DEFAULT_BAD_MASK` in `backend/app/flags.py`, which is every bit except 12 and 21. Read the bit names from the file header rather than assuming this table still holds for a new data release.

**Bright stars carry bad-pixel bits too.** In one exposure of Barnard's Star at 1.1 micrometres (`2025W34_2B_0090_4-D2`), a 6 by 6 pixel block around the star has OVERFLOW, SUR_ERROR, TRANSIENT and BLOOM set, while most of those pixels still hold values in the hundreds to thousands of MJy/sr and three are empty (measured 2026-11-14). Masking them removes the star itself, so the live blink view shows their values and uses the mask only for background, scaling and differences (`docs/ARCHITECTURE.md`).

## 5. Where the data comes from

**Issue #4 comparison-star check (2026-11-14).** At the supplied J2000 position RA 76.97773, Dec +30.37557 in the RW Aurigae field, the 19 exposures at 1.6 to 1.8 micrometres give unmasked aperture fluxes of 0.1296 to 0.1743 Jy. A radius of 3 pixels and median background from an annulus of 5 to 7.5 pixels were used, converting MJy/sr with the square of the 6.15 arcsecond pixel scale in radians. Strict masking gives 9 complete-aperture measurements of 0.1296 to 0.1462 Jy and 10 empty apertures. None returns the previously reported 0.030 to 0.085 Jy fraction. Relative to the supplied 2MASS reference of 0.143 Jy, unmasked ratios are 0.906 to 1.219 and surviving masked ratios are 0.906 to 1.022. Small background differences arise from excluding flagged annulus pixels. The reference flux was supplied with the comparison position; the catalogue was not queried again. Reproduce from `backend/` with `python scripts/check_accuracy.py --flux-star 76.97773 30.37557`. This is a diagnostic, not the deferred photometry endpoint.

| Collection | What it is |
| --- | --- |
| `spherex_dr1` | Data Release 1: the first year of the all-sky survey |
| `spherex_qr3` | Quick Release 3: newer months, released fast with earlier calibration |
| `spherex_dr1_deep` | Data Release 1 exposures of the two deep fields near the ecliptic poles |
| `spherex_qr3_deep` | Quick Release 3 exposures of the deep fields |

Collection names live in `backend/app/config.py` and nowhere else.

- **Search:** IRSA's Simple Image Access service at `https://irsa.ipac.caltech.edu/SIA`, one query per collection. Each takes about 0.5 to 5 seconds.
- **Pixels:** every search row carries a `cloud_access` field giving the file's location on the AWS mirror (bucket `nasa-irsa-spherex`, region `us-east-1`). We read only the bytes for the patch we need. Measured: 258 patches in 75 seconds with 32 parallel readers. Both `spherex_dr1` and `spherex_qr3` rows carry this field.
- **Do not use the IRSA cutout service for bulk work.** Measured: about 4 MB and 8 to 16 seconds per cutout, and it answers HTTP 503 when more than about 8 requests run at once.

## 6. Stacking (layer 2)

**What it is.** Stacking means adding many exposures of the same patch of sky together (strictly, averaging them pixel by pixel). Every exposure has random noise, different each time, plus the light of whatever is really there, the same each time. Averaging keeps the real light and lets the noise partly cancel.

**Why the noise falls with the square root.** The average of N independent noisy values scatters by the noise of one value divided by the square root of N. So 4 exposures halve the noise, 100 exposures cut it to a tenth. An object at 2 sigma in one exposure (signal twice the noise) should reach about 2 times the square root of 46, roughly 13.5 sigma, in a stack of 46. That is ideal; in practice the gain is smaller, because the exposures are at different wavelengths, some noise is shared between neighbouring pixels after resampling, and faint stars add a little "noise" of their own.

"Sigma" here means signal-to-noise ratio (S/N): the PSF amplitude above the local sky divided by the scatter of the same measurement at control positions. We fit a fixed Gaussian of width 0.8 pixel plus a constant sky in a 5 by 5 aperture. The noise is the sample standard deviation of identical apertures at integer offsets 4 to 7 pixels from the target, minus their median level. This includes correlated resampling noise and field-source confusion; it is conservative where control apertures overlap faint stars. At least 20 complete control apertures are required. A missing pixel in the target aperture means no S/N. This signed statistic has no brightest-pixel selection bias; blank Gaussian-noise fields are centred near zero with unit scatter in tests. Exposure backgrounds and weights use the same fixed local annulus (3 to 8 pixels) for every field size. Targets sit on pixel centres in odd grids. The internal measurement grid is at least 21 pixels wide, even when the requested image is smaller, so the complete control ring is always available. If masking or a detector edge still prevents S/N, the response includes an explanatory warning. We require S/N of at least 5 to measure a faint source's motion.

**Three kinds of stack** (code: `backend/app/stacking.py`; details in `docs/ARCHITECTURE.md`):

- **Tracked**: every exposure is shifted so that the object's predicted position (catalogue position moved by its proper motion to that exposure's date, section 2) lands on the same pixel. The object adds up; background stars, which do not move, are smeared along the object's path in reverse.
- **Static**: every exposure on one fixed sky grid. Stars are sharp; a moving object is smeared along its path.
- **Per visit ("epoch")**: SPHEREx sees each part of the sky in visits about six months apart. One static stack per visit, all on the same grid. Blinking them shows the object step from visit to visit while the stars stay put. Measuring where the object is in each visit's stack, and comparing with where the catalogue motion says it should be, is a direct check that the faint dot is the moving brown dwarf and not a background star.

**Masked pixels and outliers.** Flagged pixels (section 4) never count. A value far from the other exposures at the same pixel (more than 4 noise levels from their median) is dropped: cosmic rays, satellite trails and artifacts appear in one exposure only. Each exposure counts in proportion to 1 / noise squared, so quieter exposures count more.

**WISE 0855, measured 2026-11-14** (4.4 to 5.0 micrometres, 46 exposures from 2025-05-05 to 2026-05-11, `dr1` only):

| Image | S/N at the predicted position |
| --- | --- |
| A typical single exposure (median among usable PSF measurements) | 4.66 |
| Tracked stack, 46 exposures | 14.18 at 60, 80, 120 and 300 arcseconds |
| Static stack, 46 exposures | 11.44 at all four sizes |
| Visit 1 fixed-grid stack, 22 exposures, 2025-11-07 to 2025-12-13 | 11.2 |
| Visit 2 fixed-grid stack, 21 exposures, 2026-04-21 to 2026-05-11 | 11.46 |


**How the position in a visit is measured** (2026-11-14, issue #4 correction; code `measure_visit` in `backend/app/stacking.py`):

- The visit's exposures are stacked as read, each centred on the proper-motion position. A Gaussian (width fitted between 0.45 and 1.6 pixels) is fitted on a 5 by 5 window, weighted by formal pixel noise. For WISE 0855 a second Gaussian represents the fixed field star at approximately RA 133.7582, Dec -7.2412 (catalogue position supplied in [issue #4](https://github.com/HellFireInfernoStorm/space-monkeys/issues/4)). It has an independent nonnegative amplitude and shares the target's fitted width. Its position is projected into every exposure's grid and averaged for that visit, including in each bootstrap draw; the target remains free. These approximate neighbour coordinates have no supplied catalogue identifier or position error, so the bootstrap does not include uncertainty in them.
- Why not the fixed-grid visit stacks shown in the blink: those have been resampled twice (detector to grid, then a sub-pixel shift onto the fixed grid). In a simulation of this pipeline with the real WISE 0855 exposure times and shifts and almost no noise, the second shift moved the fitted step between the two visits by 0.5 arcseconds east, and the old method (brightness-weighted centre of 3 by 3 pixels) by 0.5 west and 0.5 north. In object-centred stacks the object sits at the same pixel phase in both visits, and the same simulation recovers the step to 0.03 arcseconds.
- Uncertainty: a bootstrap. Each visit is re-stacked 200 times from its own exposures drawn at random with repeats, and re-fitted; the spread of the fitted positions is the error. The two visits are independent, so their errors add in quadrature. The new bootstrap errors for the step are 0.57 arcseconds east-west and 0.56 north-south. They include exposure noise and blending covariance, but not errors in the fixed neighbour catalogue position or the Gaussian PSF model.
- Checks for systematic errors (2026-11-14, a 400 arcsecond field around WISE 0855 at 4.4 to 5.0 micrometres): the three brightest field stars (S/N 93 to 183) scatter by 0.25 to 0.6 arcseconds from exposure to exposure (this includes their measurement noise), and their mean position moves by 0.0 to 0.2 arcseconds between the two visits. So per-exposure pointing errors are not the cause of a 1 to 2 arcsecond difference, and the bootstrap already contains them. Splitting each visit into its shorter and longer half of wavelengths (4.55 and 4.84 micrometres on average) moves the fitted position by 0.3 to 0.8 arcseconds, within those halves' errors (0.3 to 0.5): no wavelength effect is detected. The two visits have similar mean wavelengths (4.68 and 4.72).

**The measured motion of WISE 0855 between its two visits** (46 exposures, 4.4 to 5.0 micrometres, parallax 439 mas; offsets of visit 2 from visit 1, arcseconds):

| | East-west | North-south |
| --- | --- | --- |
| Predicted: proper motion | 3.62 W | 0.30 N |
| Predicted: parallax | 0.82 W | 0.24 N |
| Predicted: total | 4.44 W | 0.54 N |
| Measured (± 1 sigma, bootstrap) | 3.90 ± 0.57 W | 0.99 ± 0.56 N |
| Measured minus predicted | 0.54 E (0.95 sigma) | 0.45 N (0.80 sigma) |

The quoted 0.57 and 0.56 arcsecond uncertainties are statistical bootstrap errors, not full errors: uncertainty in the fixed neighbour position and PSF systematics are excluded. The measurement agrees with the prediction within its statistical errors. Holding the new grid, masking and weighting fixed, the single-source fit gives 3.57 ± 0.45 W and 0.93 ± 0.39 N. Including the field star reduces the east-west residual from 0.87 to 0.54 arcseconds. The original even-grid, single-source result (3.88 ± 0.44 W, 1.01 ± 0.41 N) is superseded. All new values above were reproduced at all four field sizes with 46 real exposures; predicted coordinates, times, wavelengths and motion were unchanged.

**Limits:**

- The object moves only about 8 arcseconds (1.35 pixels) across the year of data, and 4.4 arcseconds (0.7 pixel) between the two visits that have enough exposures. Tracked and static stacks therefore look similar, so following the opposite motion is not a useful non-detection control. The local control apertures used for PSF noise are the more useful comparison.
- The stack is broadband: it adds exposures from 4.4 to 5.0 micrometres, each at a different wavelength. It shows that something is there, not its spectrum.
- The pictures and markers are on the 6.15 arcsecond pixel grid. The fitted positions are finer than that, with the errors stated; what limits them is the object's per-visit S/N and the different pixel phase of each exposure's resampling, not the grid.
- Parallax enters only through the `parallax` parameter (the site sends the built-in targets' values). Without it the prediction is proper motion alone and, for WISE 0855, off by 0.8 arcseconds.
- Bright stars: flagged cores still have display images and predicted positions, but their measured motion and errors are omitted. A Gaussian fitted to saturated wings can give a precise-looking, systematically biased result. The review measured Barnard's Star's middle-visit step as 3.35 arcseconds east against 0.60 predicted, despite its small formal error; we therefore skip saturated-core motion rather than quote a misleading confidence interval. A live rerun at 1.0 to 1.2 micrometres confirmed all three visits are marked saturated and have no measured motion or reported error. Warnings explain the omission.

### Isolated-source check: Epsilon Indi B

Rechecked 2026-11-15 at 4.4 to 5.0 micrometres, size 120 arcseconds, 96 exposures in four visits (three offsets from the first). The main-branch baseline is `fd01f735`; the review revision uses the same exposures and predictions. No known neighbour is selected for this target. Signed offsets are east and north in arcseconds; errors are bootstrap errors.

| Later visit MJD | Predicted E, N | Main measured E, N | Revised measured E, N |
| --- | --- | --- | --- |
| 60954.59 | 1.25, -1.31 | 1.15 ± 0.17, -1.58 ± 0.17 | 1.27 ± 0.09, -1.43 ± 0.10 |
| 61159.97 | 3.90, -2.39 | 4.01 ± 0.28, -2.62 ± 0.22 | 4.08 ± 0.11, -2.53 ± 0.10 |
| 61308.86 | 5.14, -3.72 | 5.00 ± 0.18, -3.85 ± 0.14 | 5.06 ± 0.10, -3.93 ± 0.08 |

The revised positions differ from main by at most 0.15 arcsecond in either component, and remain within 0.21 arcsecond of the predictions. This checks an isolated source alongside the blended WISE case; it does not establish that bootstrap errors include PSF systematics.

## 7. Quick-look photometry (layer 3)

Code: `backend/app/photometry.py`. Each exposure covering a point gives one sample (wavelength, brightness, time); against wavelength the samples make a spectrum, against time a light curve.

**Method.** Aperture of radius 3 pixels (18.5 arcseconds) around the point, at the object's position on the date of each exposure (proper motion and parallax). Background: the median of an annulus from 5 to 7.5 pixels. MJy/sr times the solid angle of one 6.15-arcsecond pixel gives janskys; the API reports microjanskys (`uJy`), as in mock mode. This is the aperture checked against 2MASS in pull request #5, moved into the app; `backend/scripts/check_accuracy.py` uses the same code.

**Visit grouping in the interface.** Start a new visit when consecutive exposure MJDs, sorted by time, differ by more than 60 days. This is the display convention specified in [issue #30](https://github.com/HellFireInfernoStorm/space-monkeys/issues/30), not a measured survey cadence: the WISE 0855 clusters documented below (60801, 60989–61021, 61151–61171) span up to 32 days and have gaps of 130–188 days, so 60 days separates those clusters. The count uses all returned exposures, including refused apertures. It does not establish physically distinct visits for every possible target.

**Refused points.** Any empty pixel in the aperture (flagged, missing or off the detector) means no flux: `usable` is false and `reason` says why, with the names of the problem flags. A partial sum would report a fraction of a star, for example a saturated core, as if it were a faint star. Empty pixels in the annulus are left out of the background.

**Error.** sigma * sqrt(N_ap + (pi / 2) * N_ap^2 / N_sky), with sigma the robust standard deviation (1.4826 times the median absolute deviation) of the annulus. This is background noise only. It leaves out the photon noise of the source and calibration differences, and resampling makes neighbouring pixels slightly correlated. It is far too small for bright stars: on the 2MASS check star below, the scatter between exposures was 3.8 % against error bars of about 0.1 %.

**Measured on 2026-11-15** (live mode, local, not a deployed site):

| Check | Expected | Measured |
| --- | --- | --- |
| 2MASS star RA 76.97773, Dec +30.37557 (H = 9.64, 0.143 Jy), 1.6 to 1.8 µm, complete search | Pull request #5: 9 complete apertures at 0.1296 to 0.1462 Jy, 10 refused | 19 matching; 9 measured at 0.1298 to 0.1466 Jy, 10 refused. The small difference in range comes from the pixel grid: our patches are centred on the star, the script's on RW Aurigae |
| WISE 0855, 4.4 to 5.0 µm, along its motion, one collection of four searched | About 0.5 mJy (0.58 from the stack, 0.47 from its WISE magnitude) | 46 matching, 22 measured; weighted mean 0.554 ± 0.043 mJy. **Includes a field star**: see below |
| RW Aurigae, 0.746 to 1.117 µm, one collection searched | 13 of 40 complete cores (pull request #5) | 11 of 38 measured |
| R Draconis, 0.746 to 1.117 µm | None usable | 0 of 69 (all saturated) |

**WISE 0855 and its neighbour.** The fixed field star near RA 133.7582, Dec −7.2412 (`targets.py`) is 11.2 arcseconds from WISE 0855 at the first visit (MJD 60801), 8.1 to 7.4 at the second (MJD 60989 to 61021) and 4.3 to 3.9 at the third (MJD 61151 to 61171): always inside the 18.5-arcsecond aperture. The aperture flux is the sum of both, so the 0.554 mJy above does not measure WISE 0855 alone. Per visit: 0.23 ± 0.28 mJy (1 point), 0.69 ± 0.09 mJy (6 points), 0.51 ± 0.05 mJy (15 points). The difference between visits is not evidence of a brightness change: the star's share of the aperture changes as the object moves. The stack (section 6) fits the two separately; the aperture cannot.

**Cross-check against IRSA's Spectrophotometry Tool** (2026-11-15; single object, point source, no deep fields; the tool's result was downloaded as a VOTable and compared exposure by exposure on `obs_publisher_did`). For the 2MASS check star, all 9 of our measured exposures at 1.6 to 1.8 µm are in the tool's result:

| Exposure | Wavelength (µm) | Ours (Jy) | IRSA (Jy) | Ours / IRSA |
| --- | --- | --- | --- | --- |
| 2025W37_1A_0496_2 D2 | 1.628 | 0.1446 | 0.1435 ± 0.0043 | 1.007 |
| 2025W38_1A_0538_2 D3 | 1.664 | 0.1466 | 0.1439 ± 0.0043 | 1.018 |
| 2025W38_1A_0538_3 D3 | 1.702 | 0.1438 | 0.1386 ± 0.0042 | 1.037 |
| 2026W09_2A_0224_2 D3 | 1.635 | 0.1426 | 0.1408 ± 0.0042 | 1.013 |
| 2026W09_2A_0224_3 D3 | 1.672 | 0.1380 | 0.1351 ± 0.0041 | 1.021 |
| 2026W09_2A_0552_1 D3 | 1.750 | 0.1395 | 0.1358 ± 0.0041 | 1.028 |
| 2026W09_2A_0552_2 D3 | 1.790 | 0.1298 | 0.1246 ± 0.0038 | 1.041 |
| 2026W37_2A_0630_1 D2 | 1.613 | 0.1464 | 0.1449 ± 0.0044 | 1.010 |
| 2026W38_1A_0162_1 D3 | 1.648 | 0.1453 | 0.1410 ± 0.0043 | 1.031 |

- Ours are higher by a median of 2.1 % (1.007 to 1.041). Six of the nine differences are within one of the tool's error bars (about 3 %); the other three (1.648, 1.702 and 1.790 µm) are 1.0, 1.2 and 1.4 error bars above. The cause of the offset is not known; aperture photometry against the tool's model fit is one candidate. We did not adjust anything to remove it.
- The tool's errors (about 3 %) match the 3.8 % scatter we see between exposures, which confirms that our background-only error bars are too small for a bright star.
- Refusals agree in 18 of 19 exposures. Our 9 measured exposures carry only flag bit 21 (informational) in the tool's result; 9 of our 10 refused ones carry problem bits there (OVERFLOW, TRANSIENT, SUR_ERROR, HALO; their lower 32 bits equal the flags we report). The exception, MJD 61297.861 at 1.765 µm, is clean in the tool but holds a HALO-flagged pixel in our 3-pixel aperture. The tool also sets a bit 32, which is not in our flag table (section 4); we have not looked up its meaning.

**Limits.** Saturated stars give no light curve (R Draconis; RW Aurigae except at the shortest wavelengths). A light curve over a wide wavelength range mixes colour with change. The values are quick estimates; IRSA's Spectrophotometry Tool is the precise method.

**AB display units.** AB magnitude = −2.5 log10(flux / 3631 Jy); the propagated error is (2.5 / ln 10) × flux error / flux, defined only for positive flux. Source: [Oke & Gunn (1983), ApJ 266, 713](https://articles.adsabs.harvard.edu/pdf/1983ApJ...266..713O). Flux summaries are averaged before conversion.

### Colour-corrected light curve (layer 3, phase 3)

**Why.** Each exposure sees the point at a different wavelength (section 1), so a raw light curve mixes the object's colour with any real change. The corrected light curve divides the colour out.

**Method.** The code is in `frontend/src/photometry.ts` (`spectrumAt`, `correctedPoints`, `visitMeans`, `changeVerdict`).

1. The spectrum S(λ) is the binned spectrum the tab draws: inverse-variance weighted means in equal-width wavelength bins (about four exposures per bin).
2. S at an exposure's wavelength is that bin's own value when the wavelength is a bin centre (a bin holding one exposure is centred on it). Elsewhere it comes from linear interpolation between bin centres, taking the larger of the two bins' errors. Beyond the outermost bin centres the end bin's value is used for up to one bin width. Nothing is used across a gap of more than two bin widths between centres, where S ≤ 0, or where S/N < 5 (section 6). Such exposures are shown as "Not corrected", with no value.
3. Each exposure's ratio r = f / S has error sqrt(σ_f² + (r σ_S)²) / S. A ratio of 1 means the usual brightness at that wavelength.
4. Exposures are grouped into visits wherever consecutive exposures are more than 60 days apart. The ratios in each visit are averaged with inverse-variance weights.
5. Each visit's error is the formal error of that mean combined in quadrature with 3.8 %, the exposure-to-exposure scatter of the steady 2MASS check star above.
6. **Changed?** compares every pair of visits that each have at least 3 corrected exposures: z = |r_a − r_b| / sqrt(err_a² + err_b²). z ≥ 5 is reported as a change and 3 ≤ z < 5 as unclear. Below 3 it reports "No sign", with the visit-average difference that could not have been seen (5 × the smallest combined error). Visits with fewer than 3 exposures are drawn but not compared, and "No sign" and "Unclear" say how many were left out.
7. It is not judged at all when the API sends a warning other than the count of unmeasured points or the note that exposures were sampled evenly over time: a field star in the aperture, a failed archive search, or unreadable exposures. It is also not judged when fewer than 3 exposures can be corrected.

The tab offers the corrected view only when the combined S/N is at least 5 and at least 3 exposures can be corrected.

**Assumptions.**

- **The 3.8 % floor is not reduced by averaging.** We do not know whether that scatter comes from calibration that would average out. Not reducing it makes a reported change harder to reach, so it is the conservative choice. With a floor of 3.8 % per visit, two visits cannot show a change smaller than about 27 %.
- **The 60-day gap is a display convention** (section 7, "Visit grouping in the interface"): SPHEREx visits last up to about a month and are months apart.
- The thresholds are the detection threshold of section 6 (5) and 3 for "unclear". They were set before the validation below and not changed after it.

**Limits.**

- The result is relative to the object's own average over all visits, not an absolute calibration.
- Each exposure is part of the spectrum it is divided by, and a changing object blurs its own spectrum. Both pull ratios toward 1, so the method under-reports change. So the limit in "No sign" applies to the visit averages, not to the object. Measured in the review of pull request #33, by making one visit brighter by a known factor on the real dates, wavelengths and errors: on Epsilon Indi B (59 exposures, 4 visits), a real 40 % change came out as a 28 to 37 % difference ("Yes"). On the check star (9 exposures, 3 visits), 40 % came out as 23 % ("Unclear") and 60 % as 32 % ("Yes"). Real changes come out about a quarter to a half smaller, and more so where a wavelength bin holds exposures from only one visit (on the check star, the top bin, 1.73 to 1.79 µm). Where a visit alone covers some wavelengths, its exposures are divided by themselves, and a change there cannot be seen at all. The thorough fix is to divide each exposure by a spectrum built without its own visit; that is not done yet.
- A field star in the aperture changes its share as the object moves (WISE 0855, above). That is why any such warning withholds the verdict.

**Validation (2026-11-15, live, local; the same code and cached API results as the interface, seen in headless-Chrome screenshots).**

| Target, range | Measured, corrected | Visit averages (exposures) | Verdict | Expected |
| --- | --- | --- | --- | --- |
| 2MASS check star (RA 76.97773, Dec +30.37557), 1.6–1.8 µm | 9 of 19, 9 | 1.017 (3), 0.986 (4), 1.011 (2) | No sign; a visit-average change under 27 % could not be seen; 1 visit with fewer than 3 exposures not compared | No sign (steady star). Raw fluxes span 129.8 to 146.6 mJy, mostly colour |
| Epsilon Indi B, 4.4–5.0 µm | 59 of 96, 59 | 0.987 (14), 1.026 (15), 0.999 (7), 1.012 (23) | No sign; a visit-average change under 27 % could not be seen | Isolated source (section 6). Raw fluxes span 16.8 to 31.3 mJy because of its deep spectral dip near 4.5 µm; the correction removes it |
| WISE 0855, 4.4–5.0 µm | 22 of 46, 12 | 0.941 (4), 0.949 (8) | Not judged (field-star warning) | Not judged: differences between visits are not evidence of change (above) |
| RW Aurigae, 0.746–1.117 µm | 13 of 56, 13 | 0.775 (9), 1.102 (2), 1.649 (2) | Not judged: the later visits have only 2 exposures each | A young variable star. The visit averages differ by far more than their errors, but the rule of 3 exposures per visit was not relaxed to make it report a change |

R Draconis was not checked: every aperture is saturated at the shortest wavelengths (above), so nothing can be corrected.

## 8. WISE comparison (layer 4)

The spectrum interface marks WISE W1 at 3.4 µm and W2 at 4.6 µm, matching `backend/app/wise.py`; these are centre markers, not sourced filter edges.

Code: `backend/app/wise.py`. The AllWISE Atlas image (WISE observations of 2010, combined) of the same field as the SPHEREx image, at WISE's 1.375-arcsecond pixels, north up, east left (details: `docs/ARCHITECTURE.md`). Dates come from the tile header: for WISE 0855's tile (`1342m076_ac51`), the frames span 2010-05-03 to 2010-11-13, middle frame 2010-05-06.

**Checked on 2026-11-15** (live, local; WISE 0855 at 4.4 to 5.0 µm, 300-arcsecond field, the fixed-grid SPHEREx stack against AllWISE W2):

- **Field stars line up.** Of the 8 brightest stars in the SPHEREx stack, 7 have a WISE counterpart within 1.0 to 3.2 arcseconds (under half a SPHEREx pixel); median offset 0.9 arcseconds east-west and 0.3 north-south. The eighth is 9.3 arcseconds from the nearest WISE star; it is 12 arcseconds from the brightest star in the field and is probably a second peak of that star in the coarser SPHEREx image. Positions measured as brightness-weighted centres in the displayed images.
- **WISE 0855 is where its motion puts it in 2010.** Moved to the WISE middle date with its proper motion and parallax, it is 126.5 arcseconds east and 10.4 arcseconds south of its position in the SPHEREx stack. The WISE image has a clear source there: the brightest pixel within 5.5 arcseconds of the prediction is 1.4 arcseconds from it. At its present position the WISE image shows only the known field star about 4 arcseconds away.
- The WISE image is sharper (about 6 arcsecond resolution on 1.375-arcsecond pixels, against 6.15-arcsecond SPHEREx pixels). Differences in sharpness, and in brightness between W2 and the SPHEREx wavelengths, are not changes in the sky.

## 9. What we must not claim

- A moving dot is not a new planet. Asteroids move through these images all the time. Layer 5 labels moving detections "possible asteroid or artifact" unless they match a known catalogue object.
- A brightness change between two exposures at different wavelengths is not variability (section 1).
- Our layer 3 brightness numbers are quick aperture estimates. IRSA's Spectrophotometry Tool is the precise method; we say so in the interface and use it as our cross-check.
- Quick Release data has earlier calibration than Data Release data. Small offsets between the two are expected.
- A "Yes" in Changed? means the visit averages in our aperture differ by at least 5 times the combined error; it is not a classification of the object as variable.

## 10. Independent astrometric verification (issue #22)

The diagnostic compares original-detector centroids with epoch-propagated Gaia DR3 positions. [Astropy space-motion propagation](https://docs.astropy.org/en/stable/coordinates/apply_space_motion.html) handles the spherical transform. Missing proper motions are excluded, not assumed zero. The query selects RUWE below 1.4, parallax below 10 mas and G magnitude below 18: conservative engineering filters awaiting validation in our infrared fields. No observer-parallax or radial-velocity correction is fitted; this check does not claim milliarcsecond accuracy.

Our engineering gates require eight unambiguous matches, a one-native-pixel matching radius, a 0.35-pixel translation-outlier cutoff, adequate 2D coverage and at most 0.5 native pixel RMS both before correction and in leave-one-out translation residuals. Detection requires a seven-MAD-sigma local maximum and a complete clean 5×5 footprint, rejecting close competing peaks. The science target and neighbours within three pixels are excluded. These are not published SPHEREx accuracy specifications; real matching must validate them before release.

“Verified” means archive-coordinate agreement passed these checks, not that a new WCS was applied. Translation is diagnostic. Catalogue markers alone do not verify an image. Real matching was not completed on 2026-11-15 because catalogue connections timed out; see `PLATE_SOLVING_VALIDATION.md`. Mock numbers remain synthetic. Existing wavelength matching and science products retain their original behavior.

The absolute catalogue-to-detection offset and the distance from the median offset are distinct. Inlier selection uses the latter; the match table labels both explicitly. The API retains `residual_arcsec` as a legacy name for the absolute offset and adds `offset_arcsec` and `fit_residual_arcsec`. A separate `quality_passed` flag prevents synthetic provenance from hiding geometry or RMS rejection. The Gaia query uses the native patch's nominal half-diagonal plus one matching-radius margin (about 706 arcseconds), reducing unrelated sources outside the detector patch; this remains a header-seeded check with conservative limits, not a complete survey catalogue search.
