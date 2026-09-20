/**
 * Unit tests for structured logger utilities.
 * Validates: Requirements 27.2, 27.3
 */

import { createLogger } from './logger';
import type { LogEntry, LogLevel } from './logger';

// Helper – collect all lines written by a logger
function makeCapture(): { lines: LogEntry[]; writer: (line: string) => void } {
  const lines: LogEntry[] = [];
  const writer = (line: string) => lines.push(JSON.parse(line) as LogEntry);
  return { lines, writer };
}

// ---------------------------------------------------------------------------
// Basic logging
// ---------------------------------------------------------------------------

describe('createLogger – basic logging', () => {
  it('emits a JSON line for each log level', () => {
    const { lines, writer } = makeCapture();
    const logger = createLogger('auth-service', {}, writer);
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];

    for (const level of levels) {
      logger[level](`a ${level} message`);
    }

    expect(lines).toHaveLength(levels.length);
    for (let i = 0; i < levels.length; i++) {
      expect(lines[i]!.level).toBe(levels[i]);
    }
  });

  it('always includes timestamp, level, service, message and context', () => {
    const { lines, writer } = makeCapture();
    const logger = createLogger('upload-service', {}, writer);

    logger.info('file uploaded');

    const entry = lines[0]!;
    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('level', 'info');
    expect(entry).toHaveProperty('service', 'upload-service');
    expect(entry).toHaveProperty('message', 'file uploaded');
    expect(entry).toHaveProperty('context');
  });

  it('embeds the service name in every line', () => {
    const { lines, writer } = makeCapture();
    const logger = createLogger('billing-service', {}, writer);

    logger.warn('stripe timeout');
    logger.error('charge failed');

    expect(lines[0]!.service).toBe('billing-service');
    expect(lines[1]!.service).toBe('billing-service');
  });

  it('timestamp is a valid ISO 8601 string', () => {
    const { lines, writer } = makeCapture();
    const logger = createLogger('test-service', {}, writer);
    const before = Date.now();
    logger.info('hello');
    const after = Date.now();

    const ts = new Date(lines[0]!.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('produces valid JSON output (parseable strings)', () => {
    const rawLines: string[] = [];
    const writer = (line: string) => rawLines.push(line);
    const logger = createLogger('conversion-orchestrator', {}, writer);

    logger.info('job submitted', { jobId: 'job-1', format: 'pdf' });

    expect(() => JSON.parse(rawLines[0]!)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Base context propagation
// ---------------------------------------------------------------------------

describe('createLogger – base context', () => {
  it('merges base context into every log entry', () => {
    const { lines, writer } = makeCapture();
    const logger = createLogger('user-service', { environment: 'test', region: 'us-east-1' }, writer);

    logger.info('user registered');

    expect(lines[0]!.context['environment']).toBe('test');
    expect(lines[0]!.context['region']).toBe('us-east-1');
  });

  it('per-call context is merged on top of base context', () => {
    const { lines, writer } = makeCapture();
    const logger = createLogger('user-service', { environment: 'production' }, writer);

    logger.info('profile updated', { userId: 'u-42', field: 'name' });

    expect(lines[0]!.context['environment']).toBe('production');
    expect(lines[0]!.context['userId']).toBe('u-42');
    expect(lines[0]!.context['field']).toBe('name');
  });

  it('per-call context does not pollute the base context for subsequent calls', () => {
    const { lines, writer } = makeCapture();
    const logger = createLogger('worker', { workerId: 'w-1' }, writer);

    logger.info('job started', { jobId: 'job-100' });
    logger.info('job finished');

    expect(lines[0]!.context['jobId']).toBe('job-100');
    // Second call should NOT have jobId from the first call
    expect(lines[1]!.context['jobId']).toBeUndefined();
  });

  it('handles empty base context', () => {
    const { lines, writer } = makeCapture();
    const logger = createLogger('test-service', {}, writer);

    logger.debug('debug message');

    expect(lines[0]!.context).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// withContext – child logger
// ---------------------------------------------------------------------------

describe('createLogger – withContext', () => {
  it('child logger includes both parent base context and its own extra context', () => {
    const { lines, writer } = makeCapture();
    const parent = createLogger('api-service', { environment: 'staging' }, writer);
    const child = parent.withContext({ requestId: 'req-xyz', userId: 'u-99' });

    child.info('request received');

    expect(lines[0]!.context['environment']).toBe('staging');
    expect(lines[0]!.context['requestId']).toBe('req-xyz');
    expect(lines[0]!.context['userId']).toBe('u-99');
  });

  it('parent logger is unaffected by child context', () => {
    const { lines, writer } = makeCapture();
    const parent = createLogger('api-service', { environment: 'staging' }, writer);
    const child = parent.withContext({ requestId: 'req-xyz' });

    child.info('child call');
    parent.info('parent call');

    // parent line should not have requestId
    const parentLine = lines.find((l) => l.message === 'parent call')!;
    expect(parentLine.context['requestId']).toBeUndefined();
  });

  it('child withContext overrides keys from parent base context', () => {
    const { lines, writer } = makeCapture();
    const parent = createLogger('svc', { environment: 'production', traceId: 'base-trace' }, writer);
    const child = parent.withContext({ traceId: 'override-trace' });

    child.warn('override test');

    expect(lines[0]!.context['traceId']).toBe('override-trace');
    expect(lines[0]!.context['environment']).toBe('production');
  });

  it('supports chaining multiple withContext calls', () => {
    const { lines, writer } = makeCapture();
    const root = createLogger('root', { a: 1 }, writer);
    const level1 = root.withContext({ b: 2 });
    const level2 = level1.withContext({ c: 3 });

    level2.info('deep context');

    expect(lines[0]!.context['a']).toBe(1);
    expect(lines[0]!.context['b']).toBe(2);
    expect(lines[0]!.context['c']).toBe(3);
  });

  it('retains the original service name in child loggers', () => {
    const { lines, writer } = makeCapture();
    const parent = createLogger('my-service', {}, writer);
    const child = parent.withContext({ requestId: 'req-1' });

    child.info('from child');

    expect(lines[0]!.service).toBe('my-service');
  });

  it('per-call context in child is still merged correctly', () => {
    const { lines, writer } = makeCapture();
    const parent = createLogger('svc', { env: 'test' }, writer);
    const child = parent.withContext({ requestId: 'req-1' });

    child.error('failed', { jobId: 'job-5', error: 'timeout' });

    expect(lines[0]!.context['env']).toBe('test');
    expect(lines[0]!.context['requestId']).toBe('req-1');
    expect(lines[0]!.context['jobId']).toBe('job-5');
    expect(lines[0]!.context['error']).toBe('timeout');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('createLogger – edge cases', () => {
  it('logs messages with no per-call context (context field is empty object)', () => {
    const { lines, writer } = makeCapture();
    const logger = createLogger('svc', {}, writer);

    logger.info('bare message');

    expect(lines[0]!.context).toEqual({});
  });

  it('handles numeric and boolean context values', () => {
    const { lines, writer } = makeCapture();
    const logger = createLogger('svc', {}, writer);

    logger.info('mixed types', { count: 42, active: true, ratio: 3.14 });

    expect(lines[0]!.context['count']).toBe(42);
    expect(lines[0]!.context['active']).toBe(true);
    expect(lines[0]!.context['ratio']).toBe(3.14);
  });

  it('handles nested objects in context', () => {
    const { lines, writer } = makeCapture();
    const logger = createLogger('svc', {}, writer);

    logger.info('nested', { error: { code: 'TIMEOUT', retries: 3 } });

    expect((lines[0]!.context['error'] as Record<string, unknown>)['code']).toBe('TIMEOUT');
  });

  it('fatal level is supported', () => {
    const { lines, writer } = makeCapture();
    const logger = createLogger('svc', {}, writer);

    logger.fatal('critical failure', { shutdownReason: 'OOM' });

    expect(lines[0]!.level).toBe('fatal');
    expect(lines[0]!.context['shutdownReason']).toBe('OOM');
  });
});
