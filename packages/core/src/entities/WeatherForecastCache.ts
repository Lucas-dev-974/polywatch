import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('weather_forecast_cache')
@Index(['city', 'forecastDate', 'metric'], { unique: true })
export class WeatherForecastCache {
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

  /** JSON string of per-model values, e.g. {"gfs":31,"ecmwf":30,"icon":32} */
  @Column({ type: 'text', name: 'model_values' })
  modelValues!: string;

  @Column({ type: 'real', name: 'latitude' })
  latitude!: number;

  @Column({ type: 'real', name: 'longitude' })
  longitude!: number;

  @CreateDateColumn({ name: 'fetched_at' })
  fetchedAt!: Date;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt!: Date;
}