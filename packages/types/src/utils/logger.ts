/**
 * Supported log levels, in ascending severity order.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Structured log entry emitted to stdout as JSON.
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  context: Record<string, unknown>;
}

/**
 * A logger instance bound to a fixed service name and optional base context.
 * Additional context can be added per call or by creating a child logger via
 * `withContext`.
 */
export interface Logger {
  debug(message: string, ctx?: Record<string, unknown>): void;
  info(message: string, ctx?: Record<string, unknown>): void;
  warn(message: string, ctx?: Record<string, unknown>): void;
  error(message: string, ctx?: Record<string, unknown>): void;
  fatal(message: string, ctx?: Record<string, unknown>): void;
  /**
   * Create a new logger that merges `extraContext` into every log entry in
   * addition to the parent's base context.  Useful for attaching request-scoped
   * data (requestId, userId, jobId, …) without repeating it at every call site.
   */
  withContext(extraContext: Record<string, unknown>): Logger;
}

/**
 * Factory that produces a structured JSON logger bound to the given service
 * name.
 *
 * All log entries include at minimum: `timestamp`, `level`, `service`,
 * `message`, and any `context` fields.  Output goes to `process.stdout` so
 * container runtimes (Docker, Kubernetes) can collect it easily.
 *
 * @param serviceName  Label embedded in every log line (e.g. `"auth-service"`)
 * @param baseContext  Key/value pairs merged into every log line produced by
 *                     this logger (e.g. `{ environment: "production" }`)
 * @param output       Optional write function; defaults to `process.stdout.write`.
 *                     Injecting a custom writer makes the logger easy to test
 *                     without spy/mock overhead.
 */
export function createLogger(
  serviceName: string,
  baseContext: Record<string, unknown> = {},
  output: (line: string) => void = (line) => process.stdout.write(line + '\n'),
): Logger {
  function log(
    level: LogLevel,
    message: string,
    callContext: Record<string, unknown> = {},
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: serviceName,
      message,
      context: { ...baseContext, ...callContext },
    };
    output(JSON.stringify(entry));
  }

  const logger: Logger = {
    debug: (msg, ctx) => log('debug', msg, ctx),
    info: (msg, ctx) => log('info', msg, ctx),
    warn: (msg, ctx) => log('warn', msg, ctx),
    error: (msg, ctx) => log('error', msg, ctx),
    fatal: (msg, ctx) => log('fatal', msg, ctx),

    withContext(extraContext: Record<string, unknown>): Logger {
      return createLogger(
        serviceName,
        { ...baseContext, ...extraContext },
        output,
      );
    },
  };

  return logger;
}
