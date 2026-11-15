"""Stacking without the network: synthetic noise frames with a faint moving source."""

import math

import numpy as np
import pytest

from app import stacking
from app.stacking import StackInput

N_PX = 25  # odd, so the grid centre (12.5) is the middle of pixel 12
SCALE = 6.15
SIGMA_PX = 0.55  # a star image about 1.3 pixels wide, as in real data


def _gaussian(x: float, y: float, peak: float, n: int = N_PX) -> np.ndarray:
    yy, xx = np.mgrid[0:n, 0:n] + 0.5
    return peak * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * SIGMA_PX**2))


def _inputs(count=48, peak=2.0, total_motion_px=2.0, visits=4, seed=1, star_peak=8.0):
    """`count` exposures in `visits` groups. Each image is centred on a moving source of
    the given peak (in units of the pixel noise, which is 1); a fixed star sits 6 pixels
    north of the reference position, so in the object-centred images it moves."""
    rng = np.random.default_rng(seed)
    per = count // visits
    items = []
    for v in range(visits):
        for k in range(per):
            mjd = 60800.0 + 180.0 * v + 0.5 * k
            fraction = (mjd - 60800.0) / (180.0 * (visits - 1))
            east = (fraction - 0.5) * total_motion_px * SCALE  # the object moves east
            image = rng.normal(0.0, 1.0, (N_PX, N_PX)) + 5.0  # 5: a flat background
            image += _gaussian(12.5, 12.5, peak)
            # The fixed star, seen from a grid centred on the object.
            sx, sy = stacking.static_position(-east, 6 * SCALE, N_PX, SCALE)
            image += _gaussian(sx, sy, star_peak)
            items.append(StackInput(f"e{v}_{k}", mjd, 4.7, image, east, 0.0))
    return items


def test_tracked_stack_beats_one_exposure_by_about_root_n():
    items = _inputs(star_peak=0.0)
    built = stacking.build(items, N_PX, SCALE, has_motion=True)
    n = len(items)
    expected = 2.0 * math.sqrt(n)  # about 13.9
    assert built["tracked"].snr == pytest.approx(expected, rel=0.3)
    assert built["single"].snr < 5.0  # invisible in one exposure
    assert built["tracked"].snr > 2.5 * built["single"].snr
    # The static stack smears the moving source over 2 pixels: weaker than tracked.
    assert built["static"].snr < built["tracked"].snr


def test_empty_position_reads_low():
    items = _inputs(peak=0.0)
    built = stacking.build(items, N_PX, SCALE, has_motion=True)
    assert built["tracked"].snr < 4.0


def test_static_stacking_also_reveals_a_faint_slowly_moving_source():
    # The target note must not imply tracking is required for detection: WISE 0855
    # moves just 1.35 native pixels over the year represented by the exposures.
    built = stacking.build(_inputs(peak=2.0, total_motion_px=1.35, star_peak=0), N_PX, SCALE, True)
    assert built["single"].snr < 5
    assert built["static"].snr > 5
    assert built["tracked"].snr > built["static"].snr


def test_psf_snr_is_unchanged_by_field_size():
    rng = np.random.default_rng(52)
    image = rng.normal(0, 1, (49, 49)) + _gaussian(24.5, 24.5, 15, n=49)
    assert stacking.snr_at(image, 24.5, 24.5) == pytest.approx(
        stacking.snr_at(image[14:35, 14:35], 10.5, 10.5), abs=1e-12
    )


def test_stack_weights_and_snr_are_unchanged_by_field_size():
    rng = np.random.default_rng(142)
    large = []
    small = []
    for k in range(12):
        image = rng.normal(0, 1 + k / 12, (49, 49)) + _gaussian(24.5, 24.5, 4, n=49)
        # Bright objects in the extra area must not change the target's weights.
        image[0:5, 0:5] += 1000
        large.append(StackInput(str(k), 60800 + k * 40, 4.7, image, 0, 0))
        small.append(StackInput(str(k), 60800 + k * 40, 4.7, image[14:35, 14:35], 0, 0))
    a = stacking.build(large, 49, SCALE, False)
    b = stacking.build(small, 21, SCALE, False)
    assert a["sigmas"] == b["sigmas"]
    assert a["tracked"].snr == pytest.approx(b["tracked"].snr, abs=1e-12)


def test_psf_snr_empty_sky_has_zero_mean_and_unit_scatter():
    rng = np.random.default_rng(23)
    snrs = [stacking.snr_at(rng.normal(0, 1, (21, 21)), 10.5, 10.5) for _ in range(200)]
    assert abs(np.mean(snrs)) < 0.2
    assert 0.8 < np.std(snrs) < 1.2


def test_epoch_grouping():
    mjds = [10.0, 11.0, 12.0, 13.0, 14.0, 100.0, 101.0, 200.0, 201.0, 202.0, 203.0, 204.0, 205.0]
    groups = stacking.group_epochs(mjds)
    assert groups == [[0, 1, 2, 3, 4], [7, 8, 9, 10, 11, 12]]  # the pair at 100 is too small
    assert stacking.group_epochs([0.0, 30.0, 60.0], min_size=1) == [[0, 1, 2]]  # 30 days is not a gap
    assert stacking.group_epochs([0.0, 30.5], min_size=1) == [[0], [1]]


def test_epoch_stacks_share_one_grid_and_show_the_step():
    items = _inputs(peak=10.0)  # stay above the conservative local-confusion S/N threshold
    built = stacking.build(items, N_PX, SCALE, has_motion=True)
    epochs = built["epochs"]
    assert len(epochs) == 4 and all(len(e.members) == 12 for e in epochs)
    xs = [e.target_x for e in epochs]
    assert xs == sorted(xs, reverse=True)  # moving east = to the left
    # The fixed star stays in the same pixel in every epoch stack.
    star_x, star_y = stacking.static_position(0.0, 6 * SCALE, N_PX, SCALE)
    for e in epochs:
        box = e.image[int(star_y) - 1 : int(star_y) + 2, int(star_x) - 1 : int(star_x) + 2]
        assert np.nanmax(box) > 4.0
    # Measured positions follow the predicted ones, within their (bootstrap) errors.
    for e in epochs:
        assert e.measured is not None and e.measured.method == "bootstrap"
        assert 0.0 < e.measured.err_east < 2.0 and 0.0 < e.measured.err_north < 2.0
        assert e.measured.east == pytest.approx(e.extra["east"], abs=4 * e.measured.err_east)
        assert e.measured.north == pytest.approx(0.0, abs=4 * e.measured.err_north)


def test_faint_epoch_is_not_measured():
    items = _inputs(peak=0.5)
    built = stacking.build(items, N_PX, SCALE, has_motion=True)
    assert all(e.measured is None for e in built["epochs"])


def test_masked_pixels_are_ignored_and_sparse_pixels_are_empty():
    images = [np.zeros((5, 5)) for _ in range(8)]
    images[0][2, 2] = np.nan  # masked in one exposure ...
    for image in images[1:]:
        image[2, 2] = 1.0  # ... the rest agree
    for image in images[1:]:
        image[0, 0] = np.nan  # masked almost everywhere
    stack, count = stacking.combine(images, [1.0] * 8)
    assert stack[2, 2] == pytest.approx(1.0)
    assert count[2, 2] == 7
    assert np.isnan(stack[0, 0])  # one value is too few


def test_clipping_removes_an_outlier():
    rng = np.random.default_rng(3)
    images = [rng.normal(0.0, 1.0, (9, 9)) for _ in range(20)]
    images[5][4, 4] = 500.0  # a cosmic ray
    stack, count = stacking.combine(images, [1.0] * 20)
    assert abs(stack[4, 4]) < 1.0
    assert count[4, 4] == 19
    unclipped, _ = stacking.combine(images, [1.0] * 20, clip=1e9)
    assert unclipped[4, 4] > 20.0


def test_weights_favour_quiet_exposures():
    quiet = np.full((4, 4), 1.0)
    noisy = np.full((4, 4), 3.0)
    stack, _ = stacking.combine([quiet, noisy], [1.0, 3.0], clip=1e9)
    assert stack[0, 0] == pytest.approx((1.0 + 3.0 / 9.0) / (1.0 + 1.0 / 9.0))


def test_static_grid_shift_direction():
    # A source centred in an object-centred image, with the object 2 pixels east of the
    # reference, lands 2 pixels left of the centre on the fixed grid.
    image = _gaussian(12.5, 12.5, 10.0)
    item = StackInput("x", 0.0, 4.7, image, 2 * SCALE, 0.0)
    moved = stacking.onto_static_grid(item, SCALE)
    row, col = np.unravel_index(np.nanargmax(moved), moved.shape)
    assert (row, col) == (12, 10)
    assert stacking.static_position(2 * SCALE, 0.0, N_PX, SCALE) == (10.5, 12.5)


def test_flagged_star_core_is_empty_in_the_stack_but_filled_in_the_picture():
    items = _inputs(peak=50.0)
    for item in items:
        item.raw = item.image.copy()
        item.image = item.image.copy()
        item.image[11:14, 11:14] = np.nan  # the saturated core is flagged in every exposure
    built = stacking.build(items, N_PX, SCALE, has_motion=True)
    assert np.isnan(built["tracked"].image[12, 12])
    assert built["tracked"].snr is None  # no number from flagged pixels
    assert built["tracked"].display[12, 12] > 20.0
    assert built["static"].display[12, 12] > 10.0


def test_gaussian_fit_finds_a_sub_pixel_position():
    image = _gaussian(11.83, 13.27, 10.0)
    fit = stacking.fit_gaussian(image, None, (11, 13), 0.0, sigma_px=0.7, fit_sigma=True)
    assert fit is not None
    assert fit.x == pytest.approx(11.83, abs=1e-3) and fit.y == pytest.approx(13.27, abs=1e-3)
    assert fit.sigma_px == pytest.approx(SIGMA_PX, abs=1e-3)
    # A flagged core: the position still comes from the wings.
    holed = image.copy()
    holed[12:15, 10:13] = np.nan
    wings = stacking.fit_gaussian(holed, None, (11, 13), 0.0, fit_sigma=True)
    assert wings.x == pytest.approx(11.83, abs=1e-2) and wings.y == pytest.approx(13.27, abs=1e-2)


def test_fixed_neighbour_fit_removes_blended_centroid_bias():
    target = (12.3, 12.6)
    neighbour = (13.4, 12.2)
    image = _gaussian(*target, 10) + _gaussian(*neighbour, 3.8)
    single = stacking.fit_gaussian(image, None, (12, 12), 0, fit_sigma=True)
    double = stacking.fit_gaussian(image, None, (12, 12), 0, fit_sigma=True, neighbour=neighbour)
    assert double is not None and single is not None
    assert abs(single.x - target[0]) > 0.05
    assert double.x == pytest.approx(target[0], abs=0.001)
    assert double.y == pytest.approx(target[1], abs=0.001)


def test_visit_bootstrap_follows_fixed_field_star_while_target_moves():
    rng = np.random.default_rng(91)
    measured = []
    for east in (-2.0, 2.0):
        # The fixed field star moves in the opposite direction in target-centred grids.
        neighbours = [(13.5 + east / SCALE, 12.1)] * 24
        images = [
            _gaussian(12.5, 12.5, 15) + _gaussian(*neighbours[k], 5.7) + rng.normal(0, 0.05, (N_PX, N_PX))
            for k in range(24)
        ]
        point, _snr, _flagged = stacking.measure_visit(
            images,
            [0.05] * 24,
            [east] * 24,
            [0.0] * 24,
            N_PX,
            SCALE,
            draws=30,
            neighbours=neighbours,
        )
        assert point is not None and point.method == "bootstrap" and point.draws >= 20
        measured.append(point)
    assert measured[1].east - measured[0].east == pytest.approx(4.0, abs=0.1)
    assert measured[1].north - measured[0].north == pytest.approx(0.0, abs=0.1)


def test_bootstrap_error_matches_the_real_scatter():
    """Repeat a visit with fresh noise: the spread of the measured positions should be
    about the bootstrap error of one of them (within a factor of two)."""
    positions, errors = [], []
    for seed in range(12):
        rng = np.random.default_rng(100 + seed)
        images = [rng.normal(0.0, 1.0, (N_PX, N_PX)) + _gaussian(12.5, 12.5, 2.5) for _ in range(20)]
        measured, snr, flagged = stacking.measure_visit(
            images, [1.0] * 20, [0.0] * 20, [0.0] * 20, N_PX, SCALE, draws=60, seed=seed
        )
        assert measured is not None and not flagged and snr > 5
        positions.append(measured.east)
        errors.append(measured.err_east)
    spread = float(np.std(positions, ddof=1))
    assert 0.5 * spread < float(np.median(errors)) < 2.0 * spread


def _native_to_patch(rng, centre_east: float, centre_north: float, peak: float) -> np.ndarray:
    """An object-centred patch read from a native detector image the way live mode does
    (bilinear, random rotation and pixel phase). The object is at (centre_east,
    centre_north) arcsec from the patch centre. Native star: 7.5 arcsec FWHM."""
    from app.resample import bilinear

    size = 40
    sigma = 7.5 / 2.3548 / SCALE
    sx, sy = size / 2 + rng.uniform(-0.5, 0.5), size / 2 + rng.uniform(-0.5, 0.5)
    yy, xx = np.mgrid[0:size, 0:size]
    native = peak * np.exp(-((xx - sx) ** 2 + (yy - sy) ** 2) / (2 * sigma**2))
    theta = rng.uniform(0.0, 2.0 * math.pi)
    centres = np.arange(N_PX) + 0.5
    east = (N_PX / 2 - centres)[None, :] * SCALE - centre_east
    north = (N_PX / 2 - centres)[:, None] * SCALE - centre_north
    east, north = np.broadcast_to(east, (N_PX, N_PX)), np.broadcast_to(north, (N_PX, N_PX))
    u = (-east * math.cos(theta) + north * math.sin(theta)) / SCALE
    v = (-east * math.sin(theta) - north * math.cos(theta)) / SCALE
    return bilinear(native, sx + u, sy + v)


def test_measured_step_has_no_resampling_bias():
    """Two visits whose fixed-grid shifts have different sub-pixel phases (0.3 and 0.8
    pixel). With almost no noise, the measured step must equal the true step within the
    bootstrap error. What is left is the first resampling (detector to grid) at a
    different pixel phase in every exposure: about 0.1 arcsec for 20 exposures."""
    rng = np.random.default_rng(7)
    items = []
    for visit, east_px in enumerate((-0.3, 0.8)):
        for k in range(20):
            image = _native_to_patch(rng, 0.0, 0.0, 100.0) + rng.normal(0.0, 0.01, (N_PX, N_PX))
            mjd = 60800.0 + 180 * visit + k
            items.append(StackInput(f"v{visit}_{k}", mjd, 4.7, image, east_px * SCALE, 0.0))
    built = stacking.build(items, N_PX, SCALE, has_motion=True)
    first, second = built["epochs"]
    error_east = math.hypot(first.measured.err_east, second.measured.err_east)
    error_north = math.hypot(first.measured.err_north, second.measured.err_north)
    assert error_east < 0.3 and error_north < 0.3
    step_east = second.measured.east - first.measured.east
    step_north = second.measured.north - first.measured.north
    assert step_east == pytest.approx(1.1 * SCALE, abs=max(0.1, 3 * error_east))
    assert step_north == pytest.approx(0.0, abs=max(0.1, 3 * error_north))


def test_parallax_enters_the_prediction_not_the_image_centre():
    items = _inputs(peak=10.0)
    for item in items:
        item.parallax_east, item.parallax_north = 0.4, -0.2
    built = stacking.build(items, N_PX, SCALE, has_motion=True)
    plain = stacking.build(_inputs(peak=10.0), N_PX, SCALE, has_motion=True)
    for e, p in zip(built["epochs"], plain["epochs"], strict=True):
        assert e.extra["east"] == pytest.approx(p.extra["east"] + 0.4)
        assert e.extra["north"] == pytest.approx(p.extra["north"] - 0.2)
        assert e.measured.east == pytest.approx(p.measured.east)  # same pixels, same measurement


def test_saturated_star_does_not_report_confident_motion_from_its_wings():
    items = _inputs(peak=50.0)
    for item in items:
        item.raw = item.image.copy()
        item.image = item.image.copy()
        item.image[12, 12] = np.nan  # the core pixel is flagged in every exposure
    built = stacking.build(items, N_PX, SCALE, has_motion=True)
    assert built["tracked"].saturated and built["tracked"].snr is None
    for e in built["epochs"]:
        assert e.saturated and e.measured is None


def test_single_is_a_typical_exposure():
    built = stacking.build(_inputs(), N_PX, SCALE, has_motion=True)
    values = built["single"].extra["single_snrs"]
    assert built["single"].snr == values[len(values) // 2]


def test_reversed_motion_control_has_no_sharp_source():
    items = _inputs(peak=3.0, total_motion_px=6.0)
    built = stacking.build(items, N_PX, SCALE, has_motion=True)
    _image, control = stacking.control_reversed(items, N_PX, SCALE)
    assert control < 0.5 * built["tracked"].snr
