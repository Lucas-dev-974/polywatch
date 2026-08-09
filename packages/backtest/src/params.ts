import { z } from 'zod';

export const backtestRunParamsSchema = z
  .object({
    domain: z.literal('weather').default('weather'),
    mode: z.enum(['reevaluate', 'replay']),
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    cities: z.array(z.string()).optional(),
    strategyId: z.string().optional().default('weather-forecast'),
    configOverrides: z.record(z.unknown()).optional(),
    capital: z.number().positive().default(1000),
    entryUsdc: z.number().positive().optional(),
    slippageBps: z.number().min(0).default(50),
    maxConcurrentPositions: z.number().int().positive().optional(),
    detectionDelayMs: z.number().min(0).default(0),
    label: z.string().optional(),
  })
  .refine((p) => new Date(p.to).getTime() > new Date(p.from).getTime(), {
    message: 'to must be after from',
    path: ['to'],
  });

export type BacktestRunParams = z.infer<typeof backtestRunParamsSchema>;

export function parseBacktestParams(raw: unknown): BacktestRunParams {
  return backtestRunParamsSchema.parse(raw);
}
