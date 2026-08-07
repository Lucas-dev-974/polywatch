# Fix post-audit hardening — relayer idempotence, copy isolation

**Date** : 2026-08-07  
**Statut** : **applied** (2026-08-07 — R1/R2/C1 + dedupe exit `enqueueUnique` ; Q1=a, Q2=a doc, Q3=a, Q4=b)  
**Origine** : vérification d'implémentation du patch de durcissement (session audit Polymarket / pipelines)

## Contexte

Le patch du 2026-08-07 a corrigé C1/H1–H8. Une relecture a détecté des
**régressions introduites par ce patch**. Ce plan ne reprend pas les correctifs
déjà livrés.

## Décisions utilisateur (2026-08-07)

| Q | Choix | Signification |
|---|-------|---------------|
| Q1 CopyProcessor | **a** | Isoler les modes ; si ≥1 throw → rethrow sans `markProcessed` |
| Q2 Faux inflight | **a** | Accepter + documenter (pas de Lua / retry) |
| Q3 Tx OK + Redis fail | **a** | Retenter `markCompleted`, ne pas clear, **retourner le txHash** |
| Q4 Hygiène même PR | **b** | Non — uniquement R1/R2/C1 |

---

## Vérification de véracité et pertinence

Relecture code du 2026-08-07 après les décisions. Verdict par point :

| ID | Véridique ? | Pertinence | Verdict |
|----|-------------|------------|---------|
| **R1** | **Oui** | **Critique — à fixer** | `assertRelayerWithdrawReady` / `decrypt` / `createRelayClient` sont **hors** du `try/catch` qui clear (`relayer-client.ts:294-325`). Un `insufficient_balance` ou `deposit_relayer_wallet_mismatch` laisse `__reserved__` jusqu'au TTL 300 s → 409 faux. Chemin **fréquent** (préflight échoue plus souvent qu'une tx). |
| **R2** | **Oui** | **Haute (proba basse)** | Si `waitForTxHash` OK puis `markCompleted` throw, le `catch` clear → retry = double retrait. Proba faible (Redis vient de réussir le SET NX), mais impact = **perte d'argent**. Même diff que R1 + choix Q3=a. **À fixer.** |
| **C1** | **Oui** | **Haute — à fixer (avec nuance)** | Confirmé : `catch` → `process_mode_error` puis `markProcessed` toujours (`copy-processor.ts:99-109`). La queue ne retry que si `handle()` throw (`redis-queue.ts:150-174`). Aujourd'hui une erreur transitoire sur `real` est **silencieusement perdue**. |
| **R3** | **Oui (théorique)** | **Basse — ne pas coder** | Race SET NX fail → clear concurrent → GET null → `inflight`. Fenêtre ms, auto-résolu. Q2=a : documenter seulement dans ce plan / doc backend. |
| **W1** | Partiel | Nulle pour ce PR | Le `reject` est no-op après `open` (`settled`). Message trompeur seulement si on lit le code du handler. Q4=b → **hors scope**. |
| **H1** | Oui | Nulle | Cosmétique. Q4=b → **hors scope**. |
| **H2** | Oui | Nulle | Duplication de string UX. Q4=b → **hors scope**. |
| **H3** | Oui | Nulle | Dette volontaire. Déjà hors scope. |

### Nuance C1 / Q1=a (pertinent pour l'implémentation)

Order des modes = `[sim?, real?]` (`resolveCopyModesWithReasons`).

Sur **retry** après rethrow, le double-apply est **largement couvert** :
- `signalId` déterministe (`hashCopyOrderSignalId` par `moveEventId` + `mode` + `reason` + `side`)
- Reprise via `findByOrderSignalId` → `resumeEntryFromReservation`
- `position_already_active` / `canHandleEntry` → skip métier (pas de 2e OPEN)
- Dedupe enqueue Redis (`dedupeKey: signalId`)

Donc Q1=a est **pertinent et sûr** pour les entrées. Comportement restauré ≈ pré-patch isolation pour les throws, **avec** isolation (l'autre mode est tenté avant le rethrow).

Risque résiduel accepté (préexistant pour tout throw) : job Redis retenté **et** `loadUnprocessed` peut aussi ré-enqueue — at-least-once, pas exactly-once.

### Ajustement sévérité R2

Le plan initial classait R2 « Critique ». Après relecture : **impact critique, probabilité basse**. On le garde dans le scope (même fonction, Q3=a), sans en faire un incident bloquant séparé de R1.

---

## Scope d'implémentation (après filtrage)

| ID | Action |
|----|--------|
| **R1** | Fix code |
| **R2** | Fix code (variante Q3=a) |
| **C1** | Fix code (politique Q1=a) |
| **R3** | Doc only (commentaire près de `reserveOrGet` ou note dans `docs/code/05-backend.md`) |
| W1, H1, H2, H3 | **Exclus** |

---

## R1 + R2 — `withdrawViaRelayer`

### Fix cible

```ts
const reservation = await reserveOrGet(idemKey);
if (reservation.kind === 'existing') return reservation.hash;
if (reservation.kind === 'inflight') throw new Error('withdraw_in_progress');

let txHash: string | undefined;
try {
  await assertRelayerWithdrawReady(...);
  const signerPrivateKey = decrypt(creds.signerPkEnc);
  const client = createRelayClient(...);
  // execute… → txHash = await waitForTxHash(...)
  await markCompleted(idemKey, txHash);
  return txHash;
} catch (err) {
  if (txHash) {
    // Q3=a : fonds déjà partis — ne jamais clear ; best-effort mark ; succès caller
    await markCompleted(idemKey, txHash).catch(() => {});
    log.error({ err, txHash, idemKey }, 'withdraw succeeded on-chain but post-mark failed');
    return txHash;
  }
  await clearReservation(idemKey).catch(() => {});
  throw normalizeRelayerError(err);
}
```

### Tests

- Préflight throw → clé absente après (R1).
- Execute throw avant hash → clé absente.
- `waitForTxHash` OK + `markCompleted` fail une fois → retourne hash, clé = hash ou au moins pas clearée (R2).

---

## C1 — CopyProcessor politique Q1=a

### Fix cible

```ts
let modeThrew = false;
for (const mode of modes) {
  try {
    const modeResult = await this.processMode(...);
    if (modeResult.kind === 'skip') recordSkip(mode, modeResult.reason);
  } catch (err) {
    modeThrew = true;
    log.error(...);
    recordSkip(mode, 'process_mode_error');
  }
}
if (modeThrew) {
  // Ne pas markProcessed — laisse Redis retry + recoverOrphanMoves
  throw new Error(`copy_process_mode_error:${move.id}`);
}
await this.moveEventService.markProcessedWithReasons([move.id], skipReasons);
```

### Docs

Mettre à jour `docs/pipeline-copy-trading.md` + `docs/code/02-pipeline-copy-trading.md` :
isolation des modes **et** rethrow si un mode a throw.

### Tests

- sim throw + real ok → real appelé ; `handle` throw ; pas de `markProcessed`.
- aucun throw → `markProcessed` appelé.
- skip métier (pas throw) → `markProcessed` normal.

---

## R3 — Documentation seule

Note courte près de `reserveOrGet` ou dans `docs/code/05-backend.md` :

> Race rare : NX refuse + clear concurrent + GET null → `inflight` brief.
> Accepté (TTL 300 s) ; pas de Lua.

---

## Ordre d'implémentation

1. R1+R2 dans `relayer-client.ts` + tests.
2. C1 dans `copy-processor.ts` + tests + docs pipeline.
3. Note R3 (commentaire ou doc backend).
4. Cocher checklist ; déplacer ce plan vers `applied/` après vérif code.

## Checklist de validation

```bash
npx tsc -p packages/backend/tsconfig.json --noEmit
npx tsc -p packages/copy-trading/tsconfig.json --noEmit
# tests à ajouter / lancer pour relayer + copy-processor
```

- [x] R1 : préflight fail → clé Redis absente
- [x] R2 : txHash connu + mark fail → return hash, pas de clear
- [x] C1 : throw d'un mode → pas de markProcessed ; handle rethrow
- [x] C1 : chemin nominal (skips métier) → markProcessed inchangé
- [x] Docs pipeline à jour
- [x] Pas de changements H1/H2/W1 (exclus)
- [x] Follow-up : `copy-exit-pipeline` `enqueueUnique` (TTL 120 s) contre double SELL sur retry C1

## Follow-up appliqué (2026-08-07)

Dedupe sorties copy : `orderQueue.enqueueUnique(job, signalId, 120)` dans
`copy-exit-pipeline.ts` — aligné sur weather (`CLOSE_QUEUE_DEDUPE_TTL_SECONDS`).
Un marker déjà présent → log + succès (pas de flood). Docs :
`pipeline-copy-trading.md`, `docs/code/02-pipeline-copy-trading.md`.

## Hors scope

- Hygiène H1/H2/W1 et helper WS H3.
- Script Lua / sleep-retry pour R3.
- Migration forcée clés AES legacy.
