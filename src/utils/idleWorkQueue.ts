export class IdleWorkQueue<T> {
  private readonly items = new Map<string, T>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private disposed = false;

  constructor(
    private readonly delayMs: number,
    private readonly keyFor: (item: T) => string,
    private readonly action: (item: T) => Promise<void>
  ) {}

  enqueue(item: T): void {
    if (this.disposed) {
      return;
    }
    this.items.set(this.keyFor(item), item);
    this.schedule();
  }

  defer(): void {
    if (this.disposed || this.items.size === 0 || this.running) {
      return;
    }
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    this.items.clear();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  get pendingCount(): number {
    return this.items.size;
  }

  private schedule(): void {
    if (this.running || this.disposed || this.items.size === 0) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runOne();
    }, this.delayMs);
  }

  private async runOne(): Promise<void> {
    if (this.running || this.disposed) {
      return;
    }

    const next = this.items.entries().next().value as [string, T] | undefined;
    if (!next) {
      return;
    }

    const [key, item] = next;
    this.items.delete(key);
    this.running = true;
    try {
      await this.action(item);
    } finally {
      this.running = false;
      this.schedule();
    }
  }
}
