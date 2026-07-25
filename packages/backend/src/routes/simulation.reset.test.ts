import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const resetBodySchema = z
  .object({
    amount: z.number().finite().nonnegative().optional(),
    archive: z.boolean().default(true),
    deepClean: z.boolean().default(false),
    newSessionLabel: z.string().max(200).nullable().optional(),
  })
  .strict();

describe('simulation reset body schema', () => {
  it('defaults archive to true and deepClean to false', () => {
    const parsed = resetBodySchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.data?.archive).toBe(true);
    expect(parsed.data?.deepClean).toBe(false);
  });

  it('accepts deepClean and newSessionLabel', () => {
    const parsed = resetBodySchema.safeParse({
      deepClean: true,
      newSessionLabel: 'Post-rapport',
      amount: 1500,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.deepClean).toBe(true);
    expect(parsed.data?.newSessionLabel).toBe('Post-rapport');
  });

  it('rejects unknown keys', () => {
    const parsed = resetBodySchema.safeParse({ foo: true });
    expect(parsed.success).toBe(false);
  });
});

const archiveTypeSchema = z.enum([
  'positions',
  'executions',
  'exit_attempts',
  'surveillance',
  'candles',
]);

describe('simulation session archive query schema', () => {
  it('accepts valid archive types', () => {
    expect(archiveTypeSchema.safeParse('candles').success).toBe(true);
  });

  it('rejects invalid archive types', () => {
    expect(archiveTypeSchema.safeParse('ticks').success).toBe(false);
  });
});
