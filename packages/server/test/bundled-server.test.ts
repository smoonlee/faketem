import { spawn, type ChildProcess } from 'node:child_process'
import { createSocket } from 'node:dgram'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { afterEach, expect, it } from 'vitest'
import { createDefaultConfig } from '@atem-sandbox/shared'

let child: ChildProcess | undefined
let directory: string | undefined

afterEach(async () => {
  if (child !== undefined && child.exitCode === null) {
    const processToStop = child
    await new Promise<void>((resolveStop) => {
      processToStop.once('exit', () => resolveStop())
      processToStop.kill()
    })
  }
  child = undefined
  if (directory !== undefined) {
    await rm(directory, { recursive: true, force: true })
    directory = undefined
  }
})

it('runs the bundled server with separate data and web assets', async () => {
  directory = await mkdtemp(join(tmpdir(), 'atem-sandbox-bundle-'))
  const data = join(directory, 'data')
  const web = join(directory, 'web')
  await Promise.all([mkdir(data), mkdir(web)])
  const config = createDefaultConfig()
  config.server.webPort = await freeTcpPort()
  config.server.atemPort = await freeUdpPort()
  await writeFile(join(data, 'config.json'), JSON.stringify(config))
  await writeFile(join(web, 'index.html'), '<html>bundled server</html>')
  const bundle = join(directory, 'server.cjs')
  await build({
    entryPoints: [resolve('packages/server/src/index.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
  })

  child = spawn(process.execPath, [bundle], {
    env: {
      ...process.env,
      ATEM_SANDBOX_PORTABLE_ROOT: data,
      ATEM_SANDBOX_WEB_DIST: web,
      ATEM_SANDBOX_WEB_HOST: '0.0.0.0',
      ATEM_SANDBOX_ATEM_HOST: '0.0.0.0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const processToTest = child
  await new Promise<void>((resolveStart, rejectStart) => {
    const timeout = setTimeout(() => rejectStart(new Error('Bundled server did not start')), 10000)
    let output = ''
    processToTest.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      if (output.includes('ATEM UDP server listening')) {
        clearTimeout(timeout)
        resolveStart()
      }
    })
    processToTest.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    processToTest.once('error', (error) => {
      clearTimeout(timeout)
      rejectStart(error)
    })
    processToTest.once('exit', (code) => {
      clearTimeout(timeout)
      rejectStart(new Error(`Bundled server exited with ${code}: ${output}`))
    })
  })

  const base = `http://127.0.0.1:${config.server.webPort}`
  expect(await (await fetch(base)).text()).toContain('bundled server')
  expect((await fetch(`${base}/api/v1/health`)).ok).toBe(true)
}, 20000)

async function freeTcpPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No TCP port available')
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  return address.port
}

async function freeUdpPort(): Promise<number> {
  const socket = createSocket('udp4')
  await new Promise<void>((resolveBind, rejectBind) => {
    socket.once('error', rejectBind)
    socket.bind(0, '127.0.0.1', resolveBind)
  })
  const port = socket.address().port
  await new Promise<void>((resolveClose) => socket.close(() => resolveClose()))
  return port
}
