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