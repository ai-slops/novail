export class DomainError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class GenerationError extends DomainError {
  constructor(code, message, evidence) {
    super(code, message, evidence.status ?? 502);
    this.outputTokens = evidence.outputTokens;
    this.invocationStarted = evidence.invocationStarted;
    this.usageManaged = evidence.usageManaged ?? false;
    this.diagnostics = evidence.diagnostics;
  }
}
