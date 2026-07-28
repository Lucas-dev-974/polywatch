import type { DataSource } from 'typeorm';
import { RiskConfig } from '../entities/RiskConfig.js';
import { SimulationBalance } from '../entities/SimulationBalance.js';
import { User } from '../entities/User.js';
import { DEFAULT_SIM_BALANCE } from '../simulation/constants.js';
import type { SimAlgoKind } from '../simulation/algo-kind.js';
import { getSimInitialCapital } from '../simulation/sim-initial-capital.js';
import { SimulationSessionService } from '../services/simulation-session.service.js';
import { backfillLegacyRiskConfig } from './risk-config-backfill.js';
import { seedSystemConfigDefaults } from './system-config-defaults.js';

const ALL_ALGO_KINDS: SimAlgoKind[] = ['crypto', 'weather', 'copy'];

export async function seedDefaults(ds: DataSource): Promise<void> {
  const userRepo = ds.getRepository(User);
  const existingUser = await userRepo.findOne({ where: {} });
  if (!existingUser) {
    const bcrypt = await import('bcryptjs');
    const password = process.env.ADMIN_PASSWORD ?? 'changeme';
    const username = process.env.ADMIN_USERNAME ?? 'admin';
    await userRepo.save(
      userRepo.create({
        username,
        passwordHash: await bcrypt.hash(password, 12),
      }),
    );
  }

  const riskRepo = ds.getRepository(RiskConfig);
  let existingRisk = await riskRepo.findOne({ where: {} });
  if (!existingRisk) {
    existingRisk = await riskRepo.save(riskRepo.create({}));
  } else if (backfillLegacyRiskConfig(existingRisk)) {
    await riskRepo.save(existingRisk);
  }

  const simRepo = ds.getRepository(SimulationBalance);
  for (const algoKind of ALL_ALGO_KINDS) {
    const existingSim = await simRepo.findOne({ where: { algoKind } });
    if (existingSim) continue;
    const baseline = getSimInitialCapital(existingRisk, algoKind) ?? DEFAULT_SIM_BALANCE;
    await simRepo.save(
      simRepo.create({
        algoKind,
        token: 'pUSD',
        amount: baseline,
        baselineCapital: baseline,
        sessionStartedAt: new Date(),
      }),
    );
  }

  await ds.transaction(async (manager) => {
    const sessionService = new SimulationSessionService(ds);
    for (const algoKind of ALL_ALGO_KINDS) {
      const baseline = getSimInitialCapital(existingRisk, algoKind);
      await sessionService.ensureActiveSession(algoKind, manager, baseline);
    }
  });

  await seedSystemConfigDefaults(ds);
}
