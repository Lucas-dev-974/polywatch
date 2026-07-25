import { randomUUID } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  readFileSync,
  type WriteStream,
} from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import type { DataSource } from 'typeorm';
import pino from 'pino';
import {
  E2eTestRun,
  E2eRunPosition,
  type E2eRunSummary,
  type E2eSuiteId,
} from '@polywatch/core';
import {
  E2eRunnerBusyError,
  E2eRunnerInvalidSuiteError,
  E2eRunnerNotActiveError,
  E2eRunnerSpawnError,
} from '../e2e/errors.js';
import {
  attachProcessLogPipes,
  killProcessTree,
  spawnNpmTest,
} from '../e2e/process.js';
import {
  buildRunArtifactPaths,
  ensureE2eLogDir,
  e2eRunToDto,
} from '../e2e/run-dto.js';
import { parseJsonSummary, parseStdoutSummary } from '../e2e/summary-parser.js';
import { getSuiteDefinition } from '../e2e/suites.js';
import {
  tryParseE2ePositionMarker,
  type E2ePositionMarker,
} from '../e2e/position-marker.js';
import { E2E_SUITES } from '../e2e/suites.js';
import {
  emitE2eLog,
  emitE2ePosition,
  emitE2ePositionUpdate,
  emitE2eRunFinished,
  emitE2eRunStarted,
} from '../websocket.js';

const log = pino({ name: 'e2e-runner' });

export { E2E_SUITES, getSuiteDefinition, isValidSuiteId } from '../e2e/suites.js';
export {
  E2eRunnerBusyError,
  E2eRunnerInvalidSuiteError,
  E2eRunnerNotActiveError,
  E2eRunnerSpawnError,
} from '../e2e/errors.js';
export { ensureE2eLogDir, e2eRunToDto } from '../e2e/run-dto.js';

export class E2eRunnerService {
  private activeRunId: string | null = null;
  private child: ChildProcess | null = null;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private logStream: WriteStream | null = null;
  private stdoutBuffer = '';
  private finishingRuns = new Set<string>();
  /** Map runId+conditionId -> positionId pour relier update/close au bon enregistrement. */
  private positionIdMap = new Map<string, string>();

  constructor(private readonly ds: DataSource) { }

  private repo() {
    return this.ds.getRepository(E2eTestRun);
  }

  private positionRepo() {
    return this.ds.getRepository(E2eRunPosition);
  }

  async recoverStaleRuns(): Promise<void> {
    const stale = await this.repo().find({ where: { status: 'running' } });
    for (const run of stale) {
      run.status = 'failed';
      run.finishedAt = new Date();
      run.durationMs = run.finishedAt.getTime() - run.startedAt.getTime();
      run.errorMessage = 'Backend redémarré pendant l\'exécution';
      await this.repo().save(run);

      // Fermer les positions orphelines liées à ce run
      const orphanPositions = await this.positionRepo().find({
        where: { runId: run.id, status: 'open' },
      });
      for (const pos of orphanPositions) {
        pos.status = 'closed';
        pos.closeReason = 'backend_restarted';
        pos.closedAt = run.finishedAt;
        await this.positionRepo().save(pos);
      }
    }
  }

  async getActiveRun(): Promise<E2eTestRun | null> {
    if (this.activeRunId) {
      return this.repo().findOne({ where: { id: this.activeRunId } });
    }
    return this.repo().findOne({
      where: { status: 'running' },
      order: { startedAt: 'DESC' },
    });
  }

  async listRuns(limit: number, offset: number): Promise<{ items: E2eTestRun[]; total: number }> {
    const [items, total] = await this.repo().findAndCount({
      order: { startedAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { items, total };
  }

  async getRun(id: string): Promise<E2eTestRun | null> {
    const run = await this.repo().findOne({ where: { id } });
    if (!run || run.status === 'running' || run.status === 'cancelled') return run;

    const needsTests =
      run.summary != null &&
      (run.summary.total ?? 0) > 0 &&
      !run.summary.tests?.length;

    if (!needsTests) return run;

    const { resultsPath } = buildRunArtifactPaths(id);
    const fromFile = this.resolveSummary(resultsPath, run.suite);
    if (!fromFile?.tests?.length) return run;

    run.summary = { ...run.summary!, ...fromFile };
    await this.repo().save(run);
    return run;
  }

  readLogTail(logFilePath: string, tail?: number): string {
    if (!existsSync(logFilePath)) return '';
    const content = readFileSync(logFilePath, 'utf8');
    if (!tail || tail <= 0) return content;
    const lines = content.split('\n');
    return lines.slice(-tail).join('\n');
  }

  async getRunPositions(runId: string): Promise<E2eRunPosition[]> {
    return this.positionRepo().find({
      where: { runId },
      order: { openedAt: 'ASC' },
    });
  }

  async getLastRunPerSuite(): Promise<Record<string, E2eTestRun | null>> {
    const result: Record<string, E2eTestRun | null> = {};
    for (const suite of E2E_SUITES) {
      const run = await this.repo().findOne({
        where: { suite: suite.id },
        order: { startedAt: 'DESC' },
      });
      result[suite.id] = run ?? null;
    }
    return result;
  }

  async startRun(suiteId: E2eSuiteId, triggeredBy?: string): Promise<E2eTestRun> {
    if (this.activeRunId) {
      throw new E2eRunnerBusyError();
    }

    const existing = await this.repo().findOne({ where: { status: 'running' } });
    if (existing) {
      throw new E2eRunnerBusyError(existing.id);
    }

    const suite = getSuiteDefinition(suiteId);
    if (!suite) {
      throw new E2eRunnerInvalidSuiteError(suiteId);
    }

    const id = randomUUID();
    ensureE2eLogDir();
    const { logFilePath, resultsPath } = buildRunArtifactPaths(id);

    const run = this.repo().create({
      id,
      suite: suiteId,
      status: 'running',
      startedAt: new Date(),
      finishedAt: null,
      durationMs: null,
      exitCode: null,
      summary: null,
      logFilePath,
      triggeredBy: triggeredBy ?? null,
      errorMessage: null,
    });
    await this.repo().save(run);

    this.activeRunId = id;
    this.stdoutBuffer = '';
    this.logStream = createWriteStream(logFilePath, { flags: 'a' });
    emitE2eRunStarted({ runId: id, suite: suiteId });

    let child: ChildProcess;
    try {
      child = spawnNpmTest({ suite, resultsPath, runId: id });
    } catch (err) {
      const message = err instanceof E2eRunnerSpawnError ? err.message : 'Échec du lancement npm';
      await this.finishRun(id, 1, resultsPath, suiteId, false, message);
      throw err;
    }

    this.child = child;

    const appendLine = (line: string) => {
      this.stdoutBuffer += line + '\n';
      this.logStream?.write(line + '\n');
      emitE2eLog({ runId: id, line, ts: Date.now() });

      const marker = tryParseE2ePositionMarker(line);
      if (marker && marker.runId === id) {
        void this.handlePositionMarker(id, marker).catch((err) => {
          // Best-effort : on ne casse pas le runner, mais on signale l'erreur
          console.error(`[e2e-runner] handlePositionMarker failed for run ${id}`, err);
        });
      }
    };

    const logPipes = attachProcessLogPipes(child, appendLine);

    this.timeoutHandle = setTimeout(() => {
      void this.cancelRun(id, 'Timeout runner dépassé').catch((err) =>
        log.error({ err, runId: id }, 'cancelRun failed on timeout'),
      );
    }, suite.timeoutMs);

    child.on('close', (code) => {
      logPipes.flush();
      void this.finishRun(id, code ?? 1, resultsPath, suiteId, false).catch((err) =>
        log.error({ err, runId: id }, 'finishRun failed on close'),
      );
    });

    child.on('error', (err) => {
      void this.finishRun(id, 1, resultsPath, suiteId, false, err.message).catch((e) =>
        log.error({ err: e, runId: id }, 'finishRun failed on error'),
      );
    });

    return run;
  }

  async cancelRun(runId: string, reason = 'Annulé par l\'utilisateur'): Promise<E2eTestRun | null> {
    if (this.activeRunId !== runId) {
      const run = await this.getRun(runId);
      if (!run || run.status !== 'running') return run;
      throw new E2eRunnerNotActiveError(runId);
    }

    if (this.child?.pid) {
      await killProcessTree(this.child.pid);
    }

    const { resultsPath } = buildRunArtifactPaths(runId);
    const run = await this.getRun(runId);
    return this.finishRun(runId, null, resultsPath, run?.suite ?? 'playwright', true, reason);
  }

  async shutdown(): Promise<void> {
    if (!this.activeRunId || !this.child?.pid) return;

    await killProcessTree(this.child.pid);
    const runId = this.activeRunId;
    const { resultsPath } = buildRunArtifactPaths(runId);
    const run = await this.getRun(runId);
    await this.finishRun(
      runId,
      null,
      resultsPath,
      run?.suite ?? 'playwright',
      true,
      'Backend arrêté',
    );
  }

  private clearRuntimeState(runId: string): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    this.logStream?.end();
    this.logStream = null;
    this.child = null;
    if (this.activeRunId === runId) {
      this.activeRunId = null;
    }
    // Nettoie les entrées positionIdMap du run terminé (évite la fuite mémoire cumulative)
    const prefix = `${runId}:`;
    for (const key of this.positionIdMap.keys()) {
      if (key.startsWith(prefix)) {
        this.positionIdMap.delete(key);
      }
    }
  }

  private resolveSummary(
    resultsPath: string,
    suiteId: E2eSuiteId,
  ): E2eRunSummary | null {
    if (existsSync(resultsPath)) {
      const fromJson = parseJsonSummary(readFileSync(resultsPath, 'utf8'), suiteId);
      if (fromJson) return fromJson;
    }
    return parseStdoutSummary(this.stdoutBuffer);
  }

  private async finishRun(
    runId: string,
    exitCode: number | null,
    resultsPath: string,
    suiteId: E2eSuiteId,
    cancelled: boolean,
    errorMessage?: string,
  ): Promise<E2eTestRun | null> {
    if (this.finishingRuns.has(runId)) {
      return this.getRun(runId);
    }
    this.finishingRuns.add(runId);

    try {
      this.clearRuntimeState(runId);

      const run = await this.repo().findOne({ where: { id: runId } });
      if (!run || run.status !== 'running') return run;

      const finishedAt = new Date();
      run.finishedAt = finishedAt;
      run.durationMs = finishedAt.getTime() - run.startedAt.getTime();
      run.exitCode = exitCode;

      if (cancelled) {
        run.status = 'cancelled';
        run.errorMessage = errorMessage ?? null;
      } else {
        run.status = exitCode === 0 ? 'passed' : 'failed';
        run.errorMessage = errorMessage ?? null;
        run.summary = this.resolveSummary(resultsPath, suiteId);
      }

      await this.repo().save(run);

      // Ferme les positions restées ouvertes si le run n'a pas abouti (passed).
      // Couvre le cas : position ouverte → assertion échoue → exit ≠ 0 → pas de marker close.
      if (run.status !== 'passed') {
        await this.closeOrphanPositions(runId, finishedAt, `run_${run.status}`);
      }

      emitE2eRunFinished({ runId, status: run.status, summary: run.summary });
      return run;
    } finally {
      this.finishingRuns.delete(runId);
    }
  }

  private async handlePositionMarker(runId: string, marker: E2ePositionMarker): Promise<void> {
    const mapKey = `${runId}:${marker.conditionId}`;

    if (marker.e2e_position === 'open') {
      const posId = randomUUID();
      this.positionIdMap.set(mapKey, posId);

      const pos = this.positionRepo().create({
        id: posId,
        runId,
        conditionId: marker.conditionId,
        marketQuestion: marker.marketQuestion ?? null,
        cryptoSymbol: marker.cryptoSymbol ?? null,
        interval: marker.interval ?? null,
        outcome: marker.outcome,
        side: marker.side,
        entryPrice: marker.entryPrice,
        quantity: marker.quantity,
        currentPrice: null,
        pnlPercent: null,
        realizedPnl: null,
        status: 'open',
        closeReason: null,
        openedAt: new Date(marker.openedAt),
        closedAt: null,
      });
      await this.positionRepo().save(pos);
      emitE2ePosition({ ...e2ePositionToDto(pos), runId });
      return;
    }

    if (marker.e2e_position === 'update') {
      const posId = this.positionIdMap.get(mapKey);
      if (!posId) return;

      const pos = await this.positionRepo().findOne({ where: { id: posId } });
      if (!pos || pos.status !== 'open') return;

      pos.currentPrice = marker.currentPrice;
      pos.pnlPercent = marker.pnlPercent;
      await this.positionRepo().save(pos);
      emitE2ePositionUpdate({
        runId,
        positionId: posId,
        currentPrice: marker.currentPrice,
        pnlPercent: marker.pnlPercent,
      });
      return;
    }

    if (marker.e2e_position === 'close') {
      const posId = this.positionIdMap.get(mapKey);
      if (!posId) return;

      const pos = await this.positionRepo().findOne({ where: { id: posId } });
      if (!pos || pos.status !== 'open') return;

      pos.status = 'closed';
      pos.closeReason = marker.closeReason;
      pos.realizedPnl = marker.realizedPnl;
      pos.closedAt = new Date(marker.closedAt);
      await this.positionRepo().save(pos);
      emitE2ePosition({ ...e2ePositionToDto(pos), runId });
      return;
    }
  }

  /**
   * Ferme les positions restées 'open' pour un run terminé sans marker 'close'
   * (ex: assertion échouée avant la phase de clôture, timeout, crash du test).
   */
  private async closeOrphanPositions(
    runId: string,
    closedAt: Date,
    reason: string,
  ): Promise<void> {
    const orphans = await this.positionRepo().find({
      where: { runId, status: 'open' },
    });
    for (const pos of orphans) {
      pos.status = 'closed';
      pos.closeReason = reason;
      pos.closedAt = closedAt;
      await this.positionRepo().save(pos);
      emitE2ePosition({ ...e2ePositionToDto(pos), runId });
    }
  }
}

export function createE2eRunnerService(ds: DataSource): E2eRunnerService {
  return new E2eRunnerService(ds);
}

export function e2ePositionToDto(pos: E2eRunPosition) {
  return {
    id: pos.id,
    runId: pos.runId,
    conditionId: pos.conditionId,
    marketQuestion: pos.marketQuestion,
    cryptoSymbol: pos.cryptoSymbol,
    interval: pos.interval,
    outcome: pos.outcome,
    side: pos.side,
    entryPrice: pos.entryPrice,
    quantity: pos.quantity,
    currentPrice: pos.currentPrice,
    pnlPercent: pos.pnlPercent,
    realizedPnl: pos.realizedPnl,
    status: pos.status,
    closeReason: pos.closeReason,
    openedAt: pos.openedAt.toISOString(),
    closedAt: pos.closedAt?.toISOString() ?? null,
  };
}
