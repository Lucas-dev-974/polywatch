import { config as dotenvConfig } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function findMonorepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    const pkgPath = resolve(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
          name?: string;
          workspaces?: unknown;
        };
        if (pkg.name === 'polywatch' && pkg.workspaces) {
          return dir;
        }
      } catch {
        // ignore invalid package.json
      }
    }
    dir = dirname(dir);
  }
  throw new Error('Polywatch monorepo root not found');
}

let monorepoRoot: string | undefined;

function getMonorepoRoot(): string {
  if (!monorepoRoot) {
    monorepoRoot = findMonorepoRoot();
  }
  return monorepoRoot;
}

export function loadMonorepoEnv(): void {
  const envPath = resolve(getMonorepoRoot(), '.env');
  if (existsSync(envPath)) {
    dotenvConfig({ path: envPath });
  }
}

export function resolveMonorepoPath(relativeOrAbsolute: string): string {
  return isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : resolve(getMonorepoRoot(), relativeOrAbsolute);
}

export function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL || undefined;
}
