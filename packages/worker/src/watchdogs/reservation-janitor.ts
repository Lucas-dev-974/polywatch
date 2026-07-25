import type { DataSource } from 'typeorm';
import { ReservationService } from '@polywatch/core';
import pino from 'pino';
import { safeInterval } from '../helpers.js';

const log = pino({ name: 'reservation-janitor' });

export class ReservationJanitor {
  private reservationService: ReservationService;

  constructor(private readonly ds: DataSource) {
    this.reservationService = new ReservationService(ds);
  }

  async run(): Promise<void> {
    const cleaned = await this.reservationService.janitor();
    if (cleaned > 0) {
      log.info({ cleaned }, 'expired reservations cleaned');
    }
  }

  start(intervalMs = 60_000): NodeJS.Timeout {
    return safeInterval(() => this.run(), intervalMs, 'reservation-janitor');
  }
}
