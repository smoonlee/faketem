import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { createLogger, defineConfig, type LogErrorOptions } from 'vite'

const viteLogger = createLogger()
const transientProxyErrorCodes = new Set(['ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET'])
const proxyErrorMarkers = ['http proxy error:', 'ws proxy error:', 'ws proxy socket error:']

function isExpectedBackendRestartError(message: string, options?: LogErrorOptions): boolean {
  if (!proxyErrorMarkers.some((marker) => message.includes(marker))) {
    return false
  }

  const error = options?.error
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false
  }

  const { code } = error
  return typeof code === 'string' && transientProxyErrorCodes.has(code)
}

const logger = {
  ...viteLogger,
  error(message: string, options?: LogErrorOptions) {
    if (isExpectedBackendRestartError(message, options)) {
      return
    }

    viteLogger.error(message, options)
  },
}

export default defineConfig({
  plugins: [react()],
  customLogger: logger,
  resolve: {
    alias: {
      '@atem-sandbox/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
      '@atem-sandbox/atem-state': fileURLToPath(
        new URL('../../packages/atem-state/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/media': 'http://127.0.0.1:3000',
      '/ws': {
        target: 'ws://127.0.0.1:3000',
        ws: true,
      },
    },
  },
})
