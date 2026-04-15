import { state } from './state.js'
import { handleInstruction } from './executor.js'

export function initUI() {
  const input = document.getElementById('instruction')

  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return
    const text = input.value.trim()
    if (!text) return
    if (state.execution.running) return

    input.value = ''
    input.disabled = true
    await handleInstruction(text)
    input.disabled = false
    input.focus()
  })

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      state.execution.running = false
      state.robot.status = 'idle'
      document.getElementById('status-bar').textContent = 'Cancelled.'
    }
  })

  console.log('UI ready')
}

let thoughtTimeout = null

export function showThought(text) {
  const el = document.getElementById('thought-bubble')
  if (!el) return

  clearTimeout(thoughtTimeout)
  el.textContent = text
  el.classList.add('visible')

  // Auto-hide after 8 seconds if not cleared earlier
  thoughtTimeout = setTimeout(() => {
    el.classList.remove('visible')
  }, 8000)
}

export function clearThought() {
  const el = document.getElementById('thought-bubble')
  if (el) el.classList.remove('visible')
}