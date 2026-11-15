"""The six SPHEREx detector bands (docs/SCIENCE.md, section 1). Wavelengths in micrometres."""

# detector number -> (shortest, longest) wavelength
BANDS: dict[int, tuple[float, float]] = {
    1: (0.746, 1.117),
    2: (1.103, 1.650),
    3: (1.630, 2.435),
    4: (2.403, 3.847),
    5: (3.811, 4.430),
    6: (4.412, 5.010),
}

# Approximate spectral resolving power (wavelength / width of one channel).
RESOLVING_POWER: dict[int, float] = {1: 41.0, 2: 41.0, 3: 41.0, 4: 35.0, 5: 110.0, 6: 130.0}


def band_of(wavelength_um: float) -> int | None:
    for band, (lo, hi) in BANDS.items():
        if lo <= wavelength_um <= hi:
            return band
    return None
