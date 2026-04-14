import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'
import { spawn, type ChildProcess } from 'child_process'
import type { IncomingMessage, ServerResponse } from 'http'

function inferenceServerPlugin(): Plugin {
  let serverProcess: ChildProcess | null = null
  let agentProcess: ChildProcess | null = null

  const PYTHON = new URL('.venv/bin/python3', import.meta.url).pathname

  function spawnInferenceServer() {
    if (serverProcess && serverProcess.exitCode === null) return
    console.log('[vite] Spawning Python inference server…')
    serverProcess = spawn(
      PYTHON,
      ['drone-cv-system/server/inference_server.py'],
      { stdio: 'inherit', detached: false },
    )
    serverProcess.on('exit', (code) => {
      console.log(`[vite] Inference server exited (code ${code})`)
      serverProcess = null
    })
  }

  function spawnAgentServer() {
    if (agentProcess && agentProcess.exitCode === null) return
    console.log('[vite] Spawning Python agent server…')
    agentProcess = spawn(
      PYTHON,
      ['drone-cv-system/server/agent_server.py'],
      { stdio: 'inherit', detached: false },
    )
    agentProcess.on('exit', (code) => {
      console.log(`[vite] Agent server exited (code ${code})`)
      agentProcess = null
    })
  }

  return {
    name: 'inference-server-control',
    configureServer(server) {
      server.middlewares.use(
        '/api/start-inference-server',
        (_req: IncomingMessage, res: ServerResponse) => {
          spawnInferenceServer()
          spawnAgentServer()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ started: true }))
        },
      )

      // Tear down Python processes when Vite dev server closes
      server.httpServer?.on('close', () => {
        if (serverProcess) { serverProcess.kill(); serverProcess = null }
        if (agentProcess)  { agentProcess.kill();  agentProcess  = null }
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
  server: {
    watch: {
      // Only watch the frontend source — exclude Python, markdown, data files,
      // and every non-src directory. Without this, Vite crawls the entire repo
      // (drone-cv-system/, skills/, benchmark_results/, metrics/, etc.) and
      // takes 200+ seconds to start up.
      ignored: [
        '**/node_modules/**',
        '**/dist/**',
        '**/drone-cv-system/**',
        '**/skills/**',
        '**/benchmark_results/**',
        '**/metrics/**',
        '**/*.py',
        '**/*.md',
        '**/*.yaml',
        '**/*.yml',
        '**/*.sh',
        '**/*.csv',
        '**/benchmark_suite.py',
      ],
    },
    proxy: {
      // Proxy /api/agent/* to agent server on port 8766
      '/api/agent': {
        target: 'http://localhost:8766',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/agent/, ''),
      },
    },
  },
})
