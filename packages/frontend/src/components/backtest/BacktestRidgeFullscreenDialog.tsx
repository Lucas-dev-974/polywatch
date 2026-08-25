import { Show } from 'solid-js';
import type { Signal } from 'solid-js';
import type {
  BacktestExcludedTickDto,
  BacktestMarketSeriesDto,
  BacktestPositionDto,
} from '../../api';
import { Dialog } from '../Dialog';
import { BacktestMarketsFallback } from './BacktestMarketsFallback';
import { BacktestMarketRidgeChart } from './BacktestMarketRidgeChart';

export interface BacktestRidgeFullscreenDialogProps {
  series: BacktestMarketSeriesDto[];
  positions: BacktestPositionDto[];
  excludedTicks: BacktestExcludedTickDto[];
  from: string;
  to: string;
  minAvgYes: Signal<number>;
  title: string;
  marketsBusy: boolean;
  onClose: () => void;
}

export function BacktestRidgeFullscreenDialog(props: BacktestRidgeFullscreenDialogProps) {
  return (
    <Dialog
      open
      fullscreen
      onClose={props.onClose}
      title={props.title}
      titleId="backtest-ridge-fullscreen-title"
      class="dialog-backtest-ridge-fullscreen"
      bodyClass="dialog-body-backtest-ridge-fullscreen"
    >
      <Show
        when={props.series.length > 0}
        fallback={<BacktestMarketsFallback busy={props.marketsBusy} />}
      >
        <BacktestMarketRidgeChart
          series={props.series}
          positions={props.positions}
          excludedTicks={props.excludedTicks}
          from={props.from}
          to={props.to}
          minAvgYes={props.minAvgYes}
        />
      </Show>
    </Dialog>
  );
}
