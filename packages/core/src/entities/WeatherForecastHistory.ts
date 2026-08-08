import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('weather_forecast_history')
@Index(['city', 'forecastDate', 'metric', 'fetchedAt'])
@Index(['fetchedAt'])
export class WeatherForecastHistory {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  city!: string;

  @Column({ type: 'timestamp', name: 'forecast_date' })
  forecastDate!: Date;

  @Column({ type: 'text' })
  metric!: string;

  @Column({ type: 'real', name: 'forecast_mean' })
  forecastMean!: number;

  @Column({ type: 'real', name: 'forecast_std_dev' })
  forecastStdDev!: number;

  @Column({ type: 'text', name: 'model_values_json' })
  modelValuesJson!: string;

  @Column({ type: 'real' })
  latitude!: number;

  @Column({ type: 'real' })
  longitude!: number;

  @Column({ type: 'timestamp', name: 'fetched_at' })
  fetchedAt!: Date;
}
