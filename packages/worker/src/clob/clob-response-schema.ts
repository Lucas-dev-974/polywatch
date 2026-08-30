import { z } from 'zod';

/**
 * Zod schema for Polymarket CLOB POST /order response.
 * Validates the raw response before parsing fill data.
 */
export const clobOrderResponseSchema = z.object({
  id: z.string().optional(),
  orderID: z.string().optional(),
  status: z.union([z.string(), z.number()]).optional(),
  takingAmount: z.string().optional(),
  makingAmount: z.string().optional(),
  success: z.boolean().optional(),
  errorMsg: z.string().optional(),
  // The CLOB client converts non-2xx responses to `{ error, status }`. `error`
  // may be a string OR the raw JSON body (when the body has no `error` key), so
  // it must stay `unknown` — a `z.string()` would reject the whole response and
  // lose the diagnostic.
  error: z.unknown().optional(),
});

export type ClobOrderResponse = z.infer<typeof clobOrderResponseSchema>;