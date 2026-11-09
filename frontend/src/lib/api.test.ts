import { afterEach, describe, expect, it, vi } from "vitest";
import { captureException } from "./sentry";
import { api, ApiTimeoutError, fetchJSON, isAbortError, statusLabel } from "./api";
vi.mock("./sentry", () => ({ captureException: vi.fn(), addBreadcrumb: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
describe("API request deadlines", () => {
  it("rejects a never-resolving fetch and aborts its signal", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => {
        signal = init.signal;
        return new Promise(() => {});
      }),
    );
    const request = fetchJSON("/stalled", { timeoutMs: 100 });
    const rejection = expect(request).rejects.toBeInstanceOf(ApiTimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(signal).toHaveProperty("aborted", true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps the deadline active while decoding the body", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) }),
    );
    const request = fetchJSON("/body", { timeoutMs: 100 });
    const rejection = expect(request).rejects.toBeInstanceOf(ApiTimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
  });
  it("distinguishes caller cancellation from timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    const controller = new AbortController();
    const request = fetchJSON("/cancel", { signal: controller.signal });
    controller.abort();
    try {
      await request;
      throw new Error("expected cancellation");
    } catch (error) {
      expect(isAbortError(error)).toBe(true);
    }
  });
  it("returns JSON and cleans up the deadline after success", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ready: true }) }),
    );
    await expect(fetchJSON("/ok")).resolves.toEqual({ ready: true });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not start fetch when already cancelled", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(fetchJSON("/cancel", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves HTTP failures and removes the caller listener and deadline", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, "addEventListener");
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const json = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 503, statusText: "Service Unavailable", json }),
    );
    await expect(fetchJSON("/unavailable", { signal: controller.signal })).rejects.toThrow(
      "API 503: Service Unavailable",
    );
    expect(json).not.toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith("abort", addListener.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("propagates the original network failure and cleans up", async () => {
    vi.useFakeTimers();
    const failure = new TypeError("Network unavailable");
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, "addEventListener");
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));
    await expect(fetchJSON("/network", { signal: controller.signal })).rejects.toBe(failure);
    expect(removeListener).toHaveBeenCalledWith("abort", addListener.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
    expect(captureException).toHaveBeenCalledWith(failure, { path: "/network" });
  });
  it("cleans up cancellation without reporting it as an application error", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, "addEventListener");
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    const request = fetchJSON("/cancel-cleanup", { signal: controller.signal });
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejection;
    expect(removeListener).toHaveBeenCalledWith("abort", addListener.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
    expect(captureException).not.toHaveBeenCalled();
  });
  it("reports timeout errors and removes the caller listener", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, "addEventListener");
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    const request = fetchJSON("/timeout-report", { signal: controller.signal, timeoutMs: 50 });
    const rejection = expect(request).rejects.toBeInstanceOf(ApiTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    expect(captureException).toHaveBeenCalledWith(expect.any(ApiTimeoutError), {
      path: "/timeout-report",
    });
    expect(removeListener).toHaveBeenCalledWith("abort", addListener.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Status ordinal normalization (#315)", () => {
  it("maps every vault ordinal (0..4) including Paused and Reclaimed to display labels", () => {
    expect(statusLabel(0, "vault")).toBe("Active");
    expect(statusLabel(1, "vault")).toBe("Released");
    expect(statusLabel(2, "vault")).toBe("Cancelled");
    expect(statusLabel(3, "vault")).toBe("Paused");
    expect(statusLabel(4, "vault")).toBe("Reclaimed");
  });

  it("maps every stream ordinal (0..3) including Paused to display labels", () => {
    expect(statusLabel(0, "stream")).toBe("Active");
    expect(statusLabel(1, "stream")).toBe("Paused");
    expect(statusLabel(2, "stream")).toBe("Completed");
    expect(statusLabel(3, "stream")).toBe("Cancelled");
  });

  it("maps every DCA ordinal (0..2) to display labels", () => {
    expect(statusLabel(0, "dca")).toBe("Active");
    expect(statusLabel(1, "dca")).toBe("Exhausted");
    expect(statusLabel(2, "dca")).toBe("Cancelled");
  });

  it("normalizes numeric ordinals at the API boundary for getSchedules, getStreams, and getDCA", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 1, status: 0, label: "V0" },
          { id: 2, status: 1, label: "V1" },
          { id: 3, status: 2, label: "V2" },
          { id: 4, status: 3, label: "V3" },
          { id: 5, status: 4, label: "V4" },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 1, status: 0, label: "S0" },
          { id: 2, status: 1, label: "S1" },
          { id: 3, status: 2, label: "S2" },
          { id: 4, status: 3, label: "S3" },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 1, status: 0, label: "D0" },
          { id: 2, status: 1, label: "D1" },
          { id: 3, status: 2, label: "D2" },
        ],
      });
    vi.stubGlobal("fetch", fetchMock);

    const schedules = await api.getSchedules("GADDR");
    expect(schedules.map((s) => s.status)).toEqual([
      "Active",
      "Released",
      "Cancelled",
      "Paused",
      "Reclaimed",
    ]);

    const streams = await api.getStreams("GADDR");
    expect(streams.map((s) => s.status)).toEqual([
      "Active",
      "Paused",
      "Completed",
      "Cancelled",
    ]);

    const dcas = await api.getDCA("GADDR");
    expect(dcas.map((d) => d.status)).toEqual(["Active", "Exhausted", "Cancelled"]);
  });
});