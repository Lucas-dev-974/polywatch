export class E2eRunnerBusyError extends Error {
  constructor(public readonly existingRunId?: string) {
    super('Un run E2E est déjà en cours');
    this.name = 'E2eRunnerBusyError';
  }
}

export class E2eRunnerInvalidSuiteError extends Error {
  constructor(public readonly suiteId: string) {
    super(`Suite E2E inconnue: ${suiteId}`);
    this.name = 'E2eRunnerInvalidSuiteError';
  }
}

export class E2eRunnerNotActiveError extends Error {
  constructor(public readonly runId: string) {
    super(`Run ${runId} n'est pas actif dans ce processus`);
    this.name = 'E2eRunnerNotActiveError';
  }
}

export class E2eRunnerSpawnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'E2eRunnerSpawnError';
  }
}
