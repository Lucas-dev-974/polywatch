import type { AutoTrackRule } from '../hooks/useWeatherAlgoDashboard';
import { CollapsibleSection } from './CollapsibleSection';
import { WeatherWatchedTable } from './weather/WeatherWatchedTable';

export interface WeatherAlgoActiveMarketsPanelProps {
  rules: AutoTrackRule[];
  onToggle: (id: number, enabled: boolean) => void;
  onRemove: (id: number) => void;
}

export function WeatherAlgoActiveMarketsPanel(props: WeatherAlgoActiveMarketsPanelProps) {
  return (
    <CollapsibleSection
      title={`Villes surveillées (${props.rules.length})`}
      persistKey="polywatch_weather_watched_collapsed"
    >
      <WeatherWatchedTable
        rules={props.rules}
        onToggle={props.onToggle}
        onRemove={props.onRemove}
        renderHorizon={(rule) => `J+${rule.lookAheadDays}`}
        emptyText={
          <>
            Ajoutez des villes depuis la <strong>Découverte</strong> ou l'onglet{' '}
            <strong>Villes</strong> pour commencer à suivre les conditions météo.
          </>
        }
      />
    </CollapsibleSection>
  );
}
