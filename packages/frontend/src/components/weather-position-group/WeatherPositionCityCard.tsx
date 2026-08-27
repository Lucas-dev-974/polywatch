import { For } from 'solid-js';
import { useAlgoCarouselScroll } from '../../hooks/useAlgoCarouselScroll';
import { AlgoCarousel } from '../algo/AlgoCarousel';
import { AlgoCarouselNav } from '../algo/AlgoCarouselNav';
import { WeatherPositionDateDropdown } from './WeatherPositionDateDropdown';
import type {
  ClosePositionHandler,
  OpenChartHandler,
  WeatherPositionCityGroup,
} from './types';

interface WeatherPositionCityCardProps {
  group: WeatherPositionCityGroup;
  onOpenChart: OpenChartHandler;
  onClose?: ClosePositionHandler;
}

export function WeatherPositionCityCard(props: WeatherPositionCityCardProps) {
  const carousel = useAlgoCarouselScroll(308);
  const totalPositions = () =>
    props.group.dates.reduce((sum, d) => sum + d.positions.length, 0);
  return (
    <div class="weather-history-city-card">
      <div class="weather-history-city-card__header">
        <span class="weather-history-city-card__city">{props.group.city}</span>
        <span class="weather-history-city-card__count">
          {totalPositions()} position{totalPositions() > 1 ? 's' : ''} ·{' '}
          {props.group.dates.length} date{props.group.dates.length > 1 ? 's' : ''}
        </span>
        <AlgoCarouselNav
          visible={props.group.dates.length > 0}
          onScrollLeft={carousel.scrollLeft}
          onScrollRight={carousel.scrollRight}
        />
      </div>
      <AlgoCarousel class="weather-history-city-card__dates" setScrollRef={carousel.setScrollRef}>
        <For each={props.group.dates}>
          {(date) => (
            <div class="weather-history-date-tile">
              <WeatherPositionDateDropdown
                group={date}
                defaultOpen={true}
                onOpenChart={props.onOpenChart}
                onClose={props.onClose}
              />
            </div>
          )}
        </For>
      </AlgoCarousel>
    </div>
  );
}
