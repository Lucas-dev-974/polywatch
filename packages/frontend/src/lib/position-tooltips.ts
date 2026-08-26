/** Explanatory tooltips for position list row fields (French UI). */

export const POSITION_TOOLTIPS = {
  trader:
    'Trader copié dont les mouvements ont déclenché l’ouverture de la position',
  outcome: 'Résultat parié sur ce marché (Yes/No ou option choisie)',
  mode: 'Mode d’exécution : simulation (sans ordre réel) ou trading réel',
  liquidity:
    'Liquidité disponible sur le carnet — une liquidité faible complique la clôture',
  bookDegraded:
    'Connexion au carnet d’ordres instable — les prix affichés peuvent être retardés',
  reinforcements:
    'Nombre de renforcements : achats additionnels sur la même position',
  marketTag: 'Catégorie thématique du marché Polymarket',
  marketLink:
    'Marché Polymarket sur lequel la position a été prise — ouvre la fiche dans un nouvel onglet',
  invested:
    'Montant total engagé : prix d’entrée × quantité, frais d’entrée inclus',
  sizing:
    'Quantité de parts détenues et prix moyen d’entrée unitaire',
  entryFees:
    'Frais payés à l’ouverture (ou frais restants sur la quantité courante)',
  openedAt: 'Date et heure d’ouverture de la position',
  closedAt: 'Date et heure de clôture définitive de la position',
  duration: 'Durée totale entre l’ouverture et la clôture',
  marketEndCountdown:
    'Temps restant avant la date de clôture officielle du marché',
  marketResolved:
    'Marché résolu : le résultat gagnant est connu, en attente ou après rédemption',
  marketClosed:
    'Marché fermé : plus de nouvelles transactions, résolution éventuellement en cours',
  subMarketOutcomeKnown:
    'Résultat du sous-marché connu (ex. spread réalisé) — en attente de la résolution officielle Polymarket avant rédemption',
  redemptionInProgress:
    'Rédemption automatique en cours après résolution du marché — aucune action requise',
  pnlOpenAmount:
    'PnL latent si clôture immédiate (mark bid vs prix d’entrée, frais inclus)',
  pnlOpenClosurePercent:
    'Performance latente à la clôture (bid vs prix d’entrée, frais inclus)',
  pnlOpenTriggerPercent:
    'Mouvement du marché — base des déclencheurs SL/TP/trailing (bid vs bid d’entrée)',
  spread: 'Spread top-of-book : écart entre meilleure offre d’achat et de vente',
  lastTrade:
    'Dernier prix exécuté sur le marché — distinct du mark bid utilisé pour le PnL',
  pnlClosedAmount:
    'Gain ou perte réalisé(e) après clôture, frais de trading inclus',
  pnlClosedPercent:
    'Performance en pourcentage par rapport au montant investi',
  closeError:
    'Détail de la dernière tentative de clôture échouée',
  marketMetrics:
    'Afficher les métriques de marché en temps réel (carnet, prix, spread)',
  marketChart:
    'Historique des cours Up/Down enregistrés par l’algo crypto',
  slDistance:
    'Distance restante avant que le Stop Loss ne soit déclenché. Calculée en points de probabilité entre le bid actuel et le seuil SL.',
} as const;

const POSITION_STATUS_TOOLTIPS: Record<string, string> = {
  closing: 'Clôture en cours — ordre de vente soumis ou en attente de confirmation',
  failed: 'Dernière tentative de clôture échouée — action manuelle possible',
  pending: 'Position en attente de traitement (résolution ou rédemption)',
};

const CLOSE_REASON_TOOLTIPS: Record<string, string> = {
  COPY_CLOSE:
    'Clôturée parce que le trader copié a entièrement vendu sa position',
  COPY_DECREASE:
    'Réduite partiellement suite à une vente du trader copié',
  SL: 'Stop loss déclenché — seuil de perte atteint',
  TP: 'Take profit déclenché — objectif de gain atteint',
  TRAILING: 'Trailing stop déclenché — gain protégé après un pic',
  PRE_CLOSE_LOSS:
    'Clôture anticipée pour limiter une perte avant la résolution du marché',
  PRE_CLOSE_WIN:
    'Clôture anticipée pour sécuriser un gain avant la résolution du marché',
  WEATHER_FORECAST_CHANGE:
    'Fermée parce que le forecast a dérivé au-delà du seuil',
  WEATHER_BUCKET_EXIT:
    'Fermée parce que le forecast a quitté le palier de la position',
  MANUAL: 'Clôture manuelle demandée par l’utilisateur',
  REDEMPTION:
    'Position réglée via rédemption après résolution du marché',
};

export function positionStatusTooltip(status: string): string | undefined {
  return POSITION_STATUS_TOOLTIPS[status];
}

export function closeReasonTooltip(
  reason: string | null | undefined,
): string | undefined {
  if (!reason) return undefined;
  return CLOSE_REASON_TOOLTIPS[reason] ?? `Motif de clôture : ${reason}`;
}

export function traderTooltip(address: string | null | undefined): string {
  if (address) {
    return `${POSITION_TOOLTIPS.trader} (${address})`;
  }
  return POSITION_TOOLTIPS.trader;
}

export function marketEndTooltip(endDate: string | null): string {
  if (!endDate) return POSITION_TOOLTIPS.marketEndCountdown;
  return `${POSITION_TOOLTIPS.marketEndCountdown} — échéance ${endDate}`;
}

export function reinforcementsTooltip(count: number): string {
  return `${POSITION_TOOLTIPS.reinforcements} (${count})`;
}
