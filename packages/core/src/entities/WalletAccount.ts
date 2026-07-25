import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('wallet_accounts')
export class WalletAccount {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  label!: string;

  @Column({ type: 'text', name: 'deposit_address' })
  depositAddress!: string;

  @Column({ type: 'text', name: 'funder_address', nullable: true })
  funderAddress!: string | null;

  @Column({ type: 'text', name: 'signer_pk_enc', nullable: true })
  signerPkEnc!: string | null;

  @Column({ type: 'integer', name: 'signature_type', default: 3 })
  signatureType!: number;

  @Column({ type: 'boolean', name: 'is_primary', default: false })
  isPrimary!: boolean;

  @Column({ type: 'integer', name: 'sort_order', default: 0 })
  sortOrder!: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
