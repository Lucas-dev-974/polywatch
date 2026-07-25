import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('weather_position_forecasts')
@Index(['copiedPositionId'])
export class WeatherPositionForecast {
  @PrimaryGeneratedColumn()
  id!: number;

  /** FK to copied_positions.id — the position this forecast snapshot belongs to. */
  @Column({ type: 'integer', name: 'copied_position_id' })
  copiedPositionId!: number;

  @Column({ type: 'text' })
  city!: string;

  @Column({ type: 'timestamp', name: 'target_date' })
  targetDate!: Date;

  @Column({ type: 'text' })
  metric!: string;

  /** Forecast mean (°C) at the time the position was opened. */
  @Column({ type: 'real', name: 'entry_forecast_mean' })
  entryForecastMean!: number;

  /** Forecast std dev (°C) at the time the position was opened. */
  @Column({ type: 'real', name: 'entry_forecast_std_dev' })
  entryForecastStdDev!: number;

  /** JSON of per-model values at entry time. */
  @Column({ type: 'text', name: 'entry_model_values' })
  entryModelValues!: string;
}