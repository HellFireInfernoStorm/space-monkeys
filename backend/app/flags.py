"""Pixel flag bits of the SPHEREx ``FLAGS`` image, and the mask we apply.

Names and meanings were read from the ``FLAGS`` extension header (keywords
``MSKNnnnn`` and ``MSKDnnnn``) of Data Release 1 files on 2026-11-14.
See docs/SCIENCE.md, section 4. For a new data release, read the header again
rather than trusting this table.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class FlagBit:
    bit: int
    name: str
    meaning: str
    informational: bool = False


FLAG_BITS: tuple[FlagBit, ...] = (
    FlagBit(0, "TRANSIENT", "Transient detected during sample-up-the-ramp readout"),
    FlagBit(1, "OVERFLOW", "Overflow detected during readout"),
    FlagBit(2, "SUR_ERROR", "Error in onboard processing"),
    FlagBit(6, "NONFUNC", "Permanently unusable"),
    FlagBit(7, "DICHROIC", "Low efficiency due to dichroic"),
    FlagBit(9, "MISSING_DATA", "Onboard data lost"),
    FlagBit(10, "HOT", "Hot pixel"),
    FlagBit(11, "COLD", "Anomalously low signal"),
    FlagBit(12, "FULLSAMPLE", "Pixel full sample history is available", informational=True),
    FlagBit(14, "PHANMISS", "Phantom correction was not applied"),
    FlagBit(15, "NONLINEAR", "Nonlinearity correction cannot be applied reliably"),
    FlagBit(17, "PERSIST", "Persistent charge above threshold"),
    FlagBit(19, "OUTLIER", "Pixel flagged by outlier detection"),
    FlagBit(20, "CROSSTALK", "Pixel affected by crosstalk"),
    FlagBit(21, "SOURCE", "Pixel mapped to a known source", informational=True),
    FlagBit(22, "GHOST", "Affected by a bright source inside the exposure"),
    FlagBit(23, "GHOST_FPA", "Affected by a bright source on another detector"),
    FlagBit(24, "GHOST_EXT", "Affected by a bright source outside the field of view"),
    FlagBit(25, "STREAK", "Pixel affected by a streak"),
    FlagBit(26, "BLOOM", "Pixel part of a bloom artifact"),
    FlagBit(27, "SNOWBALL", "Pixel part of a snowball artifact"),
    FlagBit(28, "HALO", "Pixel part of a transient halo"),
)

# Every known bit that means "do not trust this pixel".
# Bits 12 and 21 are left out on purpose: bit 21 marks known sources and is set
# on almost half of all pixels, including the stars we want to look at.
DEFAULT_BAD_MASK: int = sum(1 << f.bit for f in FLAG_BITS if not f.informational)


def describe(value: int) -> list[FlagBit]:
    """The flag bits that are set in one pixel value."""
    return [f for f in FLAG_BITS if value & (1 << f.bit)]


def is_bad(value: int, mask: int = DEFAULT_BAD_MASK) -> bool:
    return bool(value & mask)
