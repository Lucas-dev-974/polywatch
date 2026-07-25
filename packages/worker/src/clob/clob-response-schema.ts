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
});

export type ClobOrderResponse = z.infer<typeof clobOrderResponseSchema>;