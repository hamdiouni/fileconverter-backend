/**
 * BullMQ-compatible queue producer for the conversion orchestrator.
 *
 * BullMQ stores jobs in Redis using the key pattern:
 *   bull:{queueName}:wait   — LPUSH here for standard FIFO
 *   bull:{queueName}:events — stream for event broadcasting
 *
 * Python workers consume using BRPOP on bull:{queueName}:wait.
 * The payload format is a JSON-serialised BullMQ job envelope so
 * the queue names remain consistent on both sides.
 */

import IORedis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

export type FormatFamily = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'cad' | 'font';

export interface QueueJobPayload {
  jobId: string;
  userId: string;
  sourceFileId: string;
  sourceFormat: string;
  targetFormat: string;
  options: Record<string, unknown>;
  /** MinIO bucket for downloading the source file */
  sourceBucket: string;
  /** MinIO bucket where the converted result should be uploaded */
  resultBucket: string;
  /** Orchestrator internal callback URL the worker calls on completion/failure */
  callbackUrl: string;
  enqueuedAt: string;
}

/** Queue name prefix — must match the worker BLPOP key prefix */
const QUEUE_PREFIX = 'bull:fc:queue';

/** Map format families to their dedicated queue names */
const FAMILY_TO_QUEUE: Record<FormatFamily, string> = {
  image:    `${QUEUE_PREFIX}:image`,
  video:    `${QUEUE_PREFIX}:video`,
  audio:    `${QUEUE_PREFIX}:audio`,
  document: `${QUEUE_PREFIX}:document`,
  archive:  `${QUEUE_PREFIX}:archive`,
  cad:      `${QUEUE_PREFIX}:cad`,
  font:     `${QUEUE_PREFIX}:cad`,   // cad-font-worker handles both
};

export class QueueProducer {
  constructor(private redis: IORedis) {}

  /**
   * Enqueue a conversion job to the appropriate worker queue.
   * Returns the BullMQ job envelope ID (not the DB job ID).
   */
  async enqueue(family: FormatFamily, payload: QueueJobPayload): Promise<string> {
    const queueName = FAMILY_TO_QUEUE[family] ?? FAMILY_TO_QUEUE.document;
    const envelopeId = uuidv4();

    // BullMQ minimal envelope — workers parse the `data` field
    const envelope = JSON.stringify({
      id: envelopeId,
      name: 'convert',
      data: payload,
      opts: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      timestamp: Date.now(),
      delay: 0,
      priority: 0,
      returnvalue: null,
      stacktrace: [],
      attemptsMade: 0,
    });

    // LPUSH so BRPOP on the other end picks up in FIFO order
    await this.redis.lpush(`${queueName}:wait`, envelope);

    return envelopeId;
  }

  /**
   * Return the pending depth of a queue (useful for monitoring).
   */
  async depth(family: FormatFamily): Promise<number> {
    const queueName = FAMILY_TO_QUEUE[family] ?? FAMILY_TO_QUEUE.document;
    return this.redis.llen(`${queueName}:wait`);
  }
}
