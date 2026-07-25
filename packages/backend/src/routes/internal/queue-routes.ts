import { Router } from 'express';
import { isKnownWorkerQueue, replayDeadLetterQueue } from '@polywatch/core';
import { getRedis } from '../../redis.js';

export function createInternalQueueRouter(): Router {
  const router = Router();

  router.post('/queues/:name/replay-dead', async (req, res) => {
    const queueName = req.params.name;
    const limit = Math.min(Math.max(Number(req.body?.limit ?? 10), 1), 100);
    if (!isKnownWorkerQueue(queueName)) {
      res.status(400).json({ error: 'unknown_queue' });
      return;
    }
    const replayed = await replayDeadLetterQueue(getRedis(), queueName, limit);
    res.json({ replayed, limit, queue: queueName });
  });

  return router;
}
