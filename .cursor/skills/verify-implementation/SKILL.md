---
name: verify-implementation
description: Vérifie qu'une implémentation réalisée dans la conversation est correcte, n'introduit pas de bug ou bug fantôme (régression silencieuse, edge case non géré, état incohérent), et identifie les besoins de refactor. Utiliser après qu'un patch ou une feature a été codé dans la session courante, quand l'utilisateur demande de valider, relire, auditer, ou vérifier l'absence de bug dans le code qui vient d'être écrit.
---

# Vérification d'implémentation

Vérifie le code qui vient d'être implémenté dans la conversation courante. L'objectif est de détecter les bugs réels ET les bugs fantômes (défaillances silencieuses qui ne se manifestent qu'en régime perturbé ou à l'échelle), puis d'évaluer la qualité structurale.

## Instructions

### 1. Recenser les fichiers modifiés

Identifie tous les fichiers touchés pendant la conversation. Pour chacun, lis la version **actuelle** du fichier sur disque (pas la version supposée en mémoire). Utilise `git diff` si un repo git est présent pour confirmer le périmètre exact :

```bash
git diff --name-only HEAD   # fichiers modifiés depuis le dernier commit
git diff --stat             # aperçu volumétrique
git status                  # fichiers non suivis / nouveaux
```

Si aucun repo git, utilise la conversation pour reconstruire la liste des fichiers modifiés et lis chacun.

### 2. Vérification de compilation / type

Avant toute analyse logique, confirme que le code compile.

- TypeScript : lance le build du workspace concerné (ex: `npm run build -w packages/core`, `npm run build -w packages/worker`). N'analyse pas plus loin tant qu'il y a des erreurs de type — corrige-les d'abord.
- Si le projet a un linter configuré (ESLint, Biome), lance-le sur les fichiers modifiés.
- Utilise l'outil `ReadLints` sur les fichiers modifiés pour récupérer les diagnostics de l'IDE.

### 3. Audit de correction (bugs réels)

Pour chaque fichier modifié, vérifie :

- **Logique métier** : les branches conditionnelles couvrent-elles tous les cas ? Les gardes (`if/return`) sont-ils dans le bon ordre ?
- **Edge cases** : entrées nulles/vides, collections vides, boundary values (off-by-one), dépassement de capacité, NaN/Infinity.
- **États incohérents** : un état interne (flag, map, cache, compteur) peut-il devenir désynchronisé avec la source de vérité ? Notamment après une erreur ou un timeout.
- **Doublons / double-resolve / double-effect** : une promesse peut-elle être résolue deux fois ? Un effet de bord peut-il s'exécuter deux fois (handler appelé en boucle, event émis en double) ?
- **Gestion d'erreur avalée** : `catch` qui logge et continue sans rollback ni retry → perte silencieuse de données ou état corrompu.
- **Fuites** : timers non nettoyés, listeners non retirés, connexions non fermées, promesses en attente non résolues.
- **Concurrence / races** : deux chemins asynchrones peuvent-ils écrire le même état simultanément ? Un guard `running`/`settled` est-il correctement positionné ?
- **Comportement nominal préservé** : le chemin heureux (sans erreur) fonctionne-t-il **exactement comme avant** le patch ? Le patch ne doit pas changer la sémantique en régime nominal.

### 4. Audit des bugs fantômes

Un bug fantôme est une défaillance qui ne se manifeste qu'en régime perturbé (panne externe, latence, charge, shutdown, reconnect). Vérifie spécifiquement :

- **Que se passe-t-il si une dépendance externe tombe ?** (WS, DB, API, Redis). Y a-t-il un timeout ? Un fallback ? Une reprise ? Ou un blocage indéfini ?
- **Que se passe-t-il à l'arrêt (graceful shutdown) ?** Les buffers en attente sont-ils flushés ? Les timers nettoyés ?
- **Que se passe-t-il sous charge ?** N+1 requêtes, fan-out non borné, explosion de rows en base, memory leak sur une Map sans eviction.
- **Que se passe-t-il après une reconnexion ?** L'état en mémoire est-il invalidé / re-sync depuis la source de vérité, ou reste-t-il stale ?
- **Les erreurs sont-elles remontées à l'utilisateur ?** Ou avalées en `log.warn` sans signal côté UI/API ?

### 5. Audit de refactor

Évalue la qualité structurale du code implémenté, indépendamment des bugs :

- **Responsabilité unique** : une fonction/classe fait-elle trop de choses ? Faut-il extraire une sous-fonction ?
- **Duplication** : la logique nouvelle duplique-t-elle une logique existante ailleurs qu'il faudrait mutualiser ?
- **Nommage** : les noms (variables, fonctions, fichiers) reflètent-ils l'intention ? Un nom trompeur est un bug futur.
- **Complexité cognitive** : une fonction trop longue ou trop imbriquée doit-elle être découpée ?
- **Couplage** : le patch introduit-il une dépendance indésirable entre modules qui devraient rester découplés ?
- **Cohérence avec le style du codebase** : conventions de nommage, patterns d'erreur, structure de fichier, imports. Le nouveau code respecte-t-il les conventions voisines ?
- **Testabilité** : le code est-il testable facilement ? Faut-il ajouter un test pour le nouveau comportement ?

Un refactor n'est à faire **que s'il apporte une valeur réelle**. Ne propose pas du cosmétique. Signale clairement la différence entre "refactor nécessaire" (impact maintenance/lisibilité/correctness) et "refactor optionnel" (préférence stylistique).

### 6. Synthèse

Produis un rapport structuré en français avec :

```markdown
## Compilation / types
[statut : OK / erreurs à corriger]

## Bugs réels détectés
- [Bug] Fichier:ligne — description — impact — suggestion
- (ou "Aucun")

## Bugs fantômes détectés
- [Bug fantôme] Fichier:ligne — scénario déclencheur — conséquence — suggestion
- (ou "Aucun")

## Refactor
- [Nécessaire] Fichier — description — pourquoi
- [Optionnel] Fichier — description
- (ou "Rien à refactorer")

## Verdict
[Résumé en 1-2 phrases : implémentation correcte ? régression introduite ? prêt à merger ?]
```

## Règles

- **Lis le code réel sur disque**, ne te fie pas à ta mémoire de ce qui a été écrit — le fichier peut avoir été corrompu par un échec d'édition (backslash échappé, encoding, édition partielle).
- **Sois critique et honnête**. Ne valide pas pour faire plaisir. Un bug non signalé est une régression en production.
- **Ne modifie aucun fichier pendant l'audit**. L'audit est en lecture seule. Signale les corrections à faire ; l'utilisateur décidera.
- **Cite les lignes**. Chaque constatation doit pointer vers `fichier:ligne` précis.
- **Distingue bug réel / bug fantôme / refactor**. Ne mélange pas les catégories.
- **Vérifie le régime nominal en priorité**. Un patch qui casse le chemin heureux est inacceptable même s'il corrige un edge case.