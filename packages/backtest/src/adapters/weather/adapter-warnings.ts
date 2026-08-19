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
      'minTimeToClose non appliqué en backtest (closeBeforeHours appliqué à l\'entrée)',
    );
    this.warnOnce(
      ctx,
      'fill_no_book_depth',
      'Pas de profondeur de carnet — fills non plafonnés par la liquidité',
    );
    if (ctx.params.detectionDelayMs > 0) {
      this.warnOnce(
        ctx,
        'detection_delay_unused',
        'detectionDelayMs paramétré mais non appliqué au replay',
      );
    }
    if (ctx.params.mode === 'replay' && ctx.params.fidelityMinutes != null) {
      this.warnOnce(
        ctx,
        'replay_fidelity_filter_unsupported',
        'filtre intervalle ignoré en mode replay (weather_evaluation_log ne porte pas fidelity_minutes)',
      );
    }
  }
}
