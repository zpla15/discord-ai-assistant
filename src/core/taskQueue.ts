export type QueuedTask = () => Promise<void>;

export interface EnqueueResult {
  /** 0 means the task started immediately; N>=1 means it is waiting behind N tasks. */
  readonly position: number;
}

/**
 * Serializes tasks so only one runs at a time. Purely in-memory: queued tasks
 * are lost on process restart (accepted MVP limitation).
 */
export class TaskQueue {
  private running = false;
  private readonly pending: QueuedTask[] = [];

  enqueue(task: QueuedTask): EnqueueResult {
    if (!this.running) {
      this.running = true;
      void this.runTask(task);
      return { position: 0 };
    }
    this.pending.push(task);
    return { position: this.pending.length };
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private async runTask(task: QueuedTask): Promise<void> {
    try {
      await task();
    } finally {
      const next = this.pending.shift();
      if (next) {
        void this.runTask(next);
      } else {
        this.running = false;
      }
    }
  }
}
