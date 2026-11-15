# Resources and credits

Everything in this project that we did not make ourselves: data, services, code, libraries, text and images. The challenge requires all of it to be listed on the project page. Add a line in the same pull request that introduces the resource.

If you do not know a licence, write "unknown" and open a `question` issue. Do not guess.

## NASA data

| Resource | How we use it | Link | Credit and terms |
| --- | --- | --- | --- |
| SPHEREx Spectral Image data (Data Release 1 and Quick Release 3, including the deep fields), from the NASA/IPAC Infrared Science Archive (IRSA) | The images the tool displays | https://irsa.ipac.caltech.edu/Missions/spherex.html ; DOI 10.26131/IRSA678 | Acknowledgement text below |
| SPHEREx Spectral All-Sky Cube (HiPS) | Optional all-sky layer in the sky map | https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube ; DOI 10.26131/IRSA679 | Acknowledgement text below |
| IRSA Simple Image Access service | Finding exposures that cover a position | https://irsa.ipac.caltech.edu/SIA | IRSA |
| SPHEREx data on the AWS Open Data mirror (bucket `nasa-irsa-spherex`) | Reading image patches | https://irsa.ipac.caltech.edu/Missions/spherex.html | Same data, same acknowledgement |
| IRSA Spectrophotometry Tool | Cross-check for our quick-look brightness values; model for our column names; linked from the spectrum panel | https://irsa.ipac.caltech.edu/applications/spherex/tool-spectrophotometry (from https://irsa.ipac.caltech.edu/Missions/spherex.html) | IRSA |
| AllWISE Atlas images (W1 and W2), from IRSA's public mirror on AWS (bucket `nasa-irsa-wise`, prefix `wise/allwise/images/p3am_cdd`) | Layer 4: the 2010 image of the same field, beside the SPHEREx image (`/api/wise`) | https://nasa-irsa-wise.s3.us-west-2.amazonaws.com/wise/allwise/images/p3am_cdd/ ; documentation https://wise2.ipac.caltech.edu/docs/release/allwise/ | WISE/NEOWISE acknowledgement below, as given in the bucket's AllWISE README (`wise/allwise/catalogs/p3as_psd/healpix_k5/README.md`, read 2026-11-15). Licence not stated there; NASA data from IRSA |
| WISE and NEOWISE images, through WiseView | Layer 4 links out to WiseView at the same coordinates | http://byw.tools/wiseview | WiseView credits below |

Required SPHEREx acknowledgement (put this on the project page and in the site footer):

> This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration.

Required WISE/NEOWISE acknowledgement (layer 4; on the project page and in the site footer):

> This publication makes use of data products from the Wide-field Infrared Survey Explorer, which is a joint project of the University of California, Los Angeles, and the Jet Propulsion Laboratory/California Institute of Technology, and NEOWISE, which is a project of the Jet Propulsion Laboratory/California Institute of Technology. WISE and NEOWISE are funded by the National Aeronautics and Space Administration.

## Space agency partner and other data

The approximate fixed field-neighbour position used for WISE 0855 (RA 133.7582, Dec -7.2412) was supplied in the team's [live-check issue #4](https://github.com/HellFireInfernoStorm/space-monkeys/issues/4). Its underlying catalogue identifier, position uncertainty and licence are **unknown**; [question #6](https://github.com/HellFireInfernoStorm/space-monkeys/issues/6) requests them. The fit attributes the supplied position to that issue and does not treat the bootstrap error as a complete error budget.

| Resource | How we use it | Link | Credit and terms |
| --- | --- | --- | --- |
| Gaia Data Release 3 (European Space Agency) | Positions and proper motions of the test targets (through SIMBAD); planned catalogue overlay | https://www.cosmos.esa.int/web/gaia/dr3 | Gaia acknowledgement to be added when the overlay is built |
| SIMBAD astronomical database (CDS, Strasbourg) | Catalogue values for the five test targets, queried 2026-11-14 | https://simbad.cds.unistra.fr/simbad/ | "This research has made use of the SIMBAD database, operated at CDS, Strasbourg, France." |
| NASA/IPAC Extragalactic Database (NED), name lookup for "M42" | Position of the Orion Nebula, where the sky map opens before a position is chosen (`DEFAULT_SKY_CENTRE` in `frontend/src/skyMaps.ts`), read 2026-11-15 | https://ned.ipac.caltech.edu/ | Acknowledgement: "This research has made use of the NASA/IPAC Extragalactic Database (NED), which is funded by the National Aeronautics and Space Administration and operated by the California Institute of Technology." |
| Kirkpatrick et al. 2021, ApJS 253, 7 | Position, proper motion and parallax of WISE 0855 (through SIMBAD) | bibcode 2021ApJS..253....7K | Citation |
| Luhman and Esplin 2016, AJ 152, 78 ("The Spectral Energy Distribution of the Coldest Known Brown Dwarf") | Independent check of the WISE 0855 parallax used in the predicted motion: their abstract gives 449 ± 8 mas (read on arXiv 1605.06655, 2026-11-14). The code keeps 439.0 mas from Kirkpatrick et al. 2021; the 10 mas difference changes the predicted parallax shift between visits by about 0.02 arcsec. SIMBAD did not answer on 2026-11-14, so 439.0 was not re-read there | DOI 10.3847/0004-6256/152/3/78 | Citation |
| Astronomical Almanac low-precision formula for the Sun's position | Earth's position for the parallax shift (`earth_position_au` in `backend/app/targets.py`), checked against Astropy's barycentric Earth position to within 0.015 AU in a test | Astronomical Almanac, section C ("Low precision formulas for the Sun") | Published formula; citation |
| van Leeuwen 2007, A&A 474, 653 | Position and proper motion of the RW Aurigae system (through SIMBAD) | bibcode 2007A&A...474..653V | Citation |
| NEOSSat data (Canadian Space Agency) | **Not used.** Listed by the challenge as a partner resource; left out of the core plan | https://www.asc-csa.gc.ca/eng/satellites/neossat/ | Open Government Licence - Canada, if we ever use it |

## Services loaded by the site at run time

| Resource | How we use it | Link | Licence |
| --- | --- | --- | --- |
| Aladin Lite (CDS, Strasbourg; authors Thomas Boch and Matthieu Baumann), npm package `aladin-lite`, pinned to exactly 3.9.2-beta | Sky map panel. Installed from npm and loaded only when the panel first appears. Started with its usage logging off (`log: false`), because that log would send the page address to CDS | https://github.com/cds-astro/aladin-lite | LGPL-3.0-or-later, as stated in the package's own `package.json` and `LICENSE` file |
| AllWISE colour HiPS (red W4, green W2, blue W1), made by CDS (Boch T.), served from the IRSA mirror | Default background of the sky map (`sky=wise`) | https://irsa.ipac.caltech.edu/data/hips/CDS/AllWISE/RGB-W4-W2-W1 ; DOI 10.26093/cds/aladin/35rf-zj ; reference 2010AJ....140.1868W | ODbL-1.0, according to the CDS MocServer record for `CDS/P/allWISE/color`. Copyright IPAC/NASA (data) and CNRS/Unistra (HiPS) |
| SPHEREx DR1 all-sky data cube HiPS, served by IRSA (the same data set as the "SPHEREx Spectral All-Sky Cube" row in the NASA data table above) | Sky map background `sky=spherex`. The user can step through its 102 wavelength frames with a slider (`skyf`); the wavelengths come from its `properties` file | https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube | Copyright NASA/SPHEREx (`obs_copyright`) and Caltech/IPAC (`hips_copyright`), per its `properties` file. The licence is not stated there and has not been confirmed |
| DSS2 colour HiPS (Digitized Sky Survey), made by CDS, served from the IRSA mirror | Sky map background `sky=dss` | https://irsa.ipac.caltech.edu/data/hips/CDS/DSS2/color | Copyright Digitized Sky Survey - STScI/NASA, colored & HEALPixed by CDS (data) and CNRS/Unistra (HiPS), per its `properties` file. Licence not stated in its properties file. STScI's terms for using DSS images: https://archive.stsci.edu/dss/acknowledging.html |
| IRIS colour HiPS (reprocessed IRAS), made by CDS, served from the IRSA mirror | Sky map background `sky=iris` | https://irsa.ipac.caltech.edu/data/hips/CDS/IRIS/color | Copyright Healpixed by CDS (IRIS) (data) and CNRS/Unistra (HiPS), per its `properties` file. Licence not stated in its properties file |
| 2MASS colour HiPS, made by CDS, served from the IRSA mirror | Sky map background `sky=2mass` | https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/Color | Copyright University of Massachusetts & IPAC/Caltech (data) and CNRS/Unistra (HiPS), per its `properties` file. Licence not stated in its properties file |
| SDSS DR9 colour HiPS, made by CDS, served from the IRSA mirror | Sky map background `sky=sdss` | https://irsa.ipac.caltech.edu/data/hips/CDS/SDSS/DR9/color | Copyright SLOAN Digitized Sky Survey - Healpixed by CDS (data) and CNRS/Unistra (HiPS), per its `properties` file. Licence not stated in its properties file |
| GALEX GR6 AIS colour HiPS, made by CDS, served from the IRSA mirror | Sky map background `sky=galex` | https://irsa.ipac.caltech.edu/data/hips/CDS/GALEX/GR6-03-2014/AIS-Color | Copyright STScI/NASA (public domain per STScI contract NAS5-26555) (data) and CNRS/Unistra (HiPS), per its `properties` file. Licence not stated in its properties file |
| Spitzer IRAC 3.6 µm HiPS, made by CDS, served from the IRSA mirror | Sky map background `sky=irac` | https://irsa.ipac.caltech.edu/data/hips/CDS/SPITZER/IRAC1 | Copyright Spitzer mission - JPL/NASA (data) and CNRS/Unistra (HiPS), per its `properties` file. Licence not stated in its properties file |
| Planck R2 HFI colour HiPS, made by CDS, served from the IRSA mirror | Sky map background `sky=planck` | https://irsa.ipac.caltech.edu/data/hips/CDS/PLANCK/R2/HFI/color | Copyright Planck Legacy Archive (data) and CNRS/Unistra (HiPS), per its `properties` file. Licence not stated in its properties file |
| AllWISE W1 HiPS, made by CDS, served from the IRSA mirror | Sky map background `sky=w1` | https://irsa.ipac.caltech.edu/data/hips/CDS/AllWISE/W1 | Copyright IPAC/NASA (data) and CNRS/Unistra (HiPS), per its `properties` file. Licence not stated in its properties file |
| AllWISE W2 HiPS, made by CDS, served from the IRSA mirror | Sky map background `sky=w2` | https://irsa.ipac.caltech.edu/data/hips/CDS/AllWISE/W2 | Copyright IPAC/NASA (data) and CNRS/Unistra (HiPS), per its `properties` file. Licence not stated in its properties file |

## Code and documentation we learned from

| Resource | What we took | Link | Licence |
| --- | --- | --- | --- |
| IRSA tutorial notebooks for SPHEREx | The method for reading the wavelength at a pixel, the cloud access pattern, and facts about the file layout. Any code adapted from them must be marked in a comment where it is used (`wavelength_at` in `backend/app/resample.py`, and the comparison in `backend/tests/test_live_frames.py`) | https://caltech-ipac.github.io/irsa-tutorials/ | BSD 3-Clause, Copyright (c) 2022-2026 California Institute of Technology |
| 2MASS Point Source Catalog, queried through IRSA's TAP service | One-off check on 2026-11-14 that live frames are north up and east left (three stars near Barnard's Star landed within one pixel of their catalogue offsets). Not used by the site | https://irsa.ipac.caltech.edu/Missions/2mass.html | 2MASS acknowledgement, if we ever show it |
| WiseView (Backyard Worlds: Planet 9 community tool) | Inspiration for the blink interface and for keeping view state in the URL. No code copied | http://byw.tools/wiseview | Credit as inspiration |
| NEOSSat data tutorial (Canadian Space Agency) | Read only. Nothing taken | Challenge resources page | Modified MIT, Canadian Space Agency 2023 |
| NASA Space Apps challenge text | Objectives and test targets, restated in `docs/ACCEPTANCE.md` | Challenge page | NASA Space Apps |

## Libraries

Licences are as published by each project, written from memory on 2026-11-14 and **not yet re-checked against the installed versions**. Exact versions are in `backend/pyproject.toml` and `frontend/package-lock.json`.

Back end:

| Library | Use | Licence |
| --- | --- | --- |
| FastAPI | Web framework | MIT |
| Uvicorn | Web server | BSD 3-Clause |
| Pydantic and pydantic-settings | Data models and configuration | MIT |
| NumPy | Arrays | BSD 3-Clause |
| Pillow | Writing PNG images | MIT-CMU (HPND) |
| Astropy (`live` extra) | FITS files, coordinates | BSD 3-Clause |
| PyVO (`live` extra) | Archive search | BSD 3-Clause |
| fsspec (`live` extra) | Byte-range reads over HTTP (`astropy.io.fits.open(..., use_fsspec=True)`) | BSD-3-Clause, read from the installed package metadata (fsspec 2026.9.0) on 2026-11-14 |
| aiohttp (`live` extra) | The HTTP client fsspec uses for those reads | Apache-2.0 AND MIT, read from the installed package metadata (aiohttp 3.14.5) on 2026-11-14 |
| pytest, HTTPX, Ruff (`dev` extra) | Tests and lint | MIT; BSD 3-Clause; MIT |

Front end:

| Library | Use | Licence |
| --- | --- | --- |
| React and React DOM | User interface | MIT |
| Vite and @vitejs/plugin-react | Build tool | MIT |
| TypeScript | Type checking. Pinned to version 5.9, not 7, because `openapi-typescript` 7 needs the TypeScript 5 JavaScript API | Apache 2.0 |
| Vitest | Tests | MIT |
| openapi-typescript | Generates types from the API contract | MIT |

## Images, fonts, icons, text

Plate-solving verification (#22): Gaia DR3 `gaiadr3.gaia_source` reference-star positions and proper motions, queried from the ESA Gaia Archive TAP service. Source: https://www.cosmos.esa.int/web/gaia/dr3 and https://www.cosmos.esa.int/web/gaia-users/credits . Licence and exact DR3 acknowledgement **unconfirmed**, tracked in [#27](https://github.com/HellFireInfernoStorm/space-monkeys/issues/27). No catalogue dump is committed. Existing Astropy (BSD-3-Clause) is used for distortion-aware WCS and epoch propagation; reference: https://docs.astropy.org/en/stable/coordinates/apply_space_motion.html . No new dependency.

The site uses system fonts and no icon set. Layout controls use plain Unicode characters.

The issue #10 screenshots in `docs/screenshots/issue-10/` show our own interface and mock frames, plus the existing Aladin Lite/AllWISE sky map (credits and terms above). The live Barnard and WISE validation screenshots also show SPHEREx DR1/QR3 data (credits above). These are validation screenshots, not new image assets used by the site.
