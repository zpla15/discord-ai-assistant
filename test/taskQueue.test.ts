import { describe, expect, it } from "vitest";
import { TaskQueue } from "../src/core/taskQueue.js";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("TaskQueue", () => {
  it("runs the first task immediately with position 0", () => {
    const queue = new TaskQueue();
    const result = queue.enqueue(async () => {});
    expect(result.position).toBe(0);
  });

  it("queues subsequent tasks with an increasing position while busy", () => {
    const queue = new TaskQueue();
    const first = deferred<void>();
    queue.enqueue(() => first.promise);

    const secondPosition = queue.enqueue(async () => {}).position;
    const thirdPosition = queue.enqueue(async () => {}).position;

    expect(secondPosition).toBe(1);
    expect(thirdPosition).toBe(2);
    expect(queue.pendingCount).toBe(2);

    first.resolve();
  });

  it("never runs two tasks concurrently and preserves FIFO order", async () => {
    const queue = new TaskQueue();
    const order: string[] = [];
    const first = deferred<void>();

    queue.enqueue(async () => {
      order.push("start-A");
      await first.promise;
      order.push("end-A");
    });

    queue.enqueue(async () => {
      order.push("start-B");
      order.push("end-B");
    });

    // B must not have started yet: A is still awaiting `first`.
    expect(order).toEqual(["start-A"]);

    first.resolve();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(order).toEqual(["start-A", "end-A", "start-B", "end-B"]);
    expect(queue.isRunning).toBe(false);
    expect(queue.pendingCount).toBe(0);
  });
});
