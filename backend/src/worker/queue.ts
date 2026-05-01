import PQueue from 'p-queue';
import { config } from '../config';
import { logger } from '../logger';

let queue: PQueue | null = null;

export function getProcessingQueue(): PQueue {
  if (!queue) {
    queue = new PQueue({ concurrency: config.processConcurrency });
    logger.info(
      { concurrency: config.processConcurrency },
      'Processing queue initialised',
    );
  }
  return queue;
}
