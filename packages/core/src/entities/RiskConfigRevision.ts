import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type RiskConfigRevisionSource = 'api' | 'report_apply' | 'system';

@Entity('risk_config_revisions')
@Index('idx_risk_config_revisions_created', ['createdAt'])
@Index('idx_risk_config_revisions_kind_created', ['configKind', 'createdAt'])
export class RiskConfigRevision {
  @PrimaryGeneratedColumn()
  id!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'text', default: 'api' })
  source!: RiskConfigRevisionSource;

  @Column({ type: 'text', name: 'patch_json', nullable: true })
  patchJson!: string | null;

  @Column({ type: 'text', name: 'config_json' })
  configJson!: string;

  @Column({ type: 'text', name: 'config_fingerprint', nullable: true })
  configFingerprint!: string | null;

  /**
   * Which config table this revision belongs to:
   * 'global' | 'copy' | 'crypto' | 'weather'.
   * Null for revisions created before migration 0087.
   */
  @Column({ type: 'text', name: 'config_kind', nullable: true })
  configKind!: string | null;
}
