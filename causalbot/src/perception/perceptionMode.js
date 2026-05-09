import { state, getObject } from '../state.js'
import { fullRoomScan, scanForObject, approachObject, getFacingAngle, lookAt } from './scanner.js'
import { getPerceivedSnapshot, findPerceivedObject, clearPerception, perceivedToTarget } from './perceptualMemory.js'
import { castVision } from './visionSensor.js'
import { updatePerception } from './perceptualMemory.js'
import { setStatus, setAgentStatus } from '../ui.js'

// ─── Mode state ───────────────────────────────────────────────────────────────

export function getPerceptionMode() {
  return state.perceptionMode || 'omniscient'
}

export function setPerceptionMode(mode) {
  if (mode !== 'omniscient' && mode !== 'vision') return
  state.perceptionMode = mode
  if (mode === 'vision') {
    clearPerception()
    setStatus('👁 Vision mode: I must physically look to know where things are.')
  } else {
    setStatus('🧠 Omniscient mode: full world access restored.')
  }
  updateModeIndicator()
}

export function togglePerceptionMode() {
  setPerceptionMode(getPerceptionMode() === 'omniscient' ? 'vision' : 'omniscient')
}

// ─── Unified world snapshot ───────────────────────────────────────────────────

/**
 * Returns the world object list for the current mode.
 * Omniscient → ground truth, Vision → perceptual memory snapshot.
 */
export function getObjectsForPlanner() {
  if (getPerceptionMode() === 'omniscient') {
    return Object.values(state.world.objects)
      .filter(o => o.status !== 'broken')
      .map(o => ({
        id: o.id, n: o.name,
        p:  o.position.map(v => +v.toFixed(1)),
        st: o.status, m: o.mass, fr: o.fragility, sn: o.snapable,
        confidence: 1.0,
      }))
  }

  // Vision mode — do a quick forward-facing cast to keep memory fresh before planning
  const facing = getFacingAngle()
  const hits   = castVision(facing)
  updatePerception(hits)

  return getPerceivedSnapshot()
}

// ─── Unified object resolver ──────────────────────────────────────────────────

/**
 * Resolve an object reference for skill execution.
 *
 * Omniscient → looks up state.world.objects directly.
 * Vision → searches perceptual memory, triggers physical scan if not found,
 *          then wraps result via perceivedToTarget() so skills get `.position`.
 */
export async function resolveObject(nameOrId) {
  if (!nameOrId) return null

  if (getPerceptionMode() === 'omniscient') {
    return getObject(nameOrId)
  }

  // Vision mode
  let perceived = findPerceivedObject(nameOrId)

  if (!perceived || perceived.confidence < 0.3) {
    // Not confident enough — physically scan for it
    perceived = await scanForObject(nameOrId)
  }

  if (!perceived) return null

  // Wrap so skills see .position/.id/.name like ground-truth objects
  return perceivedToTarget(perceived)
}

// ─── Pre-action hook ──────────────────────────────────────────────────────────

/**
 * In vision mode: ensure we have a world model before planning.
 * Triggers a full 360° scan if perceptual memory is empty.
 */
export async function ensureWorldModel() {
  if (getPerceptionMode() === 'omniscient') return

  const perceived = getPerceivedSnapshot()
  if (perceived.length === 0) {
    await fullRoomScan()
  }
}

// ─── Vision context for skills ────────────────────────────────────────────────

/**
 * Extra context properties injected into skill context in vision mode.
 * Lets LLM-invented skills call scanning APIs.
 */
export function getVisionContextAdditions() {
  const isVision = getPerceptionMode() === 'vision'

  // Always expose scan APIs — skills work in both modes
  // (in omniscient mode scanForObject still physically rotates the robot)
  return {
    isVisionMode:   isVision,
    scanForObject:  name        => scanForObject(name),
    fullScan:       ()          => fullRoomScan(),
    approachObject: (obj, dist) => approachObject(obj, dist),
    lookAt:         pos         => lookAt(pos),
    getPerceived:   ()          => getPerceivedSnapshot(),
    findPerceived:  name        => findPerceivedObject(name),
  }
}

// ─── UI ───────────────────────────────────────────────────────────────────────

function updateModeIndicator() {
  const el = document.getElementById('perception-mode-indicator')
  if (!el) return
  const isVision = getPerceptionMode() === 'vision'
  el.textContent       = isVision ? '👁 Vision' : '🧠 Omniscient'
  el.style.borderColor = isVision ? '#FAC775' : '#4488ff'
  el.style.color       = isVision ? '#FAC775' : '#4488ff'
  el.style.boxShadow   = isVision
    ? '0 0 8px rgba(250,199,117,0.4)'
    : '0 0 8px rgba(68,136,255,0.4)'
}


// Kick off indicator on load (so it reflects persisted state)
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', updateModeIndicator)
}
