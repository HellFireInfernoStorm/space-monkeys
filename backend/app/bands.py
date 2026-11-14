"""The six SPHEREx detector bands (docs/SCIENCE.md, section 1). Wavelengths in micrometres."""

# detector number -> (shortest, longest) wavelength
BANDS: dict[int, tuple[float, float]] = {
    1: (0.75, 1.09),
    2: (1.10, 1.62),
    3: (1.63, 2.41),
    4: (2.42, 3.82),
    5: (3.83, 4.41),
    6: (4.42, 5.00),
}

# Approximate spectral resolving power (wavelength / width of one channel).
RESOLVING_POWER: dict[int, float] = {1: 41.0, 2: 41.0, 3: 41.0, 4: 35.0, 5: 110.0, 6: 130.0}


def band_of(wavelength_um: float) -> int | None:
    for band, (lo, hi) in BANDS.items():
        if lo <= wavelength_um <= hi:
            return band
    return None
