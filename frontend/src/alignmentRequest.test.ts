import { describe, expect, it } from "vitest";
import type { AlignmentResult, Frame } from "./api";
import {
  alignmentFrameKey, createAlignmentRequest, emptyAlignmentRequest, type AlignmentRequestState,
} from "./alignmentRequest";

const frameA = { exposure_id: "A", center_ra: 10, center_dec: 20, target_ra: 10, target_dec: 20 } as Frame;
const frameB = { ...frameA, exposure_id: "B" };
const resultA = { exposure_id: "A" } as AlignmentResult;
const resultB = { exposure_id: "B" } as AlignmentResult;

function harness() {
  let state: AlignmentRequestState = emptyAlignmentRequest();
  const pending: Array<{
    signal?: AbortSignal;
    resolve: (result: AlignmentResult) => void;
    reject: (error: Error) => void;
  }> = [];
  const request = createAlignmentRequest((next) => { state = next; }, (_frame, signal) =>
    new Promise<AlignmentResult>((resolve, reject) => { pending.push({ signal, resolve, reject }); }));
  return { request, pending, state: () => state };
}

describe("alignment request cancellation", () => {
  it("allows retry after A → B → A while A's request is pending", async () => {
    const h = harness();
    h.request.select(alignmentFrameKey(frameA));
    const first = h.request.run(frameA);
    expect(h.state().loading).toBe(true);

    h.request.cancel(); // React effect cleanup on leaving A
    h.request.select(alignmentFrameKey(frameB));
    expect(h.pending[0].signal?.aborted).toBe(true);
    h.request.cancel();
    h.request.select(alignmentFrameKey(frameA));
    expect(h.state()).toEqual(emptyAlignmentRequest(alignmentFrameKey(frameA)));

    const retry = h.request.run(frameA);
    h.pending[0].resolve(resultA); // cancelled request finishes after retry starts
    await first;
    expect(h.state().loading).toBe(true);
    expect(h.state().result).toBeNull();
    expect(h.pending[1].signal?.aborted).toBe(false);
    h.pending[1].resolve(resultA);
    await retry;
    expect(h.state().loading).toBe(false);
    expect(h.state().result).toBe(resultA);
  });

  it("ignores a late abort rejection after returning to A", async () => {
    const h = harness();
    h.request.select(alignmentFrameKey(frameA));
    const first = h.request.run(frameA);
    h.request.select(alignmentFrameKey(frameB));
    h.request.select(alignmentFrameKey(frameA));
    h.pending[0].reject(new Error("Aborted"));
    await first;
    expect(h.state()).toEqual(emptyAlignmentRequest(alignmentFrameKey(frameA)));
  });

  it("does not let A overwrite B or publish after unmount", async () => {
    const h = harness();
    h.request.select(alignmentFrameKey(frameA));
    const first = h.request.run(frameA);
    h.request.select(alignmentFrameKey(frameB));
    const second = h.request.run(frameB);
    h.pending[1].resolve(resultB);
    await second;
    h.pending[0].resolve(resultA);
    await first;
    expect(h.state().result).toBe(resultB);

    const third = h.request.run(frameB);
    h.request.cancel(); // unmount
    const before = h.state();
    h.pending[2].resolve(resultB);
    await third;
    expect(h.state()).toBe(before);
  });

  it("clears an error on changing frames and allows a failed check to retry", async () => {
    const h = harness();
    h.request.select(alignmentFrameKey(frameA));
    const first = h.request.run(frameA);
    h.pending[0].reject(new Error("Service unavailable"));
    await first;
    expect(h.state().loading).toBe(false);
    expect(h.state().error).toBe("Service unavailable");
    const retry = h.request.run(frameA);
    expect(h.state().error).toBe("");
    h.pending[1].resolve(resultA);
    await retry;
    h.request.select(alignmentFrameKey(frameB));
    expect(h.state()).toEqual(emptyAlignmentRequest(alignmentFrameKey(frameB)));
  });

  it("treats a changed centre or excluded target as a different frame context", () => {
    const key = alignmentFrameKey(frameA);
    expect(alignmentFrameKey({ ...frameA, center_ra: 11 })).not.toBe(key);
    expect(alignmentFrameKey({ ...frameA, target_dec: 21 })).not.toBe(key);
  });
});
