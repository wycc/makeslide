import PQueue from 'p-queue';
import { config } from '../config';
import { logger } from '../logger';

export type QueueTask<T = unknown> = () => Promise<T> | T;

export interface ProcessingQueue {
  readonly name: string;
  readonly concurrency: number;
  add<T>(task: QueueTask<T>): Promise<T>;
  getStats(): ProcessingQueueStats;
}

export interface ProcessingQueueStats {
  name: string;
  concurrency: number;
  pending: number;
  size: number;
}

export interface ProcessingQueueAdapter {
  createProcessingQueue(options: { name: string; concurrency: number }): ProcessingQueue;
}

class InMemoryProcessingQueue implements ProcessingQueue {
  private readonly queue: PQueue;

  constructor(
    readonly name: string,
    readonly concurrency: number,
  ) {
    this.queue = new PQueue({ concurrency });
  }

  async add<T>(task: QueueTask<T>): Promise<T> {
    return await this.queue.add(async () => await task());
  }

  getStats(): ProcessingQueueStats {
    return {
      name: this.name,
      concurrency: this.concurrency,
      pending: this.queue.pending,
      size: this.queue.size,
    };
  }
}

class InMemoryProcessingQueueAdapter implements ProcessingQueueAdapter {
  createProcessingQueue(options: { name: string; concurrency: number }): ProcessingQueue {
    return new InMemoryProcessingQueue(options.name, options.concurrency);
  }
}

let adapter: ProcessingQueueAdapter = new InMemoryProcessingQueueAdapter();
let queue: ProcessingQueue | null = null;

export function setProcessingQueueAdapter(nextAdapter: ProcessingQueueAdapter): void {
  adapter = nextAdapter;
  queue = null;
}

export function resetProcessingQueueForTests(): void {
  adapter = new InMemoryProcessingQueueAdapter();
  queue = null;
}

export function getProcessingQueue(): ProcessingQueue {
  if (!queue) {
    queue = adapter.createProcessingQueue({
      name: 'pdf-processing',
      concurrency: config.processConcurrency,
    });
    logger.info(
      { concurrency: queue.concurrency, queue: queue.name },
      'Processing queue initialised',
    );
  }
  return queue;
}
