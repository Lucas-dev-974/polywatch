import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
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

type ProtoStatus = "ok" | "partial" | "broken";

const protocols: Array<{
  area: string;
  status: ProtoStatus;
  detail: string;
  files: string;
}> = [
  {
    area: "Auth CLOB L1/L2 (EIP-712 + HMAC)",
    status: "ok",
    detail:
      "Déléguée à @polymarket/clob-client-v2 (^1.0.6). Signer ethers v5 + creds API key/secret/passphrase chiffrés AES-256-GCM en DB.",
    files: "worker/src/clob/client-factory.ts",
  },
  {
    area: "Signature d'ordres V2 (POLY_1271, deposit wallet)",
    status: "ok",
    detail:
      "signatureType 3 (ERC-1271), funder = deposit address, struct Order signée par la lib. Seul le type 3 est autorisé pour le trading réel.",
    files: "client-factory.ts · core/polymarket/clob-signature.ts",
  },
  {
    area: "Placement d'ordres FAK (POST /order)",
    status: "partial",
    detail:
      "createAndPostMarketOrder avec tickSize + negRisk. Mais le parsing du fill est inversé (voir C1) et le salt déterministe n'est pas utilisé (C3).",
    files: "worker/src/clob/real-executor.ts",
  },
  {
    area: "WebSocket market channel",
    status: "ok",
    detail:
      "wss://ws-subscriptions-clob.polymarket.com/ws/market — snapshots `book` + deltas `price_change`, PING/PONG 10s, reconnect expo (max 5), fallback REST /book.",
    files: "worker/src/polymarket/websocket-book.ts",
  },
  {
    area: "WebSocket user channel (fills asynchrones)",
    status: "partial",
    detail:
      "Non souscrit. Les fills sont lus uniquement dans la réponse synchrone du POST /order — un ordre `delayed` matché plus tard n'est jamais réconcilié.",
    files: "websocket-book.ts (absent)",
  },
  {
    area: "Data API (positions, value, activity)",
    status: "ok",
    detail:
      "Pagination limit=500, max 20 pages, rate-limit 250ms entre pages. Conforme aux limites documentées.",
    files: "worker/src/polymarket/api-client.ts",
  },
  {
    area: "Gamma API (métadonnées marché)",
    status: "partial",
    detail:
      "OK pour question/negRisk/takerFee/tokenIds. Mais le fallback CLOB hardcode takerBaseFee=0 → frais sous-comptés.",
    files: "core/src/polymarket/market-metadata.ts:164",
  },
  {
    area: "Tick size & montants",
    status: "ok",
    detail:
      "getTickSize via CLOB, cache 5 min, arrondi au tick le plus proche. BUY en USDC (qty × prix), SELL en shares — conforme à UserMarketOrderV2.",
    files: "real-executor.ts:22-39, 171",
  },
  {
    area: "Approvals deposit wallet (relayer)",
    status: "partial",
    detail:
      "pUSD→CTF + CTF setApprovalForAll vers Exchange V2 et NegRisk V2 via batch relayer. Manque potentiellement pUSD→Exchange V2 (voir points moyens).",
    files: "backend/src/polymarket/clob-approvals.ts",
  },
  {
    area: "Redemption on-chain (CTF / NegRiskAdapter)",
    status: "broken",
    detail:
      "indexSets construits avec le tokenId (bytes32) au lieu des masques de partition uint256 [1]/[2] — l'appel revert ou ne rachète rien (C2).",
    files: "backend/src/polymarket/clob-redeem.ts:50-54",
  },
  {
    area: "Adresses de contrats Polygon",
    status: "ok",
    detail:
      "Exchange V2 0xE111…996B, NegRisk V2 0xe222…0F59, CTF 0x4D97…6045, pUSD 0xC011…2DFB, V1 0x4bFb…982E réservé à getPolyProxyWalletAddress — cohérent.",
    files: "core/src/polymarket/clob-contracts.ts",
  },
];

const criticals = [
  {
    id: "C1",
    title: "parseFillResponse : makingAmount / takingAmount inversés",
    file: "packages/worker/src/clob/real-executor.ts:60-68",
    body:
      "Pour un BUY, la réponse CLOB renvoie makingAmount = USDC dépensés et takingAmount = shares reçues (doc officielle POST /order). Le code fait l'inverse : fillQuantity = makingAmount pour BUY et takingAmount pour SELL. Résultat : la quantité enregistrée est le montant USDC, et actualFillPrice = 1/prix (ex. 2.0 au lieu de 0.5). Toute la comptabilité aval (position, PnL, SL/TP, exposition) serait fausse dès le premier ordre réel.",
    fix:
      "Inverser le mapping : BUY → fillQuantity = takingAmount, prix = making/taking ; SELL → fillQuantity = makingAmount, prix = taking/making. Vérifier aussi si la réponse est en unités brutes 6 décimales (l'exemple de la doc montre '100000000') et diviser par 1e6 le cas échéant.",
  },
  {
    id: "C2",
    title: "Redemption on-chain : indexSets invalides",
    file: "packages/backend/src/polymarket/clob-redeem.ts:10-16, 50-54",
    body:
      "Trois erreurs cumulées : (1) l'ABI déclare redeemPositions(..., bytes32[] indexSets) alors que le CTF attend uint256[] ; (2) la valeur passée est [[winningTokenId]] — un tableau imbriqué d'un hash bytes32, alors qu'il faut les masques de partition plats [1] (YES) ou [2] (NO) ; (3) NegRiskAdapter.redeemPositions(conditionId, amounts) attend des montants de tokens par outcome, pas des indexSets. L'encodage échoue ou la transaction rachète 0 share : les gains des marchés résolus ne sont jamais récupérés.",
    fix:
      "CTF standard : indexSets = [1] ou [2] (uint256[]) selon l'outcome gagnant, dérivé de la position du tokenId dans clobTokenIds. NegRisk : passer amounts = [qtyYes, qtyNo] en unités brutes.",
  },
  {
    id: "C3",
    title: "deterministicSalt défini mais jamais utilisé",
    file: "packages/worker/src/clob/real-executor.ts:15-18",
    body:
      "La fonction existe (et l'audit interne la liste comme « point solide ») mais n'est jamais passée à createAndPostMarketOrder. La lib génère donc un salt aléatoire : si un OrderSignal est retraité (crash entre le POST CLOB et l'écriture du résultat, replay Redis), un second ordre identique part sur le CLOB. Le claim() en DB protège avant le POST, pas entre le POST et la persistance du résultat.",
    fix:
      "Si la lib v2 ne permet pas d'injecter le salt, ajouter une réconciliation au démarrage : getOpenOrders/getTrades sur le CLOB pour les exécutions en statut `placing` avant de rejouer le signal.",
  },
  {
    id: "C4",
    title: "Secrets par défaut hardcodés (.env = .env.example)",
    file: "packages/backend/src/config.ts · .env",
    body:
      "MASTER_ENCRYPTION_KEY vaut la valeur d'exemple publique ('0123456789abcdef…') — c'est la clé qui chiffre la clé privée du wallet en DB. JWT_SECRET, JWT_REFRESH_SECRET et SERVICE_TOKEN ont aussi des fallbacks hardcodés. Quiconque lit le repo peut déchiffrer la DB ou appeler /api/internal/clob-credentials qui renvoie la clé privée en clair.",
    fix:
      "Générer des secrets aléatoires uniques avant toute activation réelle, supprimer les fallbacks (fail-fast si absent), et isoler backend↔worker sur loopback/réseau Docker privé.",
  },
];

const mediums: Array<[string, string, string]> = [
  [
    "Approvals pUSD incomplets ?",
    "clob-approvals.ts:69",
    "pUSD est approuvé vers le CTF uniquement. Le set standard Polymarket approuve aussi le collatéral vers Exchange et NegRisk Exchange (transferFrom au matching des BUY). À confirmer pour l'architecture deposit wallet — sinon premier BUY → INSUFFICIENT_ALLOWANCE.",
  ],
  [
    "Frais : takerBaseFee=0 et feeRate=0",
    "market-metadata.ts:164 · real-executor.ts:75,197",
    "Fallback CLOB hardcode takerBaseFee=0 ; parseFillResponse renvoie feeRate=0 ; market?.takerBaseFee ?? 0 si marché absent en DB. Écart comptable PnL réel vs enregistré.",
  ],
  [
    "Slippage guard absent sur les sorties forcées",
    "real-executor.ts:136-145",
    "SL, TRAILING, KILL_SWITCH, COPY_CLOSE, PRE_CLOSE_LOSS sortent sans limite de prix. Probablement voulu (sortir à tout prix), mais à documenter explicitement.",
  ],
  [
    "Balance pUSD cachée 10s sans déduction des ordres en vol",
    "copy-processor.ts:35-51",
    "Plusieurs entrées rapprochées peuvent dimensionner sur la même balance → rejets INSUFFICIENT_BALANCE. Invalider le cache après chaque ordre.",
  ],
  [
    "Endpoints internes factices",
    "backend/src/routes/internal.ts:208-223",
    "retry-close et replay-dead répondent ok sans rien faire. En incident, l'opérateur croit avoir agi.",
  ],
  [
    "evaluateAll() sans garde de concurrence",
    "worker/src/index.ts:123 · strategy-processing.ts",
    "Déclenché à chaque update WS + boucle 100ms, les appels peuvent s'empiler (requêtes DB). Ajouter un flag de cycle en cours.",
  ],
  [
    "Statut live_on_clob / setLiveOnClob jamais invoqués",
    "core/src/services/execution.service.ts",
    "Code mort : les exécutions passent directement de placing à filled/failed.",
  ],
  [
    "SL basé sur entryBidVwap = prix ask du fill",
    "strategy-processing.ts:248-252",
    "Le trigger compare un bid courant à une entrée valorisée à l'ask → SL légèrement retardé. Biais mineur.",
  ],
];

const recommandations: Array<[string, string]> = [
  [
    "P0",
    "Corriger C1 (mapping making/takingAmount + unités) et C4 (secrets) — préalables absolus au réel.",
  ],
  [
    "P0",
    "Corriger C2 (indexSets redemption) — sinon les gains restent bloqués on-chain.",
  ],
  [
    "P1",
    "C3 : réconciliation CLOB au démarrage (getTrades/getOpenOrders) pour les exécutions `placing`.",
  ],
  [
    "P1",
    "Vérifier les approvals pUSD→Exchange V2 sur un deposit wallet réel (dry-run petit montant).",
  ],
  [
    "P2",
    "Frais réels (feeRate de la réponse / Gamma), cache balance, garde evaluateAll, endpoints internes factices.",
  ],
];

const statusLabel = (s: ProtoStatus) =>
  s === "ok" ? "Conforme" : s === "partial" ? "Partiel" : "Cassé";

export default function AuditProtocolesPolymarket() {
  const theme = useHostTheme();
  const statusColor = (s: ProtoStatus) =>
    s === "ok"
      ? theme.category.green
      : s === "partial"
        ? theme.category.yellow
        : theme.diff.stripRemoved;

  return (
    <Stack gap={20} style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <Stack gap={6}>
        <H1>Audit — Protocoles Polymarket (avant correctifs)</H1>
        <Text tone="secondary">
          Polywatch v0.3 · état initial · revue statique du 10 juin 2026 ·
          vérifications croisées avec la doc officielle Polymarket et les types
          de `@polymarket/clob-client-v2@1.0.6`
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value="4" label="Critiques (bloquants)" tone="danger" />
        <Stat value="8" label="Points moyens" tone="warning" />
        <Stat value="7 / 11" label="Protocoles conformes" tone="success" />
        <Stat value="Non" label="Trading réel sûr en l'état" tone="danger" />
      </Grid>

      <Callout tone="danger" title="Verdict">
        L'architecture (idempotence, files Redis, double interrupteur
        sim/réel, WebSocket, sizing) est solide, mais deux bugs rendent le
        trading réel inutilisable en l'état : le parsing des fills est inversé
        (C1) et la redemption on-chain est invalide (C2). À corriger avant
        d'activer `realTradingEnabled`.
      </Callout>

      <Stack gap={10}>
        <H2>État d'implémentation des protocoles Polymarket</H2>
        <Table
          headers={["Protocole / zone", "Statut", "Détail", "Fichiers"]}
          columnAlign={["left", "left", "left", "left"]}
          rowTone={protocols.map((p) =>
            p.status === "ok"
              ? ("success" as const)
              : p.status === "partial"
                ? ("warning" as const)
                : ("danger" as const),
          )}
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
        <Text size="small" tone="tertiary">
          Source : lecture du code packages/worker, backend, core · doc
          docs.polymarket.com (POST /order, order lifecycle, deposit wallets)
        </Text>
      </Stack>

      <Stack gap={12}>
        <H2>Points critiques — à corriger avant tout ordre réel</H2>
        {criticals.map((item) => (
          <div key={item.id}>
            <Card>
              <CardHeader
                trailing={
                  <Text
                    size="small"
                    weight="semibold"
                    style={{ color: theme.diff.stripRemoved }}
                  >
                    Critique
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
                  <Text size="small">{item.body}</Text>
                  <Divider />
                  <Text size="small">
                    <Text as="span" weight="semibold">
                      Correctif :
                    </Text>{" "}
                    {item.fix}
                  </Text>
                </Stack>
              </CardBody>
            </Card>
          </div>
        ))}
      </Stack>

      <Stack gap={10}>
        <H2>Points moyens</H2>
        <Table
          headers={["Problème", "Localisation", "Détail"]}
          rowTone={mediums.map(() => "warning" as const)}
          rows={mediums.map(([t, f, d]) => [
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
        <H2>Points solides confirmés</H2>
        <Row gap={8} wrap>
          <Pill>Idempotence signaux (SHA-256 + claim DB)</Pill>
          <Pill>Files Redis fiables + dead-letter + recoverOrphans</Pill>
          <Pill>Double interrupteur realEnabled × realTradingEnabled</Pill>
          <Pill>WS book temps réel + fallback REST</Pill>
          <Pill>Limites exposition / taille / slippage entrées</Pill>
          <Pill>Kill switch force_close_all</Pill>
          <Pill>Chiffrement AES-256-GCM des credentials</Pill>
          <Pill>Aucune fuite de secrets dans les logs</Pill>
        </Row>
      </Stack>

      <Stack gap={8}>
        <H2>Ordre de correction recommandé</H2>
        <Table
          headers={["Priorité", "Action"]}
          columnAlign={["left", "left"]}
          rows={recommandations.map(([p, action]) => [
            <Text weight="semibold" size="small">
              {p}
            </Text>,
            <Text size="small" tone="secondary">
              {action}
            </Text>,
          ])}
        />
      </Stack>
    </Stack>
  );
}
