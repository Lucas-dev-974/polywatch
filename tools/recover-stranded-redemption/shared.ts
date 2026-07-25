import { createDecipheriv } from 'node:crypto';
import { ethers } from 'ethers';
import pg from 'pg';
import { POLYGON_CLOB_CONTRACTS_V2 } from '../../packages/core/src/polymarket/clob-contracts.js';
import {
  amountToRaw6Decimals,
  pusdRawToNumber,
} from '../../packages/core/src/polymarket/pusd-amount.js';
import {
  resolveWinningOutcome,
  normalizeTokenId,
  type WinningOutcome,
} from '../../packages/core/src/polymarket/redemption.js';
import { POLYGON_CHAIN_ID, POLYGON_RPC_URL } from '../../packages/core/src/polymarket/polygon-viem.js';
import { deriveProxyWallet, deriveSafe } from '@polymarket/builder-relayer-client/dist/builder/derive.js';
import { getContractConfig } from '@polymarket/builder-relayer-client/dist/config/index.js';
import { resolveDepositAddress } from '../../packages/core/src/polymarket/trading-wallet.js';

export type RedemptionWalletMode = 'deposit' | 'safe' | 'proxy';

function deriveRelayerExecutionWallet(
  signerAddress: string,
  mode: 'proxy' | 'safe',
): string {
  const cfg = getContractConfig(137);
  if (mode === 'safe') {
    return deriveSafe(signerAddress, cfg.SafeContracts.SafeFactory);
  }
  return deriveProxyWallet(signerAddress, cfg.ProxyContracts.ProxyFactory);
}

const CTF_BALANCE_ABI = [
  'function balanceOf(address account, uint256 id) view returns (uint256)',
];

const CTF_POSITION_ABI = [
  'function getCollectionId(bytes32 parentCollectionId, bytes32 conditionId, uint256 indexSet) view returns (bytes32)',
  'function getPositionId(address collateralToken, bytes32 collectionId) view returns (uint256)',
  'function payoutDenominator(bytes32 conditionId) view returns (uint256)',
];

/** Collatéraux possibles pour un marché CLOB Polygon. */
export const COLLATERAL_CANDIDATES: Array<{ label: string; address: string }> = [
  { label: 'pUSD', address: POLYGON_CLOB_CONTRACTS_V2.collateral },
  { label: 'USDC.e', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' },
  { label: 'USDC natif', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },
];

export interface DetectedCollateral {
  label: string;
  address: string;
  /** 1 = YES (slot 0), 2 = NO (slot 1) */
  indexSet: 1 | 2;
}

/**
 * Retrouve le collatéral réel du marché en comparant le positionId CTF
 * calculé pour chaque candidat avec l'asset_id effectivement détenu.
 * Indispensable: un redeem avec le mauvais collatéral paie 0 sans revert.
 */
export async function detectCollateralForAsset(
  conditionId: string,
  assetId: string,
): Promise<DetectedCollateral | null> {
  const provider = createPolygonProvider();
  const ctf = new ethers.Contract(
    POLYGON_CLOB_CONTRACTS_V2.conditionalTokens,
    CTF_POSITION_ABI,
    provider,
  );
  const held = BigInt(assetId);

  for (const cand of COLLATERAL_CANDIDATES) {
    for (const indexSet of [1, 2] as const) {
      const collectionId = (await ctf.getCollectionId(
        ethers.ZeroHash,
        conditionId,
        indexSet,
      )) as string;
      const positionId = (await ctf.getPositionId(cand.address, collectionId)) as bigint;
      if (positionId === held) {
        return { label: cand.label, address: cand.address, indexSet };
      }
    }
  }
  return null;
}

export async function fetchConditionPayoutDenominator(
  conditionId: string,
): Promise<bigint> {
  const provider = createPolygonProvider();
  const ctf = new ethers.Contract(
    POLYGON_CLOB_CONTRACTS_V2.conditionalTokens,
    CTF_POSITION_ABI,
    provider,
  );
  return (await ctf.payoutDenominator(conditionId)) as bigint;
}

export async function fetchErc20BalanceRaw(
  token: string,
  holder: string,
): Promise<bigint> {
  const provider = createPolygonProvider();
  const erc20 = new ethers.Contract(
    token,
    ['function balanceOf(address) view returns (uint256)'],
    provider,
  );
  return (await erc20.balanceOf(holder)) as bigint;
}

const GAMMA_API = process.env.POLYMARKET_GAMMA_API ?? 'https://gamma-api.polymarket.com';

function getEncryptionKey(): Buffer {
  const raw = process.env.MASTER_ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef';
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  const key = Buffer.from(raw, 'utf8');
  if (key.length !== 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be 64 hex chars or exactly 32 bytes');
  }
  return key;
}

export function decryptCiphertext(ciphertext: string): string {
  const [ivHex, tagHex, dataHex] = ciphertext.split(':');
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error('invalid_ciphertext_format');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

async function detectGammaProxyWallet(eoa: string): Promise<string | null> {
  const url = `${GAMMA_API}/public-profile?address=${encodeURIComponent(eoa)}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = (await res.json()) as { proxyWallet?: string };
  const proxy = data.proxyWallet?.toLowerCase();
  if (!proxy || proxy === eoa.toLowerCase()) return null;
  return data.proxyWallet!;
}

export interface StrandedPositionRow {
  id: number;
  condition_id: string;
  asset_id: string;
  outcome: string;
  mode: string;
  status: string;
  quantity: number;
  entry_price: number;
  realized_pnl: number;
  close_reason: string | null;
  slug: string | null;
  question: string | null;
  resolved: boolean;
  winning_token_id: string | null;
  token_id_yes: string | null;
  token_id_no: string | null;
  neg_risk: boolean;
  redeem_tx_hash: string | null;
  redeem_executed_at: string | null;
}

export interface MergedClobCredentials {
  walletAddress: string;
  funderAddress: string | null;
  signerPkEnc: string | null;
  signatureType: number;
  apiKeyEnc: string | null;
  secretEnc: string | null;
  passphraseEnc: string | null;
  builderApiKeyEnc: string | null;
  builderSecretEnc: string | null;
  builderPassphraseEnc: string | null;
  relayerUrl: string | null;
}

export interface TradingWalletContext {
  merged: MergedClobCredentials;
  depositAddress: string | null;
}

export interface WalletCandidate {
  label: string;
  address: string;
  suggestedMode: RedemptionWalletMode | null;
}

export interface CtfBalanceRow {
  label: string;
  address: string;
  balanceRaw: bigint;
  balanceShares: number;
}

export function createRecoveryPool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  return new pg.Pool({ connectionString: url });
}

export function createPolygonProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(
    POLYGON_RPC_URL,
    { name: 'polygon', chainId: POLYGON_CHAIN_ID },
    { staticNetwork: true },
  );
}

export function truncateAddress(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export async function loadStrandedPosition(
  pool: pg.Pool,
  opts: { positionId?: number; conditionId?: string },
): Promise<StrandedPositionRow | null> {
  const params: unknown[] = [];
  let filter = '';

  if (opts.positionId != null) {
    params.push(opts.positionId);
    filter = 'p.id = $1';
  } else if (opts.conditionId) {
    params.push(opts.conditionId.toLowerCase());
    filter = 'LOWER(p.condition_id) = $1';
  } else {
    throw new Error('positionId or conditionId required');
  }

  const { rows } = await pool.query<StrandedPositionRow>(
    `
    SELECT
      p.id, p.condition_id, p.asset_id, p.outcome, p.mode, p.status,
      p.quantity, p.entry_price, p.realized_pnl, p.close_reason,
      m.slug, m.question, m.resolved, m.winning_token_id,
      m.token_id_yes, m.token_id_no, COALESCE(m.neg_risk, false) AS neg_risk,
      red.tx_hash AS redeem_tx_hash,
      red.executed_at AS redeem_executed_at
    FROM copied_positions p
    LEFT JOIN markets m ON m.condition_id = p.condition_id
    LEFT JOIN LATERAL (
      SELECT e.tx_hash, e.executed_at
      FROM executions e
      WHERE e.copied_position_id = p.id
        AND e.reason = 'REDEMPTION'
        AND e.side = 'SELL'
      ORDER BY e.executed_at DESC NULLS LAST
      LIMIT 1
    ) red ON TRUE
    WHERE ${filter}
      AND p.mode = 'real'
    ORDER BY p.id DESC
    LIMIT 1
    `,
    params,
  );

  return rows[0] ?? null;
}

async function resolveDepositForCredentials(
  walletAddress: string | null,
  funderAddress: string | null,
): Promise<string | null> {
  if (!walletAddress) return null;

  const wallet = walletAddress.toLowerCase();
  const funder = funderAddress?.toLowerCase() ?? null;
  if (funder && funder !== wallet) {
    return walletAddress;
  }

  let detectedProxy: string | null = null;
  if (funderAddress) {
    try {
      detectedProxy = await detectGammaProxyWallet(funderAddress);
    } catch {
      detectedProxy = null;
    }
  }
  if (!detectedProxy) {
    try {
      detectedProxy = await detectGammaProxyWallet(walletAddress);
    } catch {
      detectedProxy = null;
    }
  }

  return resolveDepositAddress(walletAddress, funderAddress, detectedProxy);
}

function mergeWithdrawCredentials(
  creds: MergedClobCredentials,
  primary: {
    deposit_address: string;
    funder_address: string | null;
    signer_pk_enc: string | null;
    signature_type: number;
  },
): MergedClobCredentials {
  return {
    ...creds,
    walletAddress: primary.deposit_address,
    funderAddress: primary.funder_address ?? creds.funderAddress,
    signerPkEnc: primary.signer_pk_enc ?? creds.signerPkEnc,
    signatureType: primary.signature_type ?? creds.signatureType,
  };
}

export async function loadTradingContext(
  pool: pg.Pool,
): Promise<{ ctx: TradingWalletContext; signerAddress: string | null }> {
  const credsRes = await pool.query(
    `SELECT wallet_address, funder_address, signer_pk_enc, signature_type,
            api_key_enc, secret_enc, passphrase_enc,
            builder_api_key_enc, builder_secret_enc, builder_passphrase_enc, relayer_url
     FROM clob_credentials
     LIMIT 1`,
  );
  if (credsRes.rows.length === 0) {
    throw new Error('trading_context_unavailable: clob credentials missing');
  }

  const row = credsRes.rows[0] as Record<string, unknown>;
  let merged: MergedClobCredentials = {
    walletAddress: String(row.wallet_address),
    funderAddress: (row.funder_address as string | null) ?? null,
    signerPkEnc: (row.signer_pk_enc as string | null) ?? null,
    signatureType: Number(row.signature_type ?? 3),
    apiKeyEnc: (row.api_key_enc as string | null) ?? null,
    secretEnc: (row.secret_enc as string | null) ?? null,
    passphraseEnc: (row.passphrase_enc as string | null) ?? null,
    builderApiKeyEnc: (row.builder_api_key_enc as string | null) ?? null,
    builderSecretEnc: (row.builder_secret_enc as string | null) ?? null,
    builderPassphraseEnc: (row.builder_passphrase_enc as string | null) ?? null,
    relayerUrl: (row.relayer_url as string | null) ?? null,
  };

  const primaryRes = await pool.query(
    `SELECT deposit_address, funder_address, signer_pk_enc, signature_type
     FROM wallet_accounts
     WHERE is_primary = true
     ORDER BY sort_order ASC, id ASC
     LIMIT 1`,
  );
  if (primaryRes.rows.length > 0) {
    merged = mergeWithdrawCredentials(merged, primaryRes.rows[0] as {
      deposit_address: string;
      funder_address: string | null;
      signer_pk_enc: string | null;
      signature_type: number;
    });
  }

  const depositAddress = await resolveDepositForCredentials(
    merged.walletAddress,
    merged.funderAddress,
  );
  if (!depositAddress) {
    throw new Error('trading_context_unavailable: deposit address missing');
  }

  const signerPk = merged.signerPkEnc ? decryptCiphertext(merged.signerPkEnc) : null;
  const signerAddress = signerPk
    ? new ethers.Wallet(signerPk).address
    : merged.funderAddress ?? merged.walletAddress;

  return { ctx: { merged, depositAddress }, signerAddress };
}

export async function fetchCtfBalance(
  holder: string,
  assetId: string,
): Promise<bigint> {
  const provider = createPolygonProvider();
  const ctf = new ethers.Contract(
    POLYGON_CLOB_CONTRACTS_V2.conditionalTokens,
    CTF_BALANCE_ABI,
    provider,
  );
  return (await ctf.balanceOf(holder, assetId)) as bigint;
}

export async function fetchPusdBalanceRaw(holder: string): Promise<bigint> {
  const provider = createPolygonProvider();
  const pusd = new ethers.Contract(
    POLYGON_CLOB_CONTRACTS_V2.collateral,
    ['function balanceOf(address) view returns (uint256)'],
    provider,
  );
  return (await pusd.balanceOf(holder)) as bigint;
}

function resolveEffectiveWithdrawMode(
  signerAddress: string | null | undefined,
  depositAddress: string,
  signatureType: number,
  isL2Deposit: boolean,
): RedemptionWalletMode | 'eoa' {
  if (!isL2Deposit) {
    if (signatureType === 2) return 'safe';
    if (signatureType === 1) return 'proxy';
    return 'eoa';
  }

  if (!signerAddress?.trim()) {
    if (signatureType === 2) return 'safe';
    if (signatureType === 1) return 'proxy';
    return 'deposit';
  }

  const deposit = depositAddress.toLowerCase();
  const proxy = deriveRelayerExecutionWallet(signerAddress, 'proxy').toLowerCase();
  const safe = deriveRelayerExecutionWallet(signerAddress, 'safe').toLowerCase();

  if (deposit === proxy) return 'proxy';
  if (deposit === safe) return 'safe';
  return 'deposit';
}

export function buildWalletCandidates(
  ctx: TradingWalletContext,
  signerAddress: string | null,
): WalletCandidate[] {
  const merged = ctx.merged;
  const deposit = ctx.depositAddress;
  const wallet = merged.walletAddress;
  const funder = merged.funderAddress;
  const candidates: WalletCandidate[] = [];

  if (deposit) {
    const mode = resolveRedeemModeForDeposit(
      signerAddress,
      deposit,
      merged.signatureType ?? 3,
    );
    candidates.push({
      label: 'deposit (CLOB funder)',
      address: deposit,
      suggestedMode: mode,
    });
  }
  if (wallet && wallet.toLowerCase() !== deposit?.toLowerCase()) {
    candidates.push({
      label: 'walletAddress (credentials)',
      address: wallet,
      suggestedMode: null,
    });
  }
  if (funder && funder.toLowerCase() !== wallet?.toLowerCase()) {
    candidates.push({
      label: 'funderAddress (EOA signer)',
      address: funder,
      suggestedMode: null,
    });
  }
  if (signerAddress) {
    const proxy = deriveRelayerExecutionWallet(signerAddress, 'proxy');
    const safe = deriveRelayerExecutionWallet(signerAddress, 'safe');
    if (!candidates.some((c) => c.address.toLowerCase() === proxy.toLowerCase())) {
      candidates.push({
        label: 'derived proxy',
        address: proxy,
        suggestedMode: 'proxy',
      });
    }
    if (!candidates.some((c) => c.address.toLowerCase() === safe.toLowerCase())) {
      candidates.push({
        label: 'derived safe',
        address: safe,
        suggestedMode: 'safe',
      });
    }
  }

  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = c.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveRedeemModeForDeposit(
  signerAddress: string | null,
  depositAddress: string,
  signatureType: number,
): RedemptionWalletMode {
  const effective = resolveEffectiveWithdrawMode(
    signerAddress,
    depositAddress,
    signatureType,
    true,
  );
  return effective === 'eoa' ? 'deposit' : effective;
}

export async function scanCtfBalances(
  assetId: string,
  candidates: WalletCandidate[],
): Promise<CtfBalanceRow[]> {
  const rows: CtfBalanceRow[] = [];
  for (const c of candidates) {
    const balanceRaw = await fetchCtfBalance(c.address, assetId);
    rows.push({
      label: c.label,
      address: c.address,
      balanceRaw,
      balanceShares: pusdRawToNumber(balanceRaw),
    });
  }
  return rows.sort((a, b) => Number(b.balanceRaw - a.balanceRaw));
}

export function resolveWinningOutcomeForPosition(
  pos: StrandedPositionRow,
): WinningOutcome | null {
  if (!pos.winning_token_id) return null;
  return resolveWinningOutcome(
    pos.winning_token_id,
    pos.token_id_yes,
    pos.token_id_no,
  );
}

export function isWinningAsset(pos: StrandedPositionRow): boolean {
  if (!pos.winning_token_id) return false;
  return normalizeTokenId(pos.winning_token_id) === normalizeTokenId(pos.asset_id);
}

export function quantityRawFromShares(shares: number): string {
  return amountToRaw6Decimals(shares).toString();
}

export async function parseRedemptionPayoutFromReceipt(
  txHash: string,
): Promise<{ payoutRaw: bigint | null; indexSets: bigint[] | null }> {
  const provider = createPolygonProvider();
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) return { payoutRaw: null, indexSets: null };

  const iface = new ethers.Interface([
    'event PayoutRedemption(address indexed redeemer, address indexed collateralToken, bytes32 indexed parentCollectionId, bytes32 conditionId, uint256[] indexSets, uint256 payout)',
    'event Redeemed(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, bytes32 indexed indexedConditionId, address indexed caller, uint256[] indexSets, uint256[] redemptions)',
  ]);

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed) continue;
      if (parsed.name === 'PayoutRedemption') {
        return {
          payoutRaw: parsed.args.payout as bigint,
          indexSets: parsed.args.indexSets as bigint[],
        };
      }
      if (parsed.name === 'Redeemed' && parsed.args.redemptions) {
        const redeemed = parsed.args.redemptions as bigint[];
        const total = redeemed.reduce((s, v) => s + v, 0n);
        return {
          payoutRaw: total,
          indexSets: parsed.args.indexSets as bigint[],
        };
      }
    } catch {
      // not a redemption log
    }
  }
  return { payoutRaw: null, indexSets: null };
}

export function pickRecoveryTarget(
  balances: CtfBalanceRow[],
  candidates: WalletCandidate[],
): { balance: CtfBalanceRow; mode: RedemptionWalletMode } | null {
  const withBalance = balances.filter((b) => b.balanceRaw > 0n);
  if (withBalance.length === 0) return null;

  const best = withBalance[0];
  const candidate = candidates.find(
    (c) => c.address.toLowerCase() === best.address.toLowerCase(),
  );
  if (!candidate?.suggestedMode) return null;
  return { balance: best, mode: candidate.suggestedMode };
}
