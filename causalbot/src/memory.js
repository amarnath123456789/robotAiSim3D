import { state } from './state.js'

export function remember(instruction, outcome, detail) {
  state.memory.unshift({ instruction, outcome, detail, ts: Date.now() })
  if (state.memory.length > 10) state.memory.length = 10
  renderMemoryLog()
}

export function getMemorySummary() {
  if (!state.memory.length) return 'No history yet.'
  return state.memory.slice(0, 5)
    .map(m => `[${m.outcome}] "${m.instruction}" — ${m.detail}`)
    .join('\n')
}

function renderMemoryLog() {
  const el = document.getElementById('memory-log')
  if (!el) return
  el.innerHTML = state.memory.slice(0, 5).map(m => `
    <div class="memory-item ${m.outcome}">
      ${m.outcome === 'success' ? '✓' : '✗'} ${m.instruction}
    </div>
  `).join('')
}