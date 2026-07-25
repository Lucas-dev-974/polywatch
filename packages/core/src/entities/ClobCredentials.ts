import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('clob_credentials')
export class ClobCredentials {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', name: 'wallet_address' })
  walletAddress!: string;

  @Column({ type: 'text', name: 'api_key_enc', nullable: true })
  apiKeyEnc!: string | null;

  @Column({ type: 'text', name: 'secret_enc', nullable: true })
  secretEnc!: string | null;

  @Column({ type: 'text', name: 'passphrase_enc', nullable: true })
  passphraseEnc!: string | null;

  @Column({ type: 'text', name: 'signer_pk_enc', nullable: true })
  signerPkEnc!: string | null;

  @Column({ type: 'integer', name: 'signature_type', default: 0 })
  signatureType!: number;

  @Column({ type: 'text', name: 'funder_address', nullable: true })
  funderAddress!: string | null;

  @Column({ type: 'text', name: 'builder_api_key_enc', nullable: true })
  builderApiKeyEnc!: string | null;

  @Column({ type: 'text', name: 'builder_secret_enc', nullable: true })
  builderSecretEnc!: string | null;

  @Column({ type: 'text', name: 'builder_passphrase_enc', nullable: true })
  builderPassphraseEnc!: string | null;

  @Column({ type: 'text', name: 'relayer_url', nullable: true })
  relayerUrl!: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
