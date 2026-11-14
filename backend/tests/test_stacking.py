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
    items = _inputs()
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


def test_epoch_grouping():
    mjds = [10.0, 11.0, 12.0, 13.0, 14.0, 100.0, 101.0, 200.0, 201.0, 202.0, 203.0, 204.0, 205.0]
    groups = stacking.group_epochs(mjds)
    assert groups == [[0, 1, 2, 3, 4], [7, 8, 9, 10, 11, 12]]  # the pair at 100 is too small
    assert stacking.group_epochs([0.0, 30.0, 60.0], min_size=1) == [[0, 1, 2]]  # 30 days is not a gap
    assert stacking.group_epochs([0.0, 30.5], min_size=1) == [[0], [1]]


def test_epoch_stacks_share_one_grid_and_show_the_step():
    items = _inputs(peak=6.0)
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
    # Measured positions follow the predicted ones.
    for e in epochs:
        assert e.measured is not None
        assert e.measured[0] == pytest.approx(e.extra["east"], abs=2.5)
        assert e.measured[1] == pytest.approx(0.0, abs=2.5)


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


def test_single_is_a_typical_exposure():
    built = stacking.build(_inputs(), N_PX, SCALE, has_motion=True)
    values = built["single"].extra["single_snrs"]
    assert built["single"].snr == values[len(values) // 2]


def test_reversed_motion_control_has_no_sharp_source():
    items = _inputs(peak=3.0, total_motion_px=6.0)
    built = stacking.build(items, N_PX, SCALE, has_motion=True)
    _image, control = stacking.control_reversed(items, N_PX, SCALE)
    assert control < 0.5 * built["tracked"].snr
