import { describe, expect, it, vi } from 'vitest';
import type { DataSource, Repository } from 'typeorm';
import { SystemConfig } from '../entities/SystemConfig.js';
import { SystemConfigService } from './system-config.service.js';

function createMockRepo(): Repository<SystemConfig> {
  return {
    findOne: vi.fn(),
    find: vi.fn(),
    save: vi.fn(),
    create: vi.fn((e) => e as SystemConfig),
    upsert: vi.fn(),
  } as unknown as Repository<SystemConfig>;
}

function createMockDs(repo: Repository<SystemConfig>): DataSource {
  return {
    getRepository: () => repo,
  } as unknown as DataSource;
}

describe('SystemConfigService', () => {
  beforeEach(() => {
    SystemConfigService.invalidateCache();
  });

  describe('get', () => {
    it('returns null when key does not exist', async () => {
      const repo = createMockRepo();
      (repo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const svc = new SystemConfigService(createMockDs(repo));

      const result = await svc.get('nonexistent.key');
      expect(result).toBeNull();
    });

    it('returns the value when key exists', async () => {
      const repo = createMockRepo();
      (repo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        key: 'test.key',
        value: '42',
      } as SystemConfig);
      const svc = new SystemConfigService(createMockDs(repo));

      const result = await svc.get('test.key');
      expect(result).toBe('42');
    });

    it('uses cache on second call', async () => {
      const repo = createMockRepo();
      const findOne = vi.fn().mockResolvedValue({
        key: 'cached.key',
        value: 'cached_value',
      } as SystemConfig);
      (repo.findOne as ReturnType<typeof vi.fn>).mockImplementation(findOne);
      const svc = new SystemConfigService(createMockDs(repo));

      const first = await svc.get('cached.key');
      expect(first).toBe('cached_value');
      expect(findOne).toHaveBeenCalledTimes(1);

      const second = await svc.get('cached.key');
      expect(second).toBe('cached_value');
      // Second call should use cache, not hit DB
      expect(findOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('getNumber', () => {
    it('returns fallback when key is absent', async () => {
      const repo = createMockRepo();
      (repo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const svc = new SystemConfigService(createMockDs(repo));

      const result = await svc.getNumber('missing.key', 99);
      expect(result).toBe(99);
    });

    it('parses numeric string', async () => {
      const repo = createMockRepo();
      (repo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        key: 'num.key',
        value: '30000',
      } as SystemConfig);
      const svc = new SystemConfigService(createMockDs(repo));

      const result = await svc.getNumber('num.key', 100);
      expect(result).toBe(30000);
    });

    it('returns fallback for non-numeric string', async () => {
      const repo = createMockRepo();
      (repo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        key: 'bad.key',
        value: 'not_a_number',
      } as SystemConfig);
      const svc = new SystemConfigService(createMockDs(repo));

      const result = await svc.getNumber('bad.key', 42);
      expect(result).toBe(42);
    });
  });

  describe('getBoolean', () => {
    it('returns fallback when key is absent', async () => {
      const repo = createMockRepo();
      (repo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const svc = new SystemConfigService(createMockDs(repo));

      expect(await svc.getBoolean('missing', true)).toBe(true);
      expect(await svc.getBoolean('missing', false)).toBe(false);
    });

    it('parses "true" and "false"', async () => {
      const repo = createMockRepo();
      const svc = new SystemConfigService(createMockDs(repo));

      (repo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        key: 'flag.true',
        value: 'true',
      } as SystemConfig);
      expect(await svc.getBoolean('flag.true', false)).toBe(true);

      (repo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        key: 'flag.false',
        value: 'false',
      } as SystemConfig);
      expect(await svc.getBoolean('flag.false', true)).toBe(false);
    });
  });

  describe('set', () => {
    it('upserts the value and updates cache', async () => {
      const repo = createMockRepo();
      const upsert = vi.fn().mockResolvedValue(undefined);
      (repo.upsert as ReturnType<typeof vi.fn>).mockImplementation(upsert);
      const svc = new SystemConfigService(createMockDs(repo));

      await svc.set('my.key', 'new_value');

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'my.key', value: 'new_value' }),
        expect.any(Object),
      );

      // Cache should be populated
      const cached = await svc.get('my.key');
      expect(cached).toBe('new_value');
    });
  });

  describe('getByCategory', () => {
    it('returns entries filtered by category', async () => {
      const repo = createMockRepo();
      const entries = [
        { key: 'a.1', value: '1', category: 'worker' },
        { key: 'a.2', value: '2', category: 'worker' },
      ] as SystemConfig[];
      (repo.find as ReturnType<typeof vi.fn>).mockResolvedValue(entries);
      const svc = new SystemConfigService(createMockDs(repo));

      const result = await svc.getByCategory('worker');
      expect(result).toHaveLength(2);
      expect(result[0].key).toBe('a.1');
    });
  });

  describe('getAll', () => {
    it('returns all entries', async () => {
      const repo = createMockRepo();
      const entries = [
        { key: 'x', value: '1', category: 'worker' },
        { key: 'y', value: '2', category: 'backend' },
      ] as SystemConfig[];
      (repo.find as ReturnType<typeof vi.fn>).mockResolvedValue(entries);
      const svc = new SystemConfigService(createMockDs(repo));

      const result = await svc.getAll();
      expect(result).toHaveLength(2);
    });
  });

  describe('getFeatureFlag', () => {
    it('prefixes feature. when reading boolean flags', async () => {
      const repo = createMockRepo();
      (repo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        key: 'feature.risk_config_strict',
        value: 'true',
      } as SystemConfig);
      const svc = new SystemConfigService(createMockDs(repo));

      expect(await svc.getFeatureFlag('risk_config_strict', false)).toBe(true);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { key: 'feature.risk_config_strict' },
      });
    });
  });

  describe('seedDefaults', () => {
    it('inserts missing keys and skips existing ones', async () => {
      const repo = createMockRepo();
      const findOne = vi.fn()
        .mockResolvedValueOnce(null)   // key.a does not exist
        .mockResolvedValueOnce({ key: 'key.b' } as SystemConfig); // key.b exists
      (repo.findOne as ReturnType<typeof vi.fn>).mockImplementation(findOne);
      const save = vi.fn().mockResolvedValue(undefined);
      (repo.save as ReturnType<typeof vi.fn>).mockImplementation(save);
      const svc = new SystemConfigService(createMockDs(repo));

      await svc.seedDefaults([
        { key: 'key.a', value: 'val_a', category: 'test' },
        { key: 'key.b', value: 'val_b', category: 'test' },
      ]);

      // Only key.a should be saved (key.b already exists)
      expect(save).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'key.a', value: 'val_a' }),
      );
    });
  });

  describe('invalidateCache', () => {
    it('clears all cached entries', async () => {
      const repo = createMockRepo();
      (repo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        key: 'cached.key',
        value: 'val',
      } as SystemConfig);
      const svc = new SystemConfigService(createMockDs(repo));

      await svc.get('cached.key');
      expect((repo.findOne as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);

      SystemConfigService.invalidateCache();

      await svc.get('cached.key');
      // After invalidation, should hit DB again
      expect((repo.findOne as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    });
  });
});
