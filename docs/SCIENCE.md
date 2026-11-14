# Science notes

Nobody on the team is an astronomer. This file holds the facts we have checked, where each came from, and the mistakes they prevent. If you need a fact that is not here, look it up and add it with its source. Do not guess.

"Measured" below means measured by our own data spike on 2026-11-14 from a home connection in Sri Lanka. Server timings will differ.

## 1. What SPHEREx data looks like

- SPHEREx is a NASA space telescope that maps the whole sky in near-infrared light, 0.75 to 5.0 micrometres, about every six months.
- It has six detectors, called bands 1 to 6. Each exposure produces one image per detector: 2040 by 2040 pixels, 6.15 arcseconds per pixel, about 3.5 degrees on a side. One file is about 66 MB.
- The star images are about 7.5 arcseconds wide (full width at half maximum), a little more than one pixel.

| Band | Wavelength range (micrometres) |
| --- | --- |
| 1 | 0.75 to 1.09 |
| 2 | 1.10 to 1.62 |
| 3 | 1.63 to 2.41 |
| 4 | 2.42 to 3.82 |
| 5 | 3.83 to 4.41 |
| 6 | 4.42 to 5.00 |

Source: IRSA SPHEREx tutorial notebooks (see `docs/RESOURCES.md`).

### The wavelength changes across each image

This is the fact that most affects our design. Each detector sits behind a filter whose colour changes smoothly from one edge to the other. A star seen at 4.5 micrometres in one exposure is seen at 4.8 micrometres in the next, because the telescope has shifted and the star has landed on a different part of the detector.

**Consequence:** two exposures of the same position usually show it at different wavelengths. If we blink or subtract them, a red star will look as if it changed brightness when it only changed colour. Layer 1 therefore matches exposures by wavelength at the target before comparing them.

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

This straight-line formula ignores parallax and the curvature of the sky. For our targets and a 6.15 arcsecond pixel the error is well under one pixel. The code is `propagate()` in `backend/app/targets.py`.

- **WISE 0855 is not where the challenge text says.** The coordinates in the challenge (133.795129, -7.245147) are its position around 2010. It moves 8.1 arcseconds a year. In 2026 it is near 133.7601, -7.2422, about two arcminutes away. During the SPHEREx survey so far it moves about 7 arcseconds, roughly one pixel.

## 3. The five test targets

Positions are ICRS at epoch 2000.0 from SIMBAD, queried 2026-11-14. `backend/app/targets.py` holds the same numbers.

| Target | RA (deg) | Dec (deg) | Proper motion RA, Dec (mas/yr) | Parallax (mas) | What it is | What to show |
| --- | --- | --- | --- | --- | --- | --- |
| Barnard's Star | 269.452077 | 4.693365 | -801.6, +10362.4 | 547.0 | Red dwarf; fastest-moving star in the sky | Clear motion, about 10 arcseconds a year |
| Epsilon Indi B | 331.044147 | -56.782844 | +3982.0, -2466.8 | 270.7 | A pair of brown dwarfs orbiting the star Epsilon Indi A | Motion of 4.7 arcseconds a year; bright star A is 7 arcminutes away |
| WISE 0855 | 133.818908 | -7.247048 | -8123.7, +673.2 | 439.0 | The coldest known brown dwarf | Invisible in single exposures; appears only in a motion-tracked stack |
| RW Aurigae | 76.956526 | 30.401438 | +7.2, -20.3 | 15.4 | Young variable star (T Tauri type) | Brightness changes |
| R Draconis | 248.167611 | 66.754979 | -20.6, +6.1 | 1.25 | Pulsating red giant (Mira type) | Large slow brightness changes; best light-curve demo |

Sources: Gaia DR3 through SIMBAD for all except WISE 0855 (Kirkpatrick et al. 2021, bibcode 2021ApJS..253....7K) and the RW Aurigae system entry (van Leeuwen 2007, bibcode 2007A&A...474..653V).

Notes:

- SIMBAD has one entry for Epsilon Indi B, not separate entries for the two brown dwarfs. They are less than one arcsecond apart, far below our pixel size, so we treat them as one source.
- R Draconis is the name SIMBAD knows as `V* R Dra`; RW Aurigae is `V* RW Aur`.

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

- In one exposure near 5 micrometres it is about 2 sigma: not visible.
- Stacking 47 exposures between 4.4 and 5.05 micrometres, each shifted to follow the object's motion, gives a signal-to-noise ratio of about 18.7.
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

## 6. What we must not claim

- A moving dot is not a new planet. Asteroids move through these images all the time. Layer 5 labels moving detections "possible asteroid or artifact" unless they match a known catalogue object.
- A brightness change between two exposures at different wavelengths is not variability (section 1).
- Our layer 3 brightness numbers are quick aperture estimates. IRSA's Spectrophotometry Tool is the precise method; we say so in the interface and use it as our cross-check.
- Quick Release data has earlier calibration than Data Release data. Small offsets between the two are expected.
