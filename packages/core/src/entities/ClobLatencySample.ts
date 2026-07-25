import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** RTT sample from a real CLOB FAK post — used to calibrate sim latency. */
@Entity('clob_latency_samples')
@Index(['createdAt'])
export class ClobLatencySample {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', name: 'signal_id' })
  signalId!: string;

  @Column({ type: 'integer', name: 'rtt_ms' })
  rttMs!: number;

  @Column({ type: 'text' })
  side!: string;

  @Column({
    type: 'timestamp',
    name: 'created_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;
}
