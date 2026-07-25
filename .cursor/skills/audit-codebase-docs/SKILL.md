---
name: audit-codebase-docs
description: Audite la synchronisation entre la codebase et la documentation technique. Détecte les obsolescences (doc qui ment), les lacunes (code non documenté) et les divergences via une approche hybride en double passage.
---

# Audit de Synchronisation Code ↔ Documentation

Ce skill permet de mener un audit rigoureux pour s'assurer que la documentation technique reflète exactement la réalité du code et inversement.

## Instructions de l'Audit

L'audit doit impérativement être mené en quatre étapes séquentielles pour chaque module. **Ne saute aucune étape.**

### Étape 0 : Mise en contexte (Le Setup)
Le but est de définir le cadre de rigueur.
1. Définir le rôle : Expert Auditeur Logiciel et Rédacteur Technique.
2. Imposer les **Règles d'Or** :
    - **Zéro Supposition** : Pas de conclusion sans preuve directe.
    - **Preuves Systématiques** : Citation obligatoire du fichier et de la ligne pour le code (`fichier.ts:ligne X`) et de la section pour la doc (`fichier.md:Section`).
    - **Rigueur Terminologique** : Signaler tout décalage de vocabulaire entre doc et code.
3. Valider la réception des fichiers de documentation et du code source du module concerné.

### Étape 1 : Passage Doc $\rightarrow$ Code (La Promesse)
**Objectif : Vérifier que tout ce qui est écrit est vrai.**
1. Extraire chaque "promesse technique" (règle, comportement, contrainte) de la documentation.
2. Chercher la preuve d'implémentation dans le code.
3. Produire un tableau de confrontation :
    - `| Élément Doc (Citation) | Preuve Code (Ligne) | Statut (✅ Conforme / ⚠️ Divergent / ❌ Obsolète) | Observation |`

### Étape 2 : Passage Code $\rightarrow$ Doc (L'Exhaustivité)
**Objectif : Vérifier que tout ce qui est codé est expliqué.**
1. Analyser le code source pour identifier les logiques métier, fonctions clés et configurations.
2. Vérifier si chaque élément logique majeur possède une explication dans la doc.
3. Lister les **lacunes** :
    - **Lacune #[N] : [Nom de la logique]**
    - Preuve Code : `fichier.ts:ligne X`
    - Description : (Ce que le code fait réellement)
    - État Doc : (Absente / Trop vague / Incomplète)

### Étape 3 : Synthèse et Plan d'Action (L'Alignement)
**Objectif : Transformer l'audit en backlog de corrections.**
Produire un rapport final classé par priorité :
1. **🔴 Priorité Critique (Incohérences majeures)** : La doc contredit le code. $\rightarrow$ *Action : Corriger la doc.*
2. **🟡 Priorité Majeure (Lacunes importantes)** : Fonctionnalités clés non documentées. $\rightarrow$ *Action : Rédiger la doc.*
3. **🟢 Priorité Mineure (Divergences de forme)** : Terminologie, fautes, imprécisions. $\rightarrow$ *Action : Nettoyage sémantique.*

Pour chaque point, préciser si la correction impacte le **CODE** ou la **DOCUMENTATION**.

## Règles de sortie
- Ne jamais valider une fonctionnalité sans avoir cité la ligne de code.
- Si le module est trop volumineux, demander à l'utilisateur de le découper en sous-modules pour éviter la perte de contexte.
