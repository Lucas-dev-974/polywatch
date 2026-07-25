import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('system_config')
export class SystemConfig {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  key!: string;

  @Column({ type: 'text' })
  value!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  category!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'timestamptz', name: 'updated_at', default: () => 'NOW()' })
  updatedAt!: Date;
}
