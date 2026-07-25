import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('integration_settings')
export class IntegrationSettings {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', name: 'polygonscan_api_key_enc', nullable: true })
  polygonscanApiKeyEnc!: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
