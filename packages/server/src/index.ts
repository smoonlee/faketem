import { resolve } from 'node:path'
import {
  ConfigRepository,
  parseCliOptions,
  resolvePortableConfigPath,
} from './config-repository.js'
import { createLogger } from './logger.js'
import { createSandboxRuntime } from './runtime.js'

async function main(): Promise<void> {
  const cli = parseCliOptions(process.argv.slice(2))
  // npm runs a workspace script from that workspace. INIT_CWD preserves the folder
  // from which the user invoked npm, which is the portable root during development.
  // Packaged hosts will set ATEM_SANDBOX_PORTABLE_ROOT to the executable directory.
  const portableRoot = resolve(
    process.env.ATEM_SANDBOX_PORTABLE_ROOT ?? process.env.INIT_CWD ?? process.cwd(),
  )
  const configPath = resolvePortableConfigPath(portableRoot, cli.configArgument)
  const logger = createLogger({ debug: cli.debug })
  const configRepository = new ConfigRepository(configPath)
  const config = await configRepository.loadOrCreate()

  logger.info(`Configuration loaded from ${configPath}.`)
  logger.info(`Starting ${config.device.name} (${config.device.model}).`)
  if (cli.headless) {
    logger.info('Headless mode requested; the browser UI remains available over HTTP.')
  }

  const runtime = createSandboxRuntime({
    config,
    configRepository,
    logger,
    portableRoot,
    webHost: process.env.ATEM_SANDBOX_WEB_HOST,
    atemHost: process.env.ATEM_SANDBOX_ATEM_HOST,
    webDistDirectory: process.env.ATEM_SANDBOX_WEB_DIST,
  })
  await runtime.start()

  const stop = async (signal: string): Promise<void> => {
    logger.info(`${signal} received; stopping ATEM Sandbox.`)
    await runtime.stop()
  }
  process.once('SIGINT', () => void stop('SIGINT'))
  process.once('SIGTERM', () => void stop('SIGTERM'))
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`ATEM Sandbox could not start: ${message}\n`)
  process.exitCode = 1
})

export { createSandboxRuntime } from './runtime.js'
export { ConfigRepository, ConfigValidationError } from './config-repository.js'
