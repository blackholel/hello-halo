/**
 * Logger Service - Structured logging with namespace and level filtering
 *
 * Replaces console.log statements with a configurable logger that:
 * - Supports log levels (debug, info, warn, error)
 * - Filters messages based on LOG_LEVEL environment variable
 * - Includes namespace prefix for easy filtering
 * - Supports metadata objects
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug: (message: string, meta?: Record<string, unknown>) => void
  info: (message: string, meta?: Record<string, unknown>) => void
  warn: (message: string, meta?: Record<string, unknown>) => void
  error: (message: string, meta?: Record<string, unknown>) => void
}

// Log level priority (higher = more severe)
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
}

/**
 * Get the current log level from environment
 * Defaults to 'info' in production
 */
function getLogLevel(): LogLevel {
  const level = process.env.LOG_LEVEL?.toLowerCase() as LogLevel
  if (level && LOG_LEVELS[level] !== undefined) {
    return level
  }
  return 'info'
}

/**
 * Check if a message at the given level should be logged
 */
function shouldLog(messageLevel: LogLevel, configuredLevel: LogLevel): boolean {
  return LOG_LEVELS[messageLevel] >= LOG_LEVELS[configuredLevel]
}

/**
 * Create a logger with the given namespace
 *
 * @param namespace - The namespace prefix for log messages (e.g., 'AgentService', 'HTTP')
 * @returns Logger instance with debug, info, warn, error methods
 *
 * @example
 * const logger = createLogger('MyService')
 * logger.info('Starting service', { port: 3000 })
 * // Output: [MyService] Starting service { port: 3000 }
 */
export function createLogger(namespace: string): Logger {
  const configuredLevel = getLogLevel()

  const log = (
    level: LogLevel,
    consoleFn: typeof console.log,
    message: string,
    meta?: Record<string, unknown>
  ): void => {
    if (!shouldLog(level, configuredLevel)) {
      return
    }

    const prefix = `[${namespace}]`
    if (meta !== undefined) {
      consoleFn(prefix, message, meta)
    } else {
      consoleFn(prefix, message)
    }
  }

  return {
    debug: (message: string, meta?: Record<string, unknown>) =>
      log('debug', console.debug, message, meta),
    info: (message: string, meta?: Record<string, unknown>) =>
      log('info', console.info, message, meta),
    warn: (message: string, meta?: Record<string, unknown>) =>
      log('warn', console.warn, message, meta),
    error: (message: string, meta?: Record<string, unknown>) =>
      log('error', console.error, message, meta)
  }
}
