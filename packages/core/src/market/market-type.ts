/**
 * Types de marchés supportés par Polywatch.
 * Chaque type définit un comportement spécifique pour le sync, l'affichage, et le trading.
 * Stocké dans la colonne `market_type` de l'entité Market.
 */
export enum MarketType {
  /** Marché binaire standard Polymarket (sports, politique, météo, etc.) */
  STANDARD = 'standard',
  /** Marché crypto Up/Down à court terme (Bitcoin 5min, Ethereum 1h, etc.) */
  CRYPTO_UP_DOWN = 'crypto_up_down',
  /** Marché crypto "Above/Below" (ex: "Ethereum above $4000?") */
  CRYPTO_ABOVE_BELOW = 'crypto_above_below',
  /** Marché crypto "Target Price" (ex: "What price will Bitcoin hit?") */
  CRYPTO_TARGET_PRICE = 'crypto_target_price',
  /** Marché crypto "Price Range" */
  CRYPTO_PRICE_RANGE = 'crypto_price_range',
  /** Marché crypto non classifié */
  CRYPTO_OTHER = 'crypto_other',
  WEATHER_TEMPERATURE = 'weather_temperature',
  WEATHER_OTHER = 'weather_other',
}
