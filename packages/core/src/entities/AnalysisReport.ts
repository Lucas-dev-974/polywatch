import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type AnalysisReportType = 'crypto_algo_optimize';

@Entity('analysis_reports')
@Index('idx_analysis_reports_created', ['createdAt'])
@Index('idx_analysis_reports_type_created', ['type', 'createdAt'])
export class AnalysisReport {
  @PrimaryGeneratedColumn()
  id!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'text' })
  label!: string;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'text' })
  type!: AnalysisReportType;

  @Column({ type: 'text', name: 'params_json' })
  paramsJson!: string;

  @Column({ type: 'text', name: 'payload_json' })
  payloadJson!: string;

  @Column({ type: 'text', name: 'config_fingerprint' })
  configFingerprint!: string;

  @Column({ type: 'text', name: 'scope_summary' })
  scopeSummary!: string;

  @Column({ type: 'integer', name: 'positions_closed_count', default: 0 })
  positionsClosedCount!: number;

  @Column({ type: 'integer', name: 'positions_total_count', default: 0 })
  positionsTotalCount!: number;
}
