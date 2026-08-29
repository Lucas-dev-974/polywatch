/**
 * Minimum order size in shares enforced by the Polymarket CLOB.
 *
 * Kept in @polywatch/core so sizing logic can reject sub-minimum targets
 * before a reservation is created, avoiding a round-trip through the
 * executor that would fail with `below_min_order_size`.
 */
export const MIN_ORDER_SHARES = 1;

/** Minimum collateral (pUSD) for a reliable live FAK entry on Polymarket. */
export const MIN_ORDER_PUSD = 1;
