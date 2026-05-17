import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getProcessingQueue,
  resetProcessingQueueForTests,
  setProcessingQueueAdapter,
  type ProcessingQueue,
  type ProcessingQueueAdapter,
  type ProcessingQueueStats,
  type QueueTask,
} from '../src/worker/queue';

class RecordingQueue implements ProcessingQueue {
  readonly name: string;
  readonly concurrency: number;
  readonly tasks: Array<QueueTask<unknown>> = [];

  constructor(options: { name: string; concurrency: number }) {
    this.name = options.name;
    this.concurrency = options.concurrency;
  }

  async add<T>(task: QueueTask<T>): Promise<T> {
    this.tasks.push(task as QueueTask<unknown>);
    return task();
  }

  getStats(): ProcessingQueueStats {
    return {
      name: this.name,
      concurrency: this.concurrency,
      pending: 0,
      size: this.tasks.length,
    };
  }
}

class RecordingAdapter implements ProcessingQueueAdapter {
  created: RecordingQueue[] = [];

  createProcessingQueue(options: { name: string; concurrency: number }): ProcessingQueue {
    const queue = new RecordingQueue(options);
    this.created.push(queue);
    return queue;
  }
}

test.afterEach(() => {
  resetProcessingQueueForTests();
});

test('getProcessingQueue creates a named processing queue through the configured adapter', async () => {
  const adapter = new RecordingAdapter();
  setProcessingQueueAdapter(adapter);

  const queue = getProcessingQueue();
  const result = await queue.add(() => 'done');

  assert.equal(result, 'done');
  assert.equal(adapter.created.length, 1);
  assert.equal(adapter.created[0]?.name, 'pdf-processing');
  assert.equal(adapter.created[0]?.concurrency > 0, true);
  assert.deepEqual(queue.getStats(), {
    name: 'pdf-processing',
    concurrency: adapter.created[0]?.concurrency,
    pending: 0,
    size: 1,
  });
});

test('getProcessingQueue reuses the same queue instance until the adapter changes', () => {
  const firstAdapter = new RecordingAdapter();
  setProcessingQueueAdapter(firstAdapter);

  const firstQueue = getProcessingQueue();
  const secondQueue = getProcessingQueue();

  assert.equal(firstQueue, secondQueue);
  assert.equal(firstAdapter.created.length, 1);

  const secondAdapter = new RecordingAdapter();
  setProcessingQueueAdapter(secondAdapter);

  const thirdQueue = getProcessingQueue();
  assert.notEqual(thirdQueue, firstQueue);
  assert.equal(secondAdapter.created.length, 1);
});
