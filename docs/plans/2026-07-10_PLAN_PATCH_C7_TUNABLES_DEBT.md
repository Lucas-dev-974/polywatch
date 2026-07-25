# Plan — Patch C7 : dette tunables (defaults, contrat API, parse, UX)

**Date** : 2026-07-10  
**Dernière mise à jour** : 2026-07-10  
**Version cible** : v1.1  
**Statut** : Implémenté (version pragmatique)  
**Tags** : `crypto-algo`, `tunables`, `risk-config`, `api`, `frontend`  
**Références** :
- Parent : `2026-07-10_PLAN_FIX_AUDIT_POST_TUNABLES.md` §8 (C7 reporté)
- Prérequis : `2026-07-09_PLAN_UI_CRYPTO_ALGO_TUNABLES.md` (déjà Implémenté)

---

## 1. Objectif

Rendre le contrat des tunables crypto-algo **prévisible et maintenable** sans changer le comportement de trading nominal :

| ID | Problème | Statut |
|----|----------|--------|
| C7.1 | Defaults dupliqués ×4 | ✅ Re-export core→crypto-algo ; UI copies + snapshot anti-dérive |
| C7.2 | API `null` vs `{}` | ✅ `emptyMapToNull` au GET |
| C7.3 | Parse JSON silencieux | ✅ warn pino si JSON non-vide invalide |
| C7.4 | Secondes flottantes acceptées | ✅ int Zod + validate |
| C7.5 | Save UI avec draft JSON invalide | ✅ bouton disabled + message |

**Hors scope** : nouvelles colonnes DB, Strategy Builder, changement des valeurs numériques des defaults.

---

## 2. C7.1 — Source unique des defaults

### Diagnostic

| Emplacement | Contenu |
|-------------|---------|
| `packages/core/src/risk/crypto-algo-tunables.ts` | `DEFAULT_CRYPTO_ALGO_*`, `DEFAULT_CRYPTO_ALGO_SPREAD_ABS_BY_INTERVAL` |
| `packages/core/src/risk/crypto-algo-exit.ts` | `CRYPTO_INTERVAL_EXIT_DEFAULTS`, `CRYPTO_INTERVAL_PRE_CLOSE_SECONDS`, `CRYPTO_INTERVAL_TIME_EXIT_SECONDS` |
| `packages/crypto-algo/src/strategy/constants.ts` | `SPREAD_ABS_BY_INTERVAL` (copie) |
| `packages/frontend/.../crypto-algo-settings-types.ts` | `CODE_DEFAULT_*` (copie) |

### Correctif

1. **Core = source de vérité**  
   - Garder les tables dans `crypto-algo-tunables.ts` / `crypto-algo-exit.ts`.  
   - Exporter explicitement (déjà le cas pour la plupart).

2. **crypto-algo `constants.ts`**  
   - `SPREAD_ABS_BY_INTERVAL` devient un ré-export / alias de `DEFAULT_CRYPTO_ALGO_SPREAD_ABS_BY_INTERVAL` depuis `@polywatch/core` (éviter la double table).  
   - `getMaxSpreadAbsForInterval` continue d’accepter l’override RiskConfig.

3. **Frontend** (pragmatique — **ne pas** importer `@polywatch/core` runtime dans Vite)  
   - Garder `CODE_DEFAULT_*` locaux avec commentaire « keep in sync with core ».  
   - Raison : un import runtime core tire des deps Node (`buffer`, etc.) et gonfle le bundle (~858 KB → ~1.9 MB).

4. **Test anti-dérive**  
   - `crypto-algo-tunables.test.ts` : snapshot des tables defaults core (garde-fou).  
   - Sync manuelle UI documentée dans `docs/crypto-algo.md`.

### Critère done

Core = source autoritative ; crypto-algo re-exporte le spread ; UI = copies + doc sync ; snapshot core anti-dérive.

---

## 3. C7.2 — Normaliser `null` vs `{}` à l’API

### Diagnostic

`parseCryptoAlgoIntervalNumberMap('{}')` → `{}` ; merge traite `{}` comme « pas d’override ».  
`presentRiskConfigForApi` renvoie parfois `{}`, parfois `null` selon le contenu DB.

### Correctif

Dans `presentRiskConfigForApi` (`risk-config-api.ts`) :

```ts
function emptyMapToNull<T extends object>(m: T | null): T | null {
  if (m == null) return null;
  return Object.keys(m).length === 0 ? null : m;
}
```

Appliquer aux 4 maps crypto-algo présentées.

À l’écriture (`serializeCryptoAlgoIntervalJsonMap`) : déjà `{}` → `null` — vérifier et garder.

### Tests

- Round-trip : DB `NULL` / `''` / `'{}'` → GET API toujours `null`.  
- DB `'{"5m":0.05}'` → objet partiel inchangé.

### Critère done

Contrat GET stable : « pas d’override » = toujours `null`.

---

## 4. C7.3 — Parse JSON observable (sans casser le runtime)

### Diagnostic

JSON invalide ou valeurs mal typées → `null` / skip silencieux → defaults code, indistinguable d’un `null` voulu.

### Correctif (pragmatique)

1. Ajouter des variantes **diagnostiques** (ou options) :

```ts
parseCryptoAlgoIntervalNumberMap(json, { onInvalid?: (info) => void })
```

2. Au **GET** (`presentRiskConfigForApi`) : si le texte DB est non-vide mais parse → `null`, logger un `warn` pino une fois (ou via callback injecté) avec `field` + extrait.  
   Ne **pas** faire échouer le GET (backend doit rester up).

3. Au **PATCH** : déjà validé par Zod + `validateCryptoAlgoTunablesUpdate` — renforcer C7.4 (entiers). Les écritures API restent strictes.

4. Tests unitaires parse : JSON invalide, clé inconnue ignorée, valeur string ignorée, `{}` → `{}` puis normalisé `null` en présentation.

### Critère done

Corruption DB visible dans les logs ; comportement runtime inchangé (fallback defaults).

---

## 5. C7.4 — Secondes = entiers

### Diagnostic

`validateNumberMap` / Zod acceptent `90.7` pour pre-close / time-exit.

### Correctif

1. Dans `validateCryptoAlgoTunablesUpdate` : pour  
   `cryptoAlgoPreCloseSecondsByInterval` et `cryptoAlgoTimeExitSecondsByInterval`, exiger `Number.isInteger(num)`.  
2. Aligner Zod dans `packages/backend/src/routes/config.ts` (`z.number().int()`).  
3. Frontend `validateIntervalJsonMap` (kind number pour ces champs) : même règle.

`cryptoAlgoSpreadAbsByInterval` reste en flottants (points de probabilité).

### Tests

- PATCH `{"5m": 90.7}` → 400.  
- PATCH `{"5m": 90}` → OK.

---

## 6. C7.5 — Bloquer le save UI si draft JSON invalide

### Diagnostic

`JsonIntervalMapField` : en erreur, `onChange` n’est pas appelé → `config()` garde l’ancienne valeur → `save()` persiste l’ancien override sans feedback clair.

### Correctif

1. Exposer l’état d’erreur hors du champ :
   - Soit `onValidityChange?: (ok: boolean) => void`  
   - Soit `ref` / store partagé dans le dialog.

2. `CryptoAlgoSettingsDialog.save()` :
   - Si un des maps a `parseError` actif → **ne pas** appeler l’API ; toast / message « JSON invalide — corrigez ou réinitialisez ».

3. Option UX : bouton save disabled tant qu’il y a une erreur (meilleur).

### Tests

- Test composant / logique : draft invalide → `canSave === false`.  
- (Pas besoin de Playwright si unitaire Solid est lourd — test de la fonction `hasJsonMapErrors` suffit.)

---

## 7. Ordre d’implémentation

1. **C7.2 + C7.4** (API/contrat, peu de surface)  
2. **C7.3** (logs parse)  
3. **C7.5** (UI save)  
4. **C7.1** (defaults uniques / test anti-dérive) — le plus délicat cross-package

Pas de migration SQL. Pas de changement des valeurs numériques.

---

## 8. Fichiers touchés (estimé)

| Zone | Fichiers |
|------|----------|
| Core | `crypto-algo-tunables.ts`, `risk-config-api.ts`, tests associés |
| Backend | `routes/config.ts` (Zod int) |
| Frontend | `JsonIntervalMapField.tsx`, `CryptoAlgoSettingsDialog.tsx`, `crypto-algo-settings-types.ts`, éventuellement suppression `CODE_DEFAULT_*` |
| crypto-algo | `strategy/constants.ts` (re-export) |
| Doc | `docs/crypto-algo.md` (contrat `null`), ce plan → Implémenté |

---

## 9. Critères de done

- [x] GET RiskConfig : maps vides toujours `null`  
- [x] PATCH refuse secondes non entières  
- [x] JSON DB invalide → log warn (test ou assertion mock)  
- [x] Save UI bloqué / message si draft JSON invalide  
- [x] Defaults : source autoritative core + re-export crypto-algo + copies UI + snapshot anti-dérive  
- [x] Builds + tests core / backend / frontend concernés verts  
- [x] Aucun changement de comportement trading (spread gate, exits) hors validation plus stricte à l’écriture

---

## 10. Risques

| Risque | Mitigation |
|--------|------------|
| Client API qui attendait `{}` | Documenter breaking soft ; `{}` et `null` étaient déjà équivalents au merge |
| Frontend ne peut pas importer core | Fallback test d’égalité + doc sync |
| Trop de logs warn | Logger seulement si `json.trim() !== ''` et parse échoue |
