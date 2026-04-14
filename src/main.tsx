import { render } from 'preact'
import { App } from './app/App'
import './styles/globals.css'

render(<App />, document.getElementById('app')!)

// Dismiss the loader once the app has rendered.
// Keep it visible for at least BOOT_MS so the boot sequence animation
// always plays through to "ALL SYSTEMS GO" before the app takes over.
const BOOT_MS = 3700
const elapsed = Date.now() - ((window as any).__loadStart ?? Date.now())
const remaining = Math.max(0, BOOT_MS - elapsed)

setTimeout(() => {
  const loader = document.getElementById('loader')
  if (!loader) return
  loader.classList.add('ld-hide')
  loader.addEventListener('animationend', () => loader.remove(), { once: true })
}, remaining)
