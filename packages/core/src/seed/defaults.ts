import type { DataSource } from 'typeorm';
import { RiskConfig } from '../entities/RiskConfig.js';
import { SimulationBalance } from '../entities/SimulationBalance.js';
import { User } from '../entities/User.js';
import { DEFAULT_SIM_BALANCE } from '../simulation/constants.js';
import { SimulationSessionService } from '../services/simulation-session.service.js';
import { backfillLegacyRiskConfig } from './risk-config-backfill.js';
import { seedSystemConfigDefaults } from './system-config-defaults.js';

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
  const existingSim = await simRepo.findOne({ where: {} });
  if (!existingSim) {
    const baseline = existingRisk.simInitialCapital ?? DEFAULT_SIM_BALANCE;
    await simRepo.save(
      simRepo.create({
        token: 'pUSD',
        amount: baseline,
        baselineCapital: baseline,
        sessionStartedAt: new Date(),
      }),
    );
  }

  await ds.transaction(async (manager) => {
    await new SimulationSessionService(ds).ensureActiveSession(manager);
  });

  await seedSystemConfigDefaults(ds);
}
