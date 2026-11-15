import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settler } from "./settle";

describe("settler", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("commits only the last value, once values stop arriving", () => {
    const commit = vi.fn();
    const s = settler<number>(200, commit);
    s.schedule(93);
    vi.advanceTimersByTime(150);
    s.schedule(94);
    vi.advanceTimersByTime(199);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledExactlyOnceWith(94);
  });

  // Regression (PR #16 review): a slider step, then Back within 200 ms. Back sets the
  // frame from outside, which cancels the waiting step; it must not overwrite Back's frame.
  it("drops a waiting value when cancelled", () => {
    const commit = vi.fn();
    const s = settler<number>(200, commit);
    s.schedule(94);
    vi.advanceTimersByTime(50);
    s.cancel();
    vi.advanceTimersByTime(500);
    expect(commit).not.toHaveBeenCalled();
  });
});
