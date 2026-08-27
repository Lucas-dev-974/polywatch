import type { RunContext } from '../../engine/runner.js';
import type { WeatherFidelityStats } from './data-loader.js';

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

  warnSizingModeIgnored(ctx: RunContext, strategyId: string, sizingMode: string): void {
    this.warnOnce(
      ctx,
      'risk_sizing_mode_ignored',
      `SizingMode '${sizingMode}' non honoré pour la stratégie '${strategyId}' — taille en USDC fixe (fidélité réduite)`,
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
      'Sizing fixe (entryUsdc ou fixedShareCount selon le mode) — pas de modulation par signal-score',
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
  }

  /**
   * Émet les warnings quantitatifs de fidélité (§12.2) calculés par le
   * data-loader. Chaque code n'est émis qu'une fois (warnOnce) avec les
   * valeurs agrégées du run.
   */
  emitFidelityStats(ctx: RunContext, stats: WeatherFidelityStats): void {
    if (stats.inactiveBucketsExcluded > 0) {
      this.warnOnce(
        ctx,
        'inactiveBucketsExcluded',
        `${stats.inactiveBucketsExcluded} bucket(s) inactif(s) exclus (total_bucket_count - bucket_count) — Σ yesPrice incomplet`,
      );
    }
    if (stats.yesPriceNulls > 0) {
      this.warnOnce(
        ctx,
        'yesPriceNulls',
        `${stats.yesPriceNulls} bucket_tick(s) avec yes_price null (pas d'approximation)`,
      );
    }
    if (stats.noPriceNulls > 0) {
      this.warnOnce(
        ctx,
        'noPriceNulls',
        `${stats.noPriceNulls} bucket_tick(s) avec no_price null (pas d'approximation 1 - yes)`,
      );
    }
    if (stats.forecastRevisionsPerDay > 0) {
      this.warnOnce(
        ctx,
        'forecastRevisionsPerDay',
        `${stats.forecastRevisions} révision(s) forecast sur la plage (${stats.forecastRevisionsPerDay.toFixed(1)}/jour)`,
      );
    }
    if (stats.snapshotsPerDay > 0) {
      this.warnOnce(
        ctx,
        'snapshotsPerDay',
        `${stats.snapshots} snapshot(s) marché sur la plage (${stats.snapshotsPerDay.toFixed(1)}/jour)`,
      );
    }
    if (stats.missingSnapshots > 0) {
      this.warnOnce(
        ctx,
        'missingSnapshots',
        `${stats.missingSnapshots} ville/date avec forecast mais sans snapshot (gaps temporels)`,
      );
    }
    if (stats.incompleteCityDates > 0) {
      this.warnOnce(
        ctx,
        'arbitrage_unreliable',
        `${stats.incompleteCityDates} snapshot(s) avec buckets inactifs exclus — résultats weather-arbitrage non fiables (Σ yesPrice incomplet)`,
      );
    }
  }
}
