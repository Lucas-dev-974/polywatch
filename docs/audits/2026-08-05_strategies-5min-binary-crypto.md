# Rapport — stratégies candidates pour marchés binaires YES/NO crypto 5 min

**Date** : 2026-08-05  
**Périmètre** : marchés Polymarket binaires crypto up/down (5M, 15M, 1H) — focus **5 min**. Entrées observées 0,53–0,65. Données dispo : order book WS, mid history, `algo_price_ticks` (1 Hz, purgé 24 h), snapshots surveillance.  
**Verdict architecture** : le projet peut héberger plusieurs stratégies + switcher via config (**partiel**) — interface + registry + `cryptoAlgoStrategies` + first-wins + entrée/sortie partagées existent ; il manque l'auto-enregistrement, un `setConfig` générique, un store de params par stratégie et un catalogue UI.

---

## 0. Contraintes dures (à respecter avant tout choix)

- **Seuil de rentabilité = prix d'entrée.** Acheter un binaire à `p` exige WR > `p`. Session #106 : 0,55–0,60 → WR 42 % (besoin ≥ 57 %), 0,60–0,65 → WR 36 %. **L'entrée inconditionnelle perd à tous les prix** — l'edge doit venir du *conditionnement* (temps restant, flux, oracle), pas du niveau de prix.
- **Frais taker** max à 0,50, quasi nuls aux extrêmes. Les entrées coin-flip paient fee + spread max.
- **La jambe SL est le problème** (−31,27 USDC sur #106), pas l'entrée seule. La conception de sortie compte plus que l'entrée.
- **Résolution = Chainlink TWAP** (depuis 2026-08-07 : 30 s TWAP sur 5M, 60 s sur 15M) → l'issue devient progressivement connaissable en fin de fenêtre. Flux **RTDS** (`prices.crypto.chainlink.twap`, sans auth) aligné résolution.
- **Config actuelle bloque les entrées tardives** : `minTimeToClose` = 150 s sur 5M → toute stratégie de convergence exige un override par stratégie.

---

## 1. Verdict architecture — le projet supporte-t-il N stratégies + switch config ?

**PARTIEL.** Switch config des ids enregistrés **fonctionne déjà** ; héberger N stratégies proprement demande des ajouts.

| Capacité | Statut | Emplacement |
|---|---|---|
| Interface stratégie (`CryptoAlgoStrategy`) | ✅ | `strategy/strategy.ts` |
| Types signal / abstain | ✅ | même fichier |
| Registry filtré par config | ✅ | `strategy/registry.ts` |
| Champ switch `cryptoAlgoStrategies` (JSON ids) | ✅ | `CryptoConfig` + `getCryptoAlgoStrategies` |
| Runner multi-éval first-wins | ✅ | `strategy-runner.ts` L596–677 |
| Entrée pipeline partagée | ✅ | `processors/algo-entry-pipeline.ts` |
| Sortie worker partagée (découplée) | ✅ | `position-exit-evaluator` |
| Enregistrement manuel (hardcodé) | ⚠️ | `crypto-algo/src/index.ts` L102–104 |
| Auto-plugin load | ❌ | — |
| `setConfig` / `applyTunables` générique | ❌ | runner hardcode naive L325–346 |
| Store params par stratégie (JSON bag) | ❌ | colonnes plates `CryptoConfig` |
| Catalogue UI stratégies | ⚠️ | hardcodé 1 entrée `CryptoAlgoSettingsGeneralTab.tsx` |
| 2ᵉ stratégie / builder | 📋 plan | `docs/plans/2026-07-09_SPEC_STRATEGIE_BUILDER.md` |

**Bottom line** : ajouter une stratégie = 1 classe sous `implementations/` + id dans `cryptoAlgoStrategies`. Pour du multi propre : auto-register, `applyTunables` registry-driven, params JSON par stratégie, priorité explicite (first-wins actuel).

---

## 2. Stratégies candidates (détaillées)

> Notation **fit 5 min** = adéquation spécifique au timeframe (pas du day-trading générique).

### S1 — Convergence fin de fenêtre (« certainty capture ») ★★★★★
- **Edge** : le prix converge vers 0/1 quand T→0 ; acheter le leader à 0,87+ récolte (1−p) en < 120 s. Seule zone historiquement profitable ; fees quasi nulles aux extrêmes.
- **Entrée** : `T_left ∈ [30,120] s` ; `mid ≥ 0,87` ; `askVwap ≤ mid+0,02` ; `spread ≤ 0,03` ; **+ filtre marge** `|S_t−K|/(σ̂√T_left) ≥ 2` via flux RTDS.
- **Sortie** : hold to redemption, **pas de SL** ; TP = redemption.
- **Données** : books/ticks dispo ; RTDS nouveau mais gratuit/sans auth ; strike K capturé à l'ouverture.
- **Risque** : reversal final (news spike) — 1 perte = −9 gains à 0,90 → calibration du filtre marge existentielle.
- **Fréquence** : faible-moyenne.

### S9 — Régime time-to-close + veto proximité strike (méta-couche) ★★★★★
- **Edge** : le bon comportement dépend de `T_left` et de la marge, pas d'une bande fixe. Gain le moins cher : **veto entrée près d'un coin flip**.
- **Gates** : `T>150 s` → entrées informationnelles ; `45<T≤150` → scalps taille réduite ; `T≤45` → convergence (S1) ou rien ; **veto** `|z|≤0,5` (ou `mid ∈ [0,45–0,55]` à `T≤60 s`) → jamais.
- **Données** : dispo (`endDate`, `secondsUntilEnd`). Effort **faible**, impact élevé.

### S2 — Fair value oracle-lead (« digital option vs book ») ★★★★★
- **Edge** : le marché est un cash-or-nothing sur `TWAP ≥ K` ; fair `F = Φ(ln(S/K)/(σ√T))` ; le book reprice avec lag vs l'oracle.
- **Entrée** : `z = ln(S/K)/(σ̂√T)`, `F = Φ(z)` ; fire si `bestAsk ≤ F − δ`, `δ = max(0,04, 2×fee+slippage+0,02)` ; `T ≥ 45 s`.
- **Sortie** : exit si `F ≤ F_entry − 0,15` ; TP `bid ≥ F − 0,01` ; à T=35 s déléguer à S1 si `|z|≥2`, sinon sortir.
- **Données** : **flux RTDS requis** ; σ̂ EWMA 1 s.
- **Risque** : concurrence MMs sur le même flux ; σ sous-estimé en news.

### S3 — Imbalance order book / microprice ★★★★☆
- **Edge** : l'imbalance top-of-book prédit le prochain mid (secondes) — corrige la sélection adverse documentée (SL 1–11 s).
- **Entrée** : `I = (bidSize−askSize)/(bid+ask) ≥ 0,35` soutenu ≥ 3 snapshots ≥ 2 s ; microprice `m−mid ≥ 0,01` ; `mid ∈ [0,50–0,75]`.
- **Sortie** : scalp TP +0,03–0,05 ; time stop 30–60 s ; stop si `I ≤ −0,3`.
- **Données** : **en mémoire aujourd'hui** (OrderBook via `connectionManager`) ; il faut juste `bidSize/askSize` dans `StrategyContext`. Backtestable sur ticks existants.
- **Risque** : spoofing, books fins.

### S4 — Fade sweep de liquidité (mean-reversion, confirmé spot) ★★★☆☆
- **Edge** : books fins se disloquent 3–8 pts sur sweep ; réversion en 10–60 s **si le spot ne confirme pas**.
- **Entrée** : `|Δmid(10 s)| ≥ 0,06` **et** RTDS `|ΔS(10 s)| < 0,5·σ̂` ; acheter le côté dumpé.
- **Sortie** : TP à la réversion ; time stop 60–90 s ; SL dur −0,05. Jamais redemption.
- **Données** : flux S2 requis.

### S5 — Fade/Follow fenêtre d'ouverture ★★★★☆
- **Edge** : à t0, K = spot à l'open → fair ≈ 0,50 ; les premiers trades poussent à 0,55–0,65 sans info.
- **Entrée** : `t ∈ [5,60] s` ; fade `mid ≥ 0,57 ∧ |S−K| < 0,3σ√t` → acheter NO ; follow `|S−K| ≥ 1σ√t ∧ mid < F(z)−0,04`.
- **Sortie** : TP 0,50 / `F−0,01` ; time stop 90 s ; jamais redemption.

### S6 — Sum-arb / dislocation complément ★★★★☆
- **Edge** : YES+NO rachètent exactement 1 $ ; si `askVwap_Y + askVwap_N ≤ 1 − fee − 0,005` → profit garanti.
- **Entrée** : scan VWAP deux côtés ; FOK pairé ; gestion leg-risk.
- **Sortie** : redemption (1 $/paire).
- **Note** : nécessite chemin d'ordre pairé dans `algo-entry-pipeline`. Étude de faisabilité gratuite via `priceGap` dans les ticks.

### S7 — Market making passif ★★★☆☆
- **Edge** : quote deux côtés autour du microprice ; inventaire borné par la résolution 5 min.
- **Risque/effort** : adverse selection ; exécuteur **FOK-taker uniquement** aujourd'hui → ordres resting + ledger inventaire + sim passive. **Lift le plus lourd**.

### S8 — Momentum confirmé (« naive-momentum corrigé ») ★★☆☆☆
- **Edge** : garder le squelette bande + confirmation flux/book. **Fix, pas un edge** — valeur comme groupe témoin.
- **Entrée** : `mid ∈ [0,55–0,70] ∧ Δmid(20 s) ≥ 0,04 ∧ ≥3/5 delta1s même signe ∧ I ≥ 0,2`.
- **Sortie** : TP +0,08–0,10 ; trailing activation abaissée ; stop invalidation momentum ; jamais redemption en mid-price.

### S10 — Lead cross-asset (BTC → ETH/SOL) ★★★☆☆
- **Edge** : même horloge 5 min sur actifs corrélés ; BTC saute `z ≥ 1,5` alors que l'autre marché est encore 0,50–0,55.
- **Risque** : corrélation casse sur mouvements idiosyncratiques ; lag minuscule contesté.

### R0 — Baseline config-only : no-SL + hold-to-redemption (contrôle)
- Désactiver SL, réactiver TP +0,10–0,12, sizing ≥ 2× min order. Attendu toujours négatif mais **élimine la jambe SL** et produit des données de calibration propres.

---

## 3. Classement (plausibilité 5 min × effort dans ce codebase)

| Rang | Stratégie | Plausibilité | Effort | Données neuves | Pourquoi ici |
|---|---|---|---|---|---|
| 1 | **S1 convergence + filtre marge** | Haute | Moyen | RTDS | Seule zone profitable ; fee curve + TIME_EXIT + TWAP aident |
| 2 | **S9 régime T + veto strike** | Haute (amélioration) | **Faible** | Non | Gain déployable le moins cher ; veto seul peut changer le signe |
| 3 | **S2 fair value oracle** | Plafond max | Moyen-Haut | RTDS | Le « vrai » edge ; même flux débloque S1/S4/S5 |
| 4 | **S3 OBI / microprice** | Moyenne | **Faible** | Non (context ext.) | Attaque la sélection adverse ; backtestable aujourd'hui |
| 5 | **R0 baseline config** | n/a (contrôle) | Zéro | Non | Stop-bleeding + données de calibration |
| 6 | **S6 sum-arb** | Moyenne (rare, sans risque) | Moyen | Non | Faisabilité gratuite via `priceGap` |
| 7 | **S5 ouverture fade/follow** | Moyenne | Faible-Moyen | Flux (qualité) | Natif 5 min, auction toutes les 5 min |
| 8 | **S4 sweep fade** | Moyenne-Basse | Moyen | Flux requis | Dangereux sans confirmation spot |
| 9 | **S8 momentum confirmé** | Basse | Faible-Moyen | compteur vélocité | Fix, pas edge ; garder comme témoin |
| 10 | **S10 cross-asset** | Basse-Moyenne | Moyen | Non | Lag minuscule contesté |
| 11 | **S7 passive MM** | Edge réel, mauvais timing | **Élevé** | User WS | Nouvel exécuteur ; à revoir après durcissement settlement |

---

## 4. Prérequis quel que soit le choix

1. **Exporter / désactiver la purge 24 h** de `algo_price_ticks` — c'est le dataset de backtest de S1/S3/S5/S6/S9.
2. **Construire le client RTDS/Chainlink** (pattern `price-feed.ts`) + persister strike K à l'open et ticks spot/TWAP.
3. **Logger le mid post-entrée à +1 s / +5 s / +30 s** (mesure de sélection adverse par stratégie).
4. **Étendre `StrategyContext`** avec `bidSize/askSize` + `secondsUntilEnd` (+ spot ensuite).
5. **Overrides par stratégie** de `minTimeToClose` + profil de sortie — S1 ne peut pas exister sous le blocage entrée 150 s actuel.

---

## 5. Recommandation

Séquence pragmatique :
1. **S9 + R0** (config-only, effort faible) → stop-bleeding immédiat.
2. **S3** (context ext. seulement) → mesure de la sélection adverse.
3. **S1** (convergence) dès le flux RTDS en place.
4. **S2** (fair value) comme plafond à moyen terme.

**Canvas** : [strategies-5min-binary-crypto](C:\Users\lcsystem\.cursor\projects\c-Users-lcsystem-Desktop-TradeInterface-Polytwatch-versioning-Polywatch-v1-1\canvases\strategies-5min-binary-crypto.canvas.tsx)
