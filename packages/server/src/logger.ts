export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
}

export interface Logger {
  readonly debugEnabled: boolean
  getRecentEntries(): readonly LogEntry[]
  debug(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string, error?: unknown): void
}

export interface LoggerOptions {
  debug: boolean
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message
  }
  return String(error)
}

export function createLogger(options: LoggerOptions): Logger {
  const recentEntries: LogEntry[] = []

  const write = (level: LogLevel, message: string, error?: unknown): void => {
    if (level === 'debug' && !options.debug) {
      return
    }

    const suffix = error === undefined ? '' : `\n${formatError(error)}`
    const timestamp = new Date().toISOString()
    const fullMessage = `${message}${suffix}`
    const entry = `[${timestamp}] ${level.toUpperCase()} ${fullMessage}\n`
    recentEntries.push({ timestamp, level, message: fullMessage })
    if (recentEntries.length > 2000) {
      recentEntries.shift()
    }
    process.stdout.write(entry)
  }

  return {
    debugEnabled: options.debug,
    getRecentEntries: () => recentEntries,
    debug: (message) => write('debug', message),
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message, error) => write('error', message, error),
  }
}
