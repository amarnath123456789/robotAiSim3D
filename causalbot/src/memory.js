import { state } from './state.js'

const MAX_MEMORY = 10

export function addMemory(instruction, outcome, detail, objectsInvolved = []) {
  state.memory.unshift({
    instruction,
    outcome,
    detail,
    objectsInvolved,
    timestamp: Date.now()
  })

  if (state.memory.length > MAX_MEMORY) {
    state.memory = state.memory.slice(0, MAX_MEMORY)
  }

  updateMemoryUI()
}

export function getMemorySummary() {
  if (state.memory.length === 0) return 'No previous actions.'

  return state.memory
    .slice(0, 5)
    .map(m => `- "${m.instruction}" → ${m.outcome}: ${m.detail}`)
    .join('\n')
}

function updateMemoryUI() {
  const log = document.getElementById('memory-log')
  if (!log) return
  log.innerHTML = state.memory
    .slice(0, 6)
    .map(m => `
      <div class="memory-item ${m.outcome}">
        ${m.outcome === 'success' ? '✓' : '✗'} ${m.instruction}
      </div>
    `).join('')
}