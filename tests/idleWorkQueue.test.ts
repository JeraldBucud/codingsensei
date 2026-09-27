import { describe, expect, it, vi } from "vitest";

import { IdleWorkQueue } from "../src/utils/idleWorkQueue";

describe("idle work queue", () => {
  it("deduplicates work and waits for the idle delay", async () => {
    vi.useFakeTimers();
    const processed: string[] = [];
    const queue = new IdleWorkQueue<string>(500, (item) => item, async (item) => {
      processed.push(item);
    });

    queue.enqueue("src/app.ts");
    queue.enqueue("src/app.ts");
    expect(queue.pendingCount).toBe(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(processed).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(processed).toEqual(["src/app.ts"]);
    expect(queue.pendingCount).toBe(0);

    queue.dispose();
    vi.useRealTimers();
  });

  it("defers queued work again when the user becomes active", async () => {
    vi.useFakeTimers();
    const processed: string[] = [];
    const queue = new IdleWorkQueue<string>(500, (item) => item, async (item) => {
      processed.push(item);
    });

    queue.enqueue("src/app.ts");
    await vi.advanceTimersByTimeAsync(400);
    queue.defer();
    await vi.advanceTimersByTimeAsync(100);
    expect(processed).toEqual([]);

    await vi.advanceTimersByTimeAsync(400);
    expect(processed).toEqual(["src/app.ts"]);

    queue.dispose();
    vi.useRealTimers();
  });

  it("processes queued items one at a time", async () => {
    vi.useFakeTimers();
    const processed: string[] = [];
    const queue = new IdleWorkQueue<string>(100, (item) => item, async (item) => {
      processed.push(item);
    });

    queue.enqueue("a");
    queue.enqueue("b");

    await vi.advanceTimersByTimeAsync(100);
    expect(processed).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(processed).toEqual(["a", "b"]);

    queue.dispose();
    vi.useRealTimers();
  });
});
