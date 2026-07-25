# Spec & Plan — Stratégie builder (Crypto Algo)

**Date** : 2026-07-09  
**Statut** : décisions produit partiellement figées (2026-07-09)  
**Périmètre** : nouvelle section « Stratégie builder » sur la page Crypto Algo

---

## 0. Décisions produit figées

| # | Question | Décision |
|---|----------|----------|
| 1 | Naming | **Stratégie builder** |
| 2 | Activation | **Une seule stratégie active à la fois** ; changement d’active depuis l’UI (liste / chip dashboard) |
| 3 | Rail sorties | **Hybride V1** : rail éditable avec overrides optionnels ; champs vides = inherit des onglets Sortie / Sortie forcée (defaults globaux). C’est le modèle le plus aligné sur RiskConfig actuel sans forcer à tout re-saisir. |
| 4 | Qui publie / active | **Operator et admin** (les deux rôles auth existants) |
| 5 | Gate sim → réel | **Option A — Soft** : avertissement contournable (« peu / pas de tests sim ») ; activation réel possible quand même |

---

## 1. Verdict produit

Construire un **pipeline linéaire à 3 rails** (Filtres → Entrée → Sorties), éditable en blocs visuels, qui compile vers un **DSL JSON fermé** exécuté par une **VM déterministe** dans `@polywatch/crypto-algo`.

| Décision | Choix | Pourquoi |
|----------|-------|----------|
| Naming | Stratégie builder | Décision produit 2026-07-09 |
| Activation | 1 seule active ; switch UI | Évite doubles entrées ; changement explicite |
| Rail sorties | Overrides optionnels + inherit | Aligné RiskConfig ; pas de re-saisie forcée |
| Publish / activate | Operator + admin | Décision produit 2026-07-09 |
| Gate sim → réel | Soft warning (A) | Avertissement contournable ; pas de blocage |
| Métaphore UI | Pipeline / stack de blocs (pas node-graph) | Aligné traders + architecture actuelle ; mobile/desktop OK |
| Stack frontend | SolidJS custom (pas React Flow / Blockly) | Frontend = Solid ; libs flow = friction inutile en V1 |
| Runtime | DSL JSON → plan compilé → interpréteur | Pas de code arbitraire ; hot-path WS sûr |
| Sorties | Profil déclaratif (pas de blocs « close » live) | Réutilise le worker SL/TP/pre-close/TIME_EXIT |
| V1 expressivité | Recréer + paramétrer `naive-momentum` | Parité prouvable avant ouverture du catalogue |

---

## 2. Contexte actuel (ancrage code)

- Page : `CryptoAlgoPage` (SolidJS), config via dialog 4 onglets (Général / Sortie / Sortie forcée / Suivi auto).
- Stratégies : checkboxes hardcodées (`naive-momentum` seul) → `RiskConfig.cryptoAlgoStrategies`.
- Contrat runtime : `CryptoAlgoStrategy.evaluate(market, ctx) → AlgoSignal | null`.
- Entrée : `runAlgoEntryPipeline` → Redis `order-signals`.
- Sorties : worker partagé (`resolveAlgoEntryExitParams`, bid points, trailing, pre-close, TIME_EXIT).
- Aucun builder / DnD / flow editor dans le frontend aujourd’hui.

---

## 3. Objectifs utilisateur

1. Composer une logique d’entrée sans écrire de TypeScript.
2. Voir clairement le filet de sortie (SL/TP/trailing/pre-close/TIME_EXIT) dans le récit de la stratégie.
3. Comprendre la stratégie en 5 secondes (phrase naturelle + rails).
4. Dupliquer / varier un template (ex. seuil plus strict sur 5m).
5. Valider en sim (dry-run) avant activation réelle.

**Hors scope V1** : langage Turing-complet, sorties custom évaluées sur chaque tick WS, multi-stratégies concurrentes sur le même marché.

---

## 4. Information architecture

### Emplacement

Nouvel onglet dans `CryptoAlgoSettingsDialog` (2ᵉ position) :

| Onglet | Rôle |
|--------|------|
| Général | Kill-switch, cleanup ticks *(retirer les checkboxes stratégies brutes)* |
| **Stratégie builder** | Liste + éditeur de stratégies |
| Sortie | Defaults globaux / fallback |
| Sortie forcée | Defaults globaux / fallback |
| Suivi auto | Inchangé |

Sur le dashboard : chip « Stratégie active : … » → ouvre l’onglet builder.

### Layout éditeur (résumé)

```
[ Liste des stratégies ]
  - Naive Momentum (système)     [Utiliser] [Actif]
  - Ma strat 5m                  [Éditer] [Sim] [Activer]
  - + Nouvelle

[ Éditeur ]
  Header : nom | statut | phrase naturelle | Activer
  Corps  : palette | 3 rails | panneau params
  Footer : validation | Enregistrer version
```

---

## 4bis. Maquette UI (wireframes)

Tokens : fond `--bg` `#09090b`, surface `#18181b`, accent `#3b82f6`, texte zinc. Dialog settings existant élargi en mode builder (~960–1100 px). Classes prévues : `.sb-*` sur le design system actuel (`panel`, `btn`, `form-*`).

### A. Dashboard Crypto Algo — chip stratégie active

```
┌─ Crypto Algo ──────────────────────────────────────────────┐
│  ● En ligne   Sim uniquement          [⛶] [🔔] [Configurer]│
│                                                            │
│  Stratégie active : Naive Momentum  [Changer ▾]            │
│  └─ clic → ouvre Configurer > onglet Stratégie builder     │
│                                                            │
│  [ Capital sim/real … ]                                    │
│  [ Live markets … ]                                        │
└────────────────────────────────────────────────────────────┘
```

### B. Dialog Configurer — onglets (builder = 2ᵉ)

```
┌─ Configurer crypto-algo ──────────────────────────── [✕] ─┐
│  [Général] [Stratégie builder] [Sortie] [Sortie forcée]   │
│            └─ actif                [Suivi auto]            │
│  ─────────────────────────────────────────────────────────│
│  … contenu onglet …                                        │
│                                      [Annuler] [Enregistrer]│
└────────────────────────────────────────────────────────────┘
```

### C. Vue liste (onglet Stratégie builder, aucune édition ouverte)

```
┌─ Stratégie builder ───────────────────────────────────────┐
│  Stratégies                          [+ Nouvelle stratégie]│
│                                                            │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ ★ Naive Momentum          système · v1              │  │
│  │   Momentum YES/NO ~0.55, spread-ajusté              │  │
│  │   ● ACTIVE                                          │  │
│  │              [Dupliquer]  [Éditer]  [Désactiver]     │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Ma strat 5m stricte       brouillon · v2            │  │
│  │   Seuil 0.60 · 5m only · SL 0.08                    │  │
│  │              [Dupliquer]  [Éditer]  [Activer]        │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Fade expérimental         publiée · v1              │  │
│  │   Contrarian haut/bas                               │  │
│  │              [Dupliquer]  [Éditer]  [Activer]        │  │
│  └─────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

**États badge** : `ACTIVE` (accent), `brouillon` (neutre), `publiée` (info), `archivée` (muted).

**[+ Nouvelle]** → modal courte : nom + template (`Naive Momentum` recommandé / `Vide` avancé).

### D. Vue éditeur (stratégie sélectionnée)

Layout 3 colonnes dans le corps du dialog (ou plein largeur sous la liste) :

```
┌─ Éditeur : Ma strat 5m stricte ──────── brouillon · dirty ─┐
│  [nom________________]  ● Valide                           │
│                                                            │
│  « Sur les Up/Down 5m, si spread ≤6 %, achète YES au-dessus│
│    de 0.60 ou NO en miroir. Sorties : SL 0.08 / TP 0.10. » │
│                                                            │
│  [Dry-run]  [Publier v3]  [Activer en sim]  [Activer réel] │
├──────────┬──────────────────────────────┬──────────────────┤
│ PALETTE  │  PIPELINE (3 rails)          │  INSPECTOR       │
│          │                              │                  │
│ Filtres  │  ┌─ FILTRES ──────────────┐  │  Bloc sélectionné│
│  □ Spread│  │ ⠿ Spread max    6%  [×]│  │  ───────────────│
│  □ Source│  │ ⠿ Source prix   auto[×]│  │  Spread max (%) │
│  □ Interv│  │ 🔒 YES+NO ≈ 1   sys    │  │  [ 6.0      ]   │
│          │  └────────────────────────┘  │                  │
│ Entrée   │           ↓                  │  Mode            │
│  □ Seuil │  ┌─ ENTRÉE ───────────────┐  │  (•) Fixe        │
│  □ Adj sp│  │ ⠿ Seuil base   0.60 [×]│  │  ( ) Par interv. │
│  □ BUY Y │  │ ⠿ Adj. spread  off [×]│  │                  │
│  □ BUY N │  │ → BUY YES si > seuil   │  │  [Supprimer bloc]│
│          │  │ → BUY NO  si < 1−seuil │  │                  │
│ Sorties  │  └────────────────────────┘  │                  │
│  □ SL    │           ↓                  │                  │
│  □ TP    │  ┌─ SORTIES (parallèles) ─┐  │                  │
│  □ Trail │  │ ⠿ SL bid     0.08  [×]│  │                  │
│  □ PreCl │  │ ⠿ TP bid     0.10  [×]│  │                  │
│  □ TimeX │  │ ○ Trailing   inherit   │  │                  │
│          │  │ ○ Pre-close  inherit   │  │                  │
│          │  │ ⠿ Time exit  90s   [×]│  │                  │
│          │  └────────────────────────┘  │                  │
├──────────┴──────────────────────────────┴──────────────────┤
│  ✓ 3 rails OK   ⚠ Pas d’ajustement spread (warning)        │
│  [Enregistrer brouillon]                    dernière: 08:04│
└────────────────────────────────────────────────────────────┘
```

Légende interactions :
- `⠿` = poignée drag (reorder dans le rail)
- `🔒` = bloc système non supprimable
- `○ inherit` = champ vide → defaults onglets Sortie / Sortie forcée
- Clic bloc → highlight + inspector à droite
- Drag palette → insert dans le rail compatible (filtre ne va pas dans Sorties)

### E. Modal « Activer en réel » (gate soft — option A)

```
┌─ Activer en réel ? ───────────────────────┐
│                                            │
│  « Ma strat 5m stricte » remplacera        │
│  « Naive Momentum » comme stratégie active.│
│                                            │
│  ⚠ Peu ou pas de tests en simulation       │
│    détectés pour cette version.            │
│                                            │
│  Les positions déjà ouvertes gardent leurs │
│  sorties worker actuelles.                 │
│                                            │
│         [Annuler]  [Activer quand même]    │
└────────────────────────────────────────────┘
```

### F. Panneau Dry-run (drawer / section sous l’éditeur)

```
┌─ Dry-run — marchés suivis (maintenant) ─────────────┐
│  BTC 5m Up/Down   YES 0.62  → SIGNAL BUY YES  0.74  │
│    reasons: YES above 0.60 · spread 2.1% · ws       │
│  ETH 5m Up/Down   YES 0.51  → abstention (zone morte)│
│  SOL 15m          — skip (intervalle non autorisé)  │
│                              [Relancer] [Fermer]    │
└─────────────────────────────────────────────────────┘
```

### G. Création depuis template

```
┌─ Nouvelle stratégie ──────────────────────┐
│  Nom  [________________________]          │
│                                            │
│  Partir de                                 │
│  (•) Naive Momentum   (recommandé)         │
│  ( ) Vide (avancé)                         │
│                                            │
│              [Annuler]  [Créer brouillon]  │
└────────────────────────────────────────────┘
```

### H. Responsive / mobile (V1 assumé desktop)

| Viewport | Comportement |
|----------|--------------|
| ≥ 1024 px | 3 colonnes (palette \| pipeline \| inspector) |
| 768–1023 | Pipeline plein largeur ; palette en tabs ; inspector en sheet |
| &lt; 768 | Liste + édition séquentielle ; reorder via boutons ↑↓ (pas de DnD) |

### I. Mapping composants Solid (cible)

| Zone maquette | Composant |
|---------------|-----------|
| Chip dashboard | `CryptoAlgoHeader` + lien settings tab |
| Onglet | `CryptoAlgoSettingsStrategyBuilderTab` |
| Liste | `StrategyList` / `StrategyListItem` |
| Éditeur shell | `StrategyBuilderEditor` |
| Palette | `StrategyPalette` |
| Rails | `StrategyPipeline` + `StrategyRail` + `StrategyBlockCard` |
| Inspector | `StrategyBlockInspector` (réutilise `settings-fields`) |
| Phrase | `StrategyNaturalLanguageSummary` |
| Dry-run | `StrategyDryRunPanel` |
| Modals | `Dialog` existant |

---

## 5. Métaphore & UX des 3 rails

```
[ Marché éligible ]
        ↓
   RAIL 1 — FILTRES     (tous doivent passer)
        ↓
   RAIL 2 — ENTRÉE      (conditions → BUY YES / BUY NO)
        ↓
   RAIL 3 — SORTIES     (filets parallèles → profil déclaratif)
```

- Drag depuis palette latérale ; reorder dans le rail.
- Clic bloc → inspector (params), pas de modal empilée.
- Phrase naturelle toujours visible en header.
- Autosave brouillon ; « Publier version » explicite.
- **Une seule stratégie custom active à la fois en V1** (évite doubles entrées).

### Flux

| Flux | Comportement |
|------|--------------|
| Créer | Template d’abord (Naive Momentum), pas canvas vide |
| Éditer | Draft ; stratégie active figée jusqu’à « Remplacer » |
| Valider | Live (vert/ambre/rouge) + checklist |
| Activer | Sim d’abord ; réel = 2ᵉ confirmation |
| Simuler V1 | Dry-run sur marchés suivis → signaux fictifs + `reasons[]` |
| Dupliquer | Suffixe « (copie) » → brouillon |

### Guardrails UI

| Règle | Niveau |
|-------|--------|
| Aucune sortie dure (ni SL ni TIME_EXIT) | Bloquant |
| Entrée sans filtre spread | Warning |
| Seuil &lt; 0.50 | Warning |
| Seuil YES/NO qui se croisent (toujours un signal) | Bloquant |
| Paramètres hors bornes | Clamp + message |
| Blocs système (validation prix, anti re-entrée) | Non supprimables |

---

## 6. Catalogue de blocs V1

### Must-have (recréer `naive-momentum`)

**Périmètre**
- Intervalles (multi-select 5m…1d)

**Filtres**
- Spread max (fixe ou « selon intervalle »)
- Source de prix (auto WS/Gamma, écart max %)
- Prix YES+NO ≈ 1 *(système)*

**Entrée**
- Seuil momentum YES / miroir NO
- Ajustement dynamique au spread (`seuil += spread% × facteur`)
- Groupe ET
- Actions : Acheter YES / Acheter NO

**Sorties** (profil déclaratif, merge RiskConfig)
- SL / TP bid points
- Trailing + activation
- Pre-close
- Time exit
- Min time-to-close

**Timing**
- Anti re-entrée (exposé, éventuellement lecture seule V1)

### Plus tard

Momentum N ticks, profondeur book, branches OU, sizing par confiance, replay historique `algo_price_ticks`, multi-stratégies avec priorité.

---

## 7. Architecture technique

### Principe

```
Editor (Solid pipeline)
  → StrategyDocument (JSON DSL)
  → validate() → compile() → CompiledStrategyPlan
  → persist (draft / published)
  → DynamicStrategyLoader → StrategyRegistry
  → StrategyRunner → StrategyVm → AlgoSignal | null
  → runAlgoEntryPipeline (+ exitProfile merge)
  → worker exits (inchangé)
```

### Package nouveau : `@polywatch/strategy-dsl`

- Types DSL (`StrategyDocument`, nodes, `StrategyExitProfile`)
- Zod schema + validator (DAG/ports/budgets)
- Compiler → plan registre (bytecode maison)
- VM pure synchrone (pas d’I/O, pas d’`eval`)
- Template golden `naive-momentum`
- Tests de parité vs `NaiveMomentumStrategy` TS

### Persistance

```
algo_strategies          (id, name, status, published_version, …)
algo_strategy_versions   (strategy_id, version, state, document JSONB,
                          compiled_plan JSONB, content_hash, validation)
```

Cycle : `draft → validate → compile → publish` → Redis `crypto-algo:strategies:changed` → reload registry.

IDs runtime : `naive-momentum` (builtin) | `user:<uuid>@v<n>`.

### Sorties

Le graphe **ne décide pas** de sortir.  
`StrategyExitProfile` est mergeable :

```
defaults intervalle ← RiskConfig cryptoAlgo* ← exitProfile stratégie
```

### API (préfixe `/api/algo/strategies`)

| Méthode | Path | Rôle |
|---------|------|------|
| GET/POST | `/` | Liste / créer |
| GET/PATCH | `/:id` | Détail / meta |
| PUT | `/:id/draft` | Upsert draft |
| POST | `/:id/validate` | Valider |
| POST | `/:id/compile` | Preview plan |
| POST | `/:id/publish` | Publier + notify |
| POST | `/:id/unpublish` | Retirer |
| POST | `/:id/dry-run` | Eval fixture / marché |
| GET | `/catalog/blocks` | Métadonnées UI |
| GET/POST | `/templates`, `/from-template` | Templates |

Activation trading : inchangée via `cryptoAlgoStrategies` dans RiskConfig.

### Sécurité

- Whitelist fermée de `kind` / opcodes
- Budgets : ≤ 80 nodes, ≤ 200 ops, profondeur ≤ 32
- Compile côté serveur ; `compiled_plan` serveur fait foi
- Re-validation au load Redis
- Pas de `vm2` / WASM utilisateur

### Frontend (Solid)

```
StrategyBuilderTab
├── StrategyList
├── StrategyBuilderHeader
├── StrategyPalette
├── StrategyPipeline (3 rails)
│   └── StrategyBlockCard
├── StrategyBlockInspector   // réutilise settings-fields
├── StrategyValidationBar
└── StrategyPreviewPanel     // dry-run + timeline
```

State : `strategyBuilderStore` (draft, dirty, autosave localStorage).  
CSS : préfixe `.sb-*` sur tokens existants.

---

## 8. Exemple : template Naive Momentum

```
PÉRIMÈTRE  Intervalles : ceux auto-trackés
FILTRES    Spread max selon intervalle ; source prix auto ; YES+NO≈1
ENTRÉE     Seuil 0.55 + facteur spread 0.5
           → prix > seuil → BUY YES
           → prix < 1−seuil → BUY NO
SORTIES    inherit RiskConfig / defaults intervalle
```

Phrase UI :  
*« Sur les Up/Down crypto, si le spread est acceptable, achète YES au-dessus de ~0.55 (ajusté au spread) ou NO en miroir. Sorties : SL/TP/trailing + filets de fin de marché. »*

---

## 9. Plan d’implémentation

### Phase 0 — Spec figée & squelette (3–5 j)

- [ ] Valider décisions produit (1 strat active, sorties déclaratives, pipeline)
- [ ] Créer `packages/strategy-dsl` (types + zod + stub validate/compile/vm)
- [ ] Migration SQL `algo_strategies` + `algo_strategy_versions`
- [ ] Doc figée (ce fichier) + ADR court

### Phase 1 — MVP éditeur + dry-run (2–3 sprints)

**But** : éditer naive-momentum en blocs, valider, dry-run ; runtime TS inchangé.

- [ ] Template DSL golden + tests parité fixtures
- [ ] API CRUD draft + validate + dry-run + catalog
- [ ] UI : onglet Builder, liste, 3 rails, inspector, phrase naturelle
- [ ] Validation live + IR JSON debug
- [ ] Retirer checkboxes stratégies du tab Général (remplacées par builder)

### Phase 2 — Publish → trading (2–4 sprints)

- [ ] `DynamicStrategyLoader` + Redis notify
- [ ] `StrategyRegistry.replace/unregister`
- [ ] Merge `exitProfile` dans `algo-entry-pipeline` / `crypto-algo-exit`
- [ ] Publish / unpublish / activer via `cryptoAlgoStrategies`
- [ ] E2E : publish DSL → signal → position
- [ ] Chip « stratégie active » sur dashboard

### Phase 3 — Preview & polish (1–2 sprints)

- [ ] Preview sur marché sample + timeline signaux
- [ ] Overlay chart (réutiliser charts existants)
- [ ] Templates additionnels (momentum strict 5m, fade expérimental)
- [ ] A11y clavier, mode mobile liste (↑↓)

### Phase 4 — Backlog V2

- Branches OU, blocs avancés (N ticks, book depth)
- Replay historique `algo_price_ticks`
- Shadow mode (log sans ordre)
- Diff versions / rollback one-click
- Toujours pas d’exit graphique sur hot-path WS

---

## 10. Touchpoints code (résumé)

| Zone | Fichiers / packages |
|------|---------------------|
| DSL | `packages/strategy-dsl/` (nouveau) |
| Runtime | `packages/crypto-algo/src/strategy/*`, `index.ts`, `algo-entry-pipeline.ts` |
| Core | entités + migration, `crypto-algo-exit.ts`, risk helpers |
| Backend | `packages/backend/src/routes/algo-strategies.ts` |
| Frontend | `CryptoAlgoSettingsDialog`, nouveaux `StrategyBuilder*`, store |
| Tests | unit DSL parité, e2e crypto-algo |
| Docs | ce plan + `docs/crypto-algo.md` (MAJ à la livraison) |

---

## 11. Risques & mitigations

| Risque | Mitigation |
|--------|------------|
| Dérive parité TS vs DSL | Tests golden obligatoires avant bascule runtime |
| Scope creep (DAG / scripting) | Catalogue fermé ; templates d’abord |
| Preview ≠ prod | Label « dry-run entrée » ; même VM que le runner |
| Faux sentiment de sécurité UI | Validations bloquantes, ton sérieux, pas de gamification |
| Doubles entrées multi-strat | 1 active V1 ; re-entry guard inchangé |
| Confusion sorties | Copy claire : graphe = entrée ; rail 3 = profil worker |

---

## 12. Questions ouvertes

Toutes tranchées (voir §0). Aucune question produit bloquante avant Phase 0.

---

## 13. Synthèse en une phrase

Le Stratégie builder est un **atelier de pipelines à blocs** qui rend `naive-momentum` compréhensible, paramétrable et duplicable, compile vers un DSL sandboxé branché sur le runner existant, et laisse les sorties au worker via un profil déclaratif — sans node-graph ni code utilisateur.
