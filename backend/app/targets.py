"""The five test targets from the challenge, and how to move a position in time.

Catalogue values are ICRS at epoch 2000.0 from SIMBAD, queried 2026-11-14
(docs/SCIENCE.md, section 3; credits in docs/RESOURCES.md).
"""

import math
import re
from dataclasses import dataclass

MJD_J2000 = 51544.5
DAYS_PER_YEAR = 365.25
MAS_PER_DEG = 3_600_000.0


@dataclass(frozen=True)
class Target:
    id: str
    name: str
    aliases: tuple[str, ...]
    ra: float  # degrees, ICRS, at `epoch`
    dec: float  # degrees, ICRS, at `epoch`
    pmra: float  # mas/yr, includes cos(dec)
    pmdec: float  # mas/yr
    parallax: float  # mas
    epoch: float  # decimal year of the position
    kind: str
    note: str
    reference: str


TARGETS: tuple[Target, ...] = (
    Target(
        id="barnard",
        name="Barnard's Star",
        aliases=("Barnards Star", "NAME Barnard's star", "GJ 699", "V2500 Oph"),
        ra=269.4520769586187,
        dec=4.693364966576667,
        pmra=-801.551,
        pmdec=10362.394,
        parallax=546.9759,
        epoch=2000.0,
        kind="Red dwarf; the fastest-moving star in the sky",
        note="Moves about 10 arcseconds a year.",
        reference="Gaia DR3, through SIMBAD",
    ),
    Target(
        id="eps-ind-b",
        name="Epsilon Indi B",
        aliases=("eps Ind B", "* eps Ind B", "Epsilon Indi Ba", "Epsilon Indi Bb"),
        ra=331.04414658852124,
        dec=-56.782844195116105,
        pmra=3981.977,
        pmdec=-2466.832,
        parallax=270.658,
        epoch=2000.0,
        kind="A pair of brown dwarfs orbiting the star Epsilon Indi A",
        note="Moves 4.7 arcseconds a year. The two brown dwarfs are under one arcsecond apart "
        "and appear as one source.",
        reference="Gaia DR3, through SIMBAD",
    ),
    Target(
        id="wise-0855",
        name="WISE 0855",
        aliases=(
            "WISE 0855-0714",
            "WISE J085510.83-071442.5",
            "WISEA J085510.74-071442.5",
            "W0855",
        ),
        ra=133.81890825,
        dec=-7.247048,
        pmra=-8123.7,
        pmdec=673.2,
        parallax=439.0,
        epoch=2000.0,
        kind="The coldest known brown dwarf",
        note="Moves 8.1 arcseconds a year, so it is about two arcminutes from the 2010 position "
        "given in the challenge text. Too faint for a single exposure; needs a "
        "motion-tracked stack at 4.4 to 5.0 micrometres.",
        reference="Kirkpatrick et al. 2021 (2021ApJS..253....7K), through SIMBAD",
    ),
    Target(
        id="rw-aur",
        name="RW Aurigae",
        aliases=("RW Aur", "V* RW Aur"),
        ra=76.95652603458333,
        dec=30.401438173888888,
        pmra=7.23,
        pmdec=-20.33,
        parallax=15.42,
        epoch=2000.0,
        kind="Young variable star (T Tauri type)",
        note="Brightness changes irregularly.",
        reference="van Leeuwen 2007 (2007A&A...474..653V), through SIMBAD",
    ),
    Target(
        id="r-dra",
        name="R Draconis",
        aliases=("R Dra", "V* R Dra"),
        ra=248.16761083295,
        dec=66.75497941722,
        pmra=-20.643,
        pmdec=6.149,
        parallax=1.2509,
        epoch=2000.0,
        kind="Pulsating red giant (Mira type)",
        note="Large, slow brightness changes. Lies in a deep field with thousands of exposures.",
        reference="Gaia DR3, through SIMBAD",
    ),
)


def mjd_to_year(mjd: float) -> float:
    return 2000.0 + (mjd - MJD_J2000) / DAYS_PER_YEAR


def year_to_mjd(year: float) -> float:
    return MJD_J2000 + (year - 2000.0) * DAYS_PER_YEAR


def propagate(
    ra: float, dec: float, pmra: float, pmdec: float, epoch: float, year: float
) -> tuple[float, float]:
    """Move a position from `epoch` to `year` (both decimal years) along its proper motion.

    Straight-line motion: ignores parallax and the curvature of the sky. For our
    targets and a 6.15 arcsecond pixel the error is well under one pixel.
    """
    years = year - epoch
    cos_dec = max(math.cos(math.radians(dec)), 1e-6)
    new_ra = (ra + pmra * years / MAS_PER_DEG / cos_dec) % 360.0
    new_dec = dec + pmdec * years / MAS_PER_DEG
    return new_ra, max(-90.0, min(90.0, new_dec))


def position_at_mjd(
    ra: float, dec: float, pmra: float, pmdec: float, epoch: float, mjd: float
) -> tuple[float, float]:
    if pmra == 0.0 and pmdec == 0.0:
        return ra, dec
    return propagate(ra, dec, pmra, pmdec, epoch, mjd_to_year(mjd))


def _normalise(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def find_target(name: str) -> Target | None:
    """Look a name up among the built-in targets. Ignores case, spaces and punctuation."""
    wanted = _normalise(name)
    if not wanted:
        return None
    for target in TARGETS:
        names = (target.id, target.name, *target.aliases)
        if wanted in {_normalise(n) for n in names}:
            return target
    return None
