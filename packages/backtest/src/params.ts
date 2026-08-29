import { z } from 'zod';

export const backtestRunParamsSchema = z
  .object({
    domain: z.literal('weather').default('weather'),
    mode: z.literal('reevaluate').default('reevaluate'),
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    cities: z.array(z.string()).optional(),
    // Optionnel : si absent, le runner-sim (reevaluate) utilise toutes les
    // stratégies actives de la config.
    strategyId: z.string().optional(),
    // Selects which environment's strategy list/params the runner uses. Named
    // `strategyEnv` — never `mode` (mode is already `'reevaluate'`).
    strategyEnv: z.enum(['sim', 'real']).default('sim'),
    backtestExecutionMode: z.enum(['strategy', 'runner-sim']).default('runner-sim'),
    configOverrides: z.record(z.unknown()).optional(),
    capital: z.number().positive().default(1000),
    entryPusd: z.number().positive().optional(),
    slippageBps: z.number().min(0).default(50),
    maxConcurrentPositions: z.number().int().positive().optional(),
    fidelityMinutes: z.number().int().positive().optional(),
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
