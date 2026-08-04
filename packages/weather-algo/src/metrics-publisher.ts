import pino from 'pino';

const log = pino({ name: 'weather-algo:metrics-publisher' });

const ALERT_COOLDOWN_MS = 15 * 60 * 1000;
const RATE_WINDOW_SIZE = 10;
const RATE_ALERT_THRESHOLD = 0.5;
const MIN_SAMPLES_FOR_ALERT = 10;

export interface MetricsPublisherDeps {
  postBackendJson: (path: string, body: unknown) => Promise<Response>;
  postBackendAlert: (path: string, body: unknown) => void;
}

export class WeatherAlgoMetricsPublisher {
  private parsed = 0;
  private unparsed = 0;
  private lastAlertAt = 0;
  private readonly window: boolean[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(private readonly deps: MetricsPublisherDeps) {}

  recordParse(parsed: boolean): void {
    if (this.stopped) return;
    if (parsed) {
      this.parsed++;
    } else {
      this.unparsed++;
    }
    this.window.push(parsed);
    if (this.window.length > RATE_WINDOW_SIZE) {
      this.window.shift();
    }
  }

  start(flushIntervalMs: number = 30_000): void {
    if (this.intervalId) return;
    this.stopped = false;
    this.intervalId = setInterval(() => this.flush(), flushIntervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async flush(): Promise<void> {
    const p = this.parsed;
    const u = this.unparsed;
    if (p === 0 && u === 0) return;

    this.parsed = 0;
    this.unparsed = 0;

    try {
      await this.deps.postBackendJson('/api/internal/metrics/weather-question-parse', {
        parsed: p,
        unparsed: u,
      });
    } catch (err) {
      log.warn({ err }, 'failed to push weather question parse metrics');
    }

    this.evaluateAlert();
  }

  private evaluateAlert(): void {
    const windowSize = this.window.length;
    if (windowSize < MIN_SAMPLES_FOR_ALERT) return;

    const unparsedCount = this.window.filter((v) => !v).length;
    const rate = unparsedCount / windowSize;

    if (rate >= RATE_ALERT_THRESHOLD) {
      const now = Date.now();
      if (now - this.lastAlertAt >= ALERT_COOLDOWN_MS) {
        this.lastAlertAt = now;
        this.deps.postBackendAlert('/api/internal/alerts', {
          type: 'warning',
          message: `Weather question parse success rate dropped below ${Math.round((1 - RATE_ALERT_THRESHOLD) * 100)}% (${unparsedCount}/${windowSize} unparsed)`,
        });
      }
    }
  }
}
