import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'
import { spawn, type ChildProcess } from 'child_process'
import type { IncomingMessage, ServerResponse } from 'http'

function inferenceServerPlugin(): Plugin {
  let serverProcess: ChildProcess | null = null

  function spawnServer() {
    if (serverProcess && serverProcess.exitCode === null) return // already running
    console.log('[vite] Spawning Python inference server…')
    serverProcess = spawn(
      'python3',
      ['drone-cv-system/server/inference_server.py'],
      { stdio: 'inherit', detached: false },
    )
    serverProcess.on('exit', (code) => {
      console.log(`[vite] Inference server exited (code ${code})`)
      serverProcess = null
    })
  }

  return {
    name: 'inference-server-control',
    configureServer(server) {
      server.middlewares.use(
        '/api/start-inference-server',
        (_req: IncomingMessage, res: ServerResponse) => {
          spawnServer()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ started: true }))
        },
      )

      // Tear down Python process when Vite dev server closes
      server.httpServer?.on('close', () => {
        if (serverProcess) {
          serverProcess.kill()
          serverProcess = null
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    preact(),
    inferenceServerPlugin(),
  ],
})
