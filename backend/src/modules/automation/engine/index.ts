// Phase 7 Engine — bootstrap. Imported by app.ts on startup.
//
// Wires:
//   1. Event-bus listener → campaign materializer (event → tasks)
//   2. Default action handler registrations (stubs for now; Phase G real impls)
//   3. Task worker startup (polls queued tasks)
//
// Safe to import multiple times — guards via isStarted flag.

import { logger } from '../../../shared/utils/logger.js';
import { automationEventBus } from './event-bus.js';
import { materializeFromEvent } from './campaign-materializer.js';
import { startTaskWorker, stopTaskWorker } from './task-worker.js';
import { registerActionHandler } from './action-dispatcher.js';
import {
  requestFriendHandler,
  sendMessageHandler,
  updateStatusHandler,
} from './action-handlers/index.js';

let isStarted = false;

export function startAutomationEngine(): void {
  if (isStarted) {
    logger.warn('[automation.engine] already started');
    return;
  }
  isStarted = true;

  // 1. Wire event bus → materializer
  automationEventBus.on(async (event) => {
    try {
      await materializeFromEvent(event);
    } catch (err) {
      logger.error('[automation.engine] materializer error:', err);
    }
  });

  // 2. Register action handlers (Phase G stubs / real impls)
  registerActionHandler('update_status', updateStatusHandler);
  registerActionHandler('request_friend', requestFriendHandler);
  registerActionHandler('send_message', sendMessageHandler);

  // 3. Start polling worker
  startTaskWorker();

  // 4. Start cron event scheduler (birthday + scheduled_cron triggers)
  void (async () => {
    try {
      const { startCronEventScheduler } = await import('./cron-event-scheduler.js');
      await startCronEventScheduler();
    } catch (err) {
      logger.error('[automation.engine] cron scheduler boot failed:', err);
    }
  })();

  logger.info('[automation.engine] started — event bus + 3 action handlers + worker + cron');
}

/**
 * Graceful stop: dừng poll loop của worker + cron scheduler.
 * In-flight tick (nếu có) tự hoàn tất; caller có thể chờ isTaskWorkerBusy()===false.
 */
export async function stopAutomationEngine(): Promise<void> {
  if (!isStarted) return;
  stopTaskWorker();
  try {
    const { stopCronEventScheduler } = await import('./cron-event-scheduler.js');
    stopCronEventScheduler();
  } catch (err) {
    logger.error('[automation.engine] cron scheduler stop failed:', err);
  }
  isStarted = false;
  logger.info('[automation.engine] stopped');
}

export { isTaskWorkerBusy } from './task-worker.js';

export { automationEventBus } from './event-bus.js';
export { materializeFromEvent } from './campaign-materializer.js';
export { tick as runWorkerTick } from './task-worker.js';
