# Fix post-audit hardening — relayer idempotence, copy isolation, hygiène

**Date** : 2026-08-07  
**Statut** : **not_implemented** (décisions ouvertes — voir § Décisions)  
**Origine** : vérification d'implémentation du patch de durcissement (session audit Polymarket / pipelines)

## Contexte

Le patch du 2026-08-07 a corrigé C1/H1–H8 (timeout approvals, cache generation,
slippage signé, isolation modes copy, idempotence relayer SET NX, warn clé
legacy, alerts fire-and-forget, WS user connect timeout). Une relecture a
détecté des **régressions introduites par ce patch** et quelques points
d'hygiène optionnels.

Ce plan ne reprend **pas** les correctifs déjà livrés ; uniquement les
problèmes restants.

## Inventaire des problèmes

| ID | Sévérité | Fichier | Symptôme | Fix nécessaire ? |
|----|----------|---------|----------|------------------|
| **R1** | **Critique** | `backend/.../relayer-client.ts` | Réservation Redis non libérée si préflight (`assertRelayerWithdrawReady` / `decrypt`) échoue → faux `withdraw_in_progress` pendant jusqu'à 5 min | **Oui** |
| **R2** | **Critique** | `backend/.../relayer-client.ts` | Si tx on-chain OK mais `markCompleted` échoue → `clearReservation` + erreur UI → retry peut **double-spender** | **Oui** |
| **C1** | **Haute** | `copy-trading/.../copy-processor.ts` | `try/catch` par mode marque toujours le move `processed` → plus de retry Redis sur erreur transitoire | **Oui** (politique à trancher — Q1) |
| **R3** | Mineure | `relayer-client.ts` `reserveOrGet` | Course SET NX refusé → GET null après clear concurrent → faux `inflight` brief | Optionnel (Q2) |
| **W1** | Cosmétique | `websocket-user.ts` | Message reject « closed before open » trompeur si loggé hors chemin (reject no-op après open) | Optionnel |
| **H1** | Hygiène | `position-exit-evaluator.ts` | `Promise.resolve(alert...).catch` redondant maintenant que l'alerte est sync | Optionnel |
| **H2** | Hygiène | `PusdTransferDialog.tsx` | Message hint dupliqué vs `pusd-errors.ts` | Optionnel |
| **H3** | Hygiène | `websocket-book` / `websocket-user` | Pattern `connectTimeout`/`onSettled` dupliqué | Non (hors scope — dette volontaire) |

---

## R1 — Libérer la réservation sur échec préflight

### Problème

```ts
const reservation = await reserveOrGet(idemKey); // reserved
await assertRelayerWithdrawReady(...);           // hors try → throw laisse __reserved__
const signerPrivateKey = decrypt(...);           // idem
try { /* execute + markCompleted */ } catch { clearReservation }
```

### Fix proposé

Envelopper **tout** ce qui suit un `kind: 'reserved'` dans un try/catch unique :

```ts
const reservation = await reserveOrGet(idemKey);
if (reservation.kind === 'existing') return reservation.hash;
if (reservation.kind === 'inflight') throw new Error('withdraw_in_progress');

let txHash: string | undefined;
try {
  await assertRelayerWithdrawReady(...);
  const signerPrivateKey = decrypt(creds.signerPkEnc);
  const client = createRelayClient(...);
  // execute + waitForTxHash → txHash = ...
  await markCompleted(idemKey, txHash);
  return txHash;
} catch (err) {
  // R2 : ne clear que si aucune tx connue — voir § R2
  if (txHash) {
    await markCompleted(idemKey, txHash).catch(() => {});
    // Prefer returning the hash over surfacing a Redis failure (Q3)
  } else {
    await clearReservation(idemKey).catch(() => {});
  }
  throw normalizeRelayerError(err);
}
```

### Tests

- Unit / integration : mock Redis + mock `assertRelayerWithdrawReady` qui throw → clé absente après catch.
- Mock execute qui throw avant hash → clé absente.
- Mock execute OK + `markCompleted` fail → clé = hash (ou au moins pas clear).

---

## R2 — Ne jamais clear après succès on-chain

### Problème

Aujourd'hui tout `catch` appelle `clearReservation`. Si `waitForTxHash` a
réussi et seul `markCompleted` échoue, le clear ouvre la voie au double retrait.

### Fix proposé (dépend de Q3)

**Variante A (recommandée)** — si `txHash` connu :
1. Retenter `markCompleted` (best-effort).
2. **Ne pas** `clearReservation`.
3. **Retourner `txHash`** à l'appelant (succès utilisateur) même si Redis a flanché ; logger `error`.

**Variante B** — si `txHash` connu : retenter `markCompleted`, ne pas clear, mais **propager l'erreur** Redis (UI erreur alors que les fonds ont bougé — mauvais UX, risque de retry manuel si le front ignore le 502).

### Décision requise : **Q3**

---

## C1 — Politique d'erreur CopyProcessor (isolation ≠ silence)

### Problème

Le patch isole correctement `sim` / `real`, mais avale toute exception puis
`markProcessedWithReasons` → un échec transitoire sur `real` n'est plus retenté
par la queue Redis.

### Options (Q1)

| Option | Comportement | Pros | Cons |
|--------|--------------|------|------|
| **a** | Isoler les modes ; si **au moins un** mode a throw → **rethrow** après avoir tenté les autres (ne pas `markProcessed`) | Retry Redis conservé ; isolation préservée | Un mode OK + un mode KO → retry peut rejouer le mode OK (idempotence entry/exit à vérifier) |
| **b** | Isoler ; `markProcessed` seulement si **aucun** throw ; si throw sur un mode → rethrow | Idem | Idem risque double-apply sur le mode qui avait réussi |
| **c** | Isoler ; toujours `markProcessed` avec `process_mode_error` (statut actuel) | Pas de boucle retry | Perte silencieuse sur erreur transitoire |
| **d** | Isoler ; `markProcessed` si le mode **real** (quand demandé) a réussi ou skip métier ; rethrow seulement si `real` a throw | Protège le chemin argent | Sim peut rester non traité / skip opaque |

### Décision requise : **Q1**

Recommandation provisoire : **a** ou **d**, selon le risque de double-apply
entry (réservations / idempotence logicalKey). À valider en lisant
`runCopyEntryPipeline` / claim d'exécution.

### Travail associé

- Documenter la politique dans `docs/pipeline-copy-trading.md` + `02-pipeline-copy-trading.md`.
- Test unitaire : sim throw + real ok → real exécuté ; selon Q1, processed ou rethrow.
- Test : real throw → job non ack / rethrow.

---

## R3 — Faux `inflight` (course GET)

### Options (Q2)

| Option | Fix |
|--------|-----|
| **a** | Accepter (TTL 5 min max, rare) — documenter seulement |
| **b** | Script Lua atomique `SET NX` + lecture valeur en une round-trip |
| **c** | Sur `inflight`, sleep court (50–100 ms) + 1 re-GET avant throw |

Recommandation : **a** sauf si on touche déjà Redis pour R1/R2 et que Lua est cheap.

---

## Hygiène optionnelle (H1–H2, W1)

À faire **dans le même PR** seulement si Q4 = oui.

| ID | Action |
|----|--------|
| H1 | `void this.alertExitEmitBlock(...).catch(...)` sans `Promise.resolve` |
| H2 | Hint UI = `mapPusdTransferError('withdraw_in_progress')` |
| W1 | Ne pas `reject` avec un message « before open » depuis le handler `close` générique ; ou ignorer (no-op déjà) |

H3 (helper WS partagé) : **hors scope**.

---

## Ordre d'implémentation

1. Trancher Q1 / Q2 / Q3 / Q4 (questions ci-dessous).
2. **R1 + R2** dans `relayer-client.ts` (même diff) + tests.
3. **C1** selon Q1 + tests + doc pipeline.
4. R3 si Q2 ≠ a.
5. Hygiène si Q4 = oui.
6. Mettre à jour `POLYMARKET_PROTOCOL_VERIFICATION_PLAN.md` § patch (statut R1/R2/C1).
7. Déplacer ce plan vers `applied/` quand les cases sont cochées **et** vérifiées dans le code.

## Checklist de validation

```bash
# backend
npx tsc -p packages/backend/tsconfig.json --noEmit
# ajouter / lancer tests relayer idempotence si créés

# copy-trading
npx tsc -p packages/copy-trading/tsconfig.json --noEmit
npx vitest run -w @polywatch/copy-trading -- copy-processor   # si tests ajoutés

# worker (hygiène éventuelle)
npx vitest run -w @polywatch/worker -- slippage-guard
```

- [ ] R1 : préflight fail → clé Redis absente
- [ ] R2 : txHash connu + Redis down → pas de clear ; pas de double retrait au retry
- [ ] C1 : comportement conforme à Q1
- [ ] Frontend 409 / hint inchangé (régression non introduite)
- [ ] Docs pipeline + plan protocol à jour

## Décisions (à remplir après réponses)

| Q | Décision | Date |
|---|----------|------|
| Q1 CopyProcessor | _pending_ | |
| Q2 Faux inflight | _pending_ | |
| Q3 Succès on-chain + Redis fail | _pending_ | |
| Q4 Hygiène dans le même PR | _pending_ | |

## Hors scope

- Refactor helper WS partagé (H3).
- Migration forcée des clés AES legacy (warning only déjà livré).
- Autres findings du deep-audit non inclus dans le patch 2026-08-07.
