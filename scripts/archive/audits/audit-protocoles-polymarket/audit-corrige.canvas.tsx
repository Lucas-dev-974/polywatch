import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  Grid,
  H1,
  H2,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
  useHostTheme,
} from "cursor/canvas";

type ProtoStatus = "ok" | "partial" | "fixed";

const protocols: Array<{
  area: string;
  status: ProtoStatus;
  detail: string;
  files: string;
}> = [
  {
    area: "Auth CLOB L1/L2 (EIP-712 + HMAC)",
    status: "ok",
    detail: "Inchangé — @polymarket/clob-client-v2, creds chiffrés AES-256-GCM.",
    files: "worker/src/clob/client-factory.ts",
  },
  {
    area: "Signature d'ordres V2 (POLY_1271)",
    status: "ok",
    detail: "Inchangé — signatureType 3, deposit wallet, funder address.",
    files: "client-factory.ts",
  },
  {
    area: "Placement d'ordres FAK + parsing fill",
    status: "fixed",
    detail:
      "parse-fill-response.ts : mapping making/taking corrigé, unités 1e6, garde-fous prix/qty. recordPlacingClobOrderId() dès POST.",
    files: "parse-fill-response.ts · real-executor.ts",
  },
  {
    area: "WebSocket market channel",
    status: "ok",
    detail: "Inchangé — book snapshots + price_change, reconnect, fallback REST.",
    files: "worker/src/polymarket/websocket-book.ts",
  },
  {
    area: "WebSocket user channel (fills async)",
    status: "fixed",
    detail:
      "Canal /ws/user auth L2 : trade MATCHED/CONFIRMED + order UPDATE finalisent les exécutions placing en temps réel. Triple filet : sync POST + WS + startup-reconciler.",
    files: "websocket-user.ts · user-channel-handler.ts · sync-user-subscriptions.ts",
  },
  {
    area: "Data API",
    status: "ok",
    detail: "Inchangé — pagination 500/page, rate-limit 250ms.",
    files: "worker/src/polymarket/api-client.ts",
  },
  {
    area: "Gamma / CLOB métadonnées + frais",
    status: "fixed",
    detail:
      "Fallback CLOB lit taker_base_fee. RealExecutor appelle getFeeRateBps (cache 5 min) si DB absente.",
    files: "market-metadata.ts · real-executor.ts",
  },
  {
    area: "Tick size & montants",
    status: "ok",
    detail: "Inchangé — conforme UserMarketOrderV2.",
    files: "real-executor.ts",
  },
  {
    area: "Approvals deposit wallet",
    status: "fixed",
    detail:
      "Ajout pUSD→Exchange V2 et pUSD→NegRisk Exchange V2 en plus de pUSD→CTF et CTF→exchanges.",
    files: "backend/src/polymarket/clob-approvals.ts",
  },
  {
    area: "Redemption on-chain",
    status: "fixed",
    detail:
      "indexSets [1]/[2] (CTF), amounts [qty,0]/[0,qty] (NegRisk), winningOutcome YES/NO, quantityRaw 6 déc.",
    files: "clob-redeem.ts · redemption-handler.ts",
  },
  {
    area: "Adresses contrats Polygon",
    status: "ok",
    detail: "Inchangé — V2 exchange + negRisk conformes.",
    files: "core/src/polymarket/clob-contracts.ts",
  },
];

const fixes: Array<{
  id: string;
  title: string;
  file: string;
  patch: string;
}> = [
  {
    id: "C1",
    title: "Parsing fills CLOB",
    file: "packages/worker/src/clob/parse-fill-response.ts",
    patch:
      "BUY : fillQty=takingAmount, prix=making/taking. SELL inversé. parseRawAmount /1e6. Garde-fous fail-closed.",
  },
  {
    id: "C2",
    title: "Redemption on-chain",
    file: "packages/backend/src/polymarket/clob-redeem.ts",
    patch:
      "ABI uint256[], indexSets [1]/[2], NegRisk amounts, resolveWinningOutcome() dans core.",
  },
  {
    id: "C3",
    title: "Idempotence post-POST",
    file: "packages/worker/src/clob/startup-reconciler.ts",
    patch:
      "Au démarrage : exécutions real `placing` réconciliées via getOrder/getTrades. deterministicSalt supprimé.",
  },
  {
    id: "C4",
    title: "Secrets sécurisés",
    file: "packages/core/src/config/secrets.ts",
    patch:
      "Fail-fast prod, canEnableRealTrading(), npm run generate-secrets. Blocage realTradingEnabled si secrets par défaut.",
  },
  {
    id: "D1",
    title: "Canal WebSocket user (fills async)",
    file: "packages/worker/src/polymarket/websocket-user.ts",
    patch:
      "Auth L2 sur /ws/user, abonnement par conditionId, handler trade/order → finalize placing (match clobOrderId). 8 tests ws-user-events.",
  },
];

const mediumsFixed: Array<[string, string, string]> = [
  ["Approvals pUSD→Exchange", "clob-approvals.ts", "pusdToExchange + pusdToNegRisk ajoutés au batch relayer."],
  ["Frais réels", "real-executor.ts", "getFeeRateBps avec cache FEE_RATE_CACHE_TTL."],
  ["Cache balance pUSD", "real-balance-cache.ts", "invalidateRealBalanceCache() après fill réel."],
  ["Endpoints ops", "internal.ts", "retry-close et replay-dead implémentés (worker-queues.ts)."],
  ["evaluateAll concurrence", "strategy-processing.ts", "Flag evaluating + rerunRequested."],
  ["Code mort live_on_clob", "execution.service.ts", "setLiveOnClob et route PATCH supprimés."],
  ["SL entryBidVwap", "ExecutionResult + finalize", "entryBidVwap = bid VWAP du book à l'exécution."],
  ["Slippage sorties forcées", "SLIPPAGE_GUARDED_REASONS", "Documenté + log warn si slippage > max (sans blocage)."],
  ["recordPlacingClobOrderId", "execution.service.ts", "clobOrderId persisté dès réponse POST pour match WS."],
];

const remaining: Array<[string, string]> = [
  [
    "TLS backend↔worker",
    "Communication interne toujours HTTP — à isoler en déploiement (loopback/Docker).",
  ],
  [
    "Dry-run réel",
    "Valider approvals + petit ordre FAK sur deposit wallet avant activation complète.",
  ],
];

const statusLabel = (s: ProtoStatus) =>
  s === "ok" ? "Conforme" : s === "fixed" ? "Corrigé" : "Partiel";

export default function AuditProtocolesPolymarketCorrige() {
  const theme = useHostTheme();
  const statusColor = (s: ProtoStatus) =>
    s === "ok"
      ? theme.category.green
      : s === "fixed"
        ? theme.category.blue
        : theme.category.yellow;

  return (
    <Stack gap={20} style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <Stack gap={6}>
        <H1>Audit — Protocoles Polymarket (après correctifs)</H1>
        <Text tone="secondary">
          Polywatch v0.3 · patches Phase A+B+C+D1 · 10 juin 2026 · 199 tests verts
          (core 122, worker 33, backend 44)
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value="0" label="Critiques ouverts" tone="success" />
        <Stat value="9 / 9" label="Points moyens corrigés" tone="success" />
        <Stat value="11 / 11" label="Protocoles OK/corrigés" tone="success" />
        <Stat value="Oui*" label="Trading réel viable" tone="success" />
      </Grid>

      <Callout tone="success" title="Verdict">
        Les 4 critiques (C1–C4), les 8 points moyens et le canal WS user (D1) sont
        corrigés. Fills réels couverts par triple filet : réponse synchrone POST,
        WebSocket user async, réconciliation au démarrage. Trading réel viable
        *après* secrets uniques, credentials CLOB valides et dry-run petit montant.
      </Callout>

      <Stack gap={10}>
        <H2>État des protocoles (post-patch)</H2>
        <Table
          headers={["Protocole", "Statut", "Détail", "Fichiers"]}
          rowTone={protocols.map(() => "success" as const)}
          rows={protocols.map((p) => [
            <Text weight="medium" size="small">
              {p.area}
            </Text>,
            <Text
              size="small"
              weight="semibold"
              style={{ color: statusColor(p.status) }}
            >
              {statusLabel(p.status)}
            </Text>,
            <Text size="small" tone="secondary">
              {p.detail}
            </Text>,
            <Text size="small" tone="tertiary">
              {p.files}
            </Text>,
          ])}
        />
      </Stack>

      <Stack gap={12}>
        <H2>Correctifs appliqués (C1–C4 + D1)</H2>
        {fixes.map((item) => (
          <div key={item.id}>
            <Card>
              <CardHeader
                trailing={
                  <Text
                    size="small"
                    weight="semibold"
                    style={{ color: theme.category.green }}
                  >
                    Corrigé
                  </Text>
                }
              >
                {item.id} — {item.title}
              </CardHeader>
              <CardBody>
                <Stack gap={8}>
                  <Text size="small" tone="tertiary">
                    {item.file}
                  </Text>
                  <Text size="small">{item.patch}</Text>
                </Stack>
              </CardBody>
            </Card>
          </div>
        ))}
      </Stack>

      <Stack gap={10}>
        <H2>Points moyens — statut</H2>
        <Table
          headers={["Point", "Fichier", "Correctif"]}
          rowTone={mediumsFixed.map(() => "success" as const)}
          rows={mediumsFixed.map(([t, f, d]) => [
            <Text weight="medium" size="small">
              {t}
            </Text>,
            <Text size="small" tone="tertiary">
              {f}
            </Text>,
            <Text size="small" tone="secondary">
              {d}
            </Text>,
          ])}
        />
      </Stack>

      <Stack gap={10}>
        <H2>Reste à faire (hors périmètre code)</H2>
        <Table
          headers={["Sujet", "Note"]}
          rowTone={remaining.map(() => "warning" as const)}
          rows={remaining.map(([t, n]) => [
            <Text weight="medium" size="small">
              {t}
            </Text>,
            <Text size="small" tone="secondary">
              {n}
            </Text>,
          ])}
        />
      </Stack>

      <Stack gap={10}>
        <H2>Checklist avant activation réelle</H2>
        <Row gap={8} wrap>
          <Pill>npm run generate-secrets → .env</Pill>
          <Pill>Re-saisir credentials CLOB si rotation clé</Pill>
          <Pill>realTradingEnabled=false par défaut</Pill>
          <Pill>Dry-run ordre FAK petit montant</Pill>
          <Pill>Vérifier approvals on-chain deposit wallet</Pill>
          <Pill>Log : WebSocket user channel connected</Pill>
        </Row>
      </Stack>
    </Stack>
  );
}
