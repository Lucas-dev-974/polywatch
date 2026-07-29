import type { DataSource } from 'typeorm';
import { GlobalConfig } from '../entities/GlobalConfig.js';
import { CopyConfig } from '../entities/CopyConfig.js';
import { CryptoConfig } from '../entities/CryptoConfig.js';
import { WeatherConfig } from '../entities/WeatherConfig.js';
import { SimulationBalance } from '../entities/SimulationBalance.js';
import { User } from '../entities/User.js';
import { DEFAULT_SIM_BALANCE } from '../simulation/constants.js';
import type { SimAlgoKind } from '../simulation/algo-kind.js';
import { getSimInitialCapital } from '../simulation/sim-initial-capital.js';
import { SimulationSessionService } from '../services/simulation-session.service.js';
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

  // Seed the four isolated config tables if they are empty.
  const globalRepo = ds.getRepository(GlobalConfig);
  const existingGlobal = await globalRepo.findOne({ where: {} });
  if (!existingGlobal) {
    await globalRepo.save(globalRepo.create({}));
  }

  const copyRepo = ds.getRepository(CopyConfig);
  const existingCopy = await copyRepo.findOne({ where: {} });
  if (!existingCopy) {
    await copyRepo.save(copyRepo.create({}));
  }

  const cryptoRepo = ds.getRepository(CryptoConfig);
  const existingCrypto = await cryptoRepo.findOne({ where: {} });
  if (!existingCrypto) {
    await cryptoRepo.save(cryptoRepo.create({}));
  }

  const weatherRepo = ds.getRepository(WeatherConfig);
  const existingWeather = await weatherRepo.findOne({ where: {} });
  if (!existingWeather) {
    await weatherRepo.save(weatherRepo.create({}));
  }

  // Build a synthetic object compatible with the legacy getSimInitialCapital helper.
  const simCapitalSource = {
    simInitialCapitalCrypto: existingCrypto?.simInitialCapitalCrypto ?? DEFAULT_SIM_BALANCE,
    simInitialCapitalWeather: existingWeather?.simInitialCapitalWeather ?? DEFAULT_SIM_BALANCE,
    simInitialCapitalCopy: existingCopy?.simInitialCapitalCopy ?? DEFAULT_SIM_BALANCE,
  };

  const simRepo = ds.getRepository(SimulationBalance);
  for (const algoKind of ALL_ALGO_KINDS) {
    const existingSim = await simRepo.findOne({ where: { algoKind } });
    if (existingSim) continue;
    const baseline = getSimInitialCapital(simCapitalSource, algoKind);
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
      const baseline = getSimInitialCapital(simCapitalSource, algoKind);
      await sessionService.ensureActiveSession(algoKind, manager, baseline);
    }
  });

  await seedSystemConfigDefaults(ds);
}
