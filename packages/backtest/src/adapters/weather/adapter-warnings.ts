import type { RunContext } from '../../engine/runner.js';

/**
 * Gestion centralisée des warnings de fidélité émis par l'adapter weather.
 * Encapsule l'état (déduplication, compteur de lifecycle skips, émission
 * unique des warnings statiques) pour alléger la classe adapter.
 */
export class AdapterWarnings {
  private warningFired = new Set<string>();
  private staticWarningsEmitted = false;
  private lifecycleSkipped = 0;

  warnOnce(ctx: RunContext, code: string, message: string): void {
    if (!this.warningFired.has(code)) {
      this.warningFired.add(code);
      ctx.fidelityWarnings.push(`${code}: ${message}`);
    }
  }

  setOrUpdateWarning(ctx: RunContext, code: string, message: string): void {
    const full = `${code}: ${message}`;
    const idx = ctx.fidelityWarnings.findIndex((w) => w.startsWith(`${code}:`));
    if (idx >= 0) {
      ctx.fidelityWarnings[idx] = full;
    } else {
      ctx.fidelityWarnings.push(full);
    }
    this.warningFired.add(code);
  }

  noteLifecycleSkip(ctx: RunContext): void {
    this.lifecycleSkipped += 1;
    this.setOrUpdateWarning(
      ctx,
      'market_lifecycle_filtered',
      `${this.lifecycleSkipped} tick(s) exclus (closed/acceptingOrders/token/minHours)`,
    );
  }

  emitStaticFidelityWarnings(ctx: RunContext): void {
    if (this.staticWarningsEmitted) return;
    this.staticWarningsEmitted = true;
    this.warnOnce(
      ctx,
      'risk_sl_confirmation_ignored',
      'SL sans confirmation ticks (déclenchement au 1er tick)',
    );
    this.warnOnce(
      ctx,
      'risk_sizing_simplified_fixed_usdc',
      'Sizing fixe entryUsdc (pas de signal-score sizing live)',
    );
    this.warnOnce(
      ctx,
      'risk_min_time_to_close_ignored',
      'minTimeToClose non appliqué en backtest (positions tenues jusqu\'à la résolution ou sortie SL/TP)',
    );
    this.warnOnce(
      ctx,
      'fill_no_book_depth',
      'Pas de profondeur de carnet — fills non plafonnés par la liquidité',
    );
    if (ctx.params.backtestExecutionMode === 'strategy') {
      this.warnOnce(
        ctx,
        'strategy_mode_no_group_selection',
        'strategy mode évalue les buckets isolément (pas de pickBestEdgeBucket) — préférer runner-sim pour fidélité live',
      );
    }
  }
}
