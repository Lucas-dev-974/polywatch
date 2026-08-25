/**
 * Fallback du ridge plot des marchés parcourus : message de chargement tant
 * que le run produit des données, sinon « aucun marché ».
 */
export function BacktestMarketsFallback(props: { busy: boolean }) {
  return (
    <p class="form-hint">
      {props.busy ? 'Chargement des marchés…' : 'Aucun marché parcouru sur cette plage.'}
    </p>
  );
}
