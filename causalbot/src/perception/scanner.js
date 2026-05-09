import { state, getRobotPos, setRobotPos } from '../state.js'
import { castVision, angleToTarget, isInFOV, normalizeAngle } from './visionSensor.js'
import { updatePerception, findPerceivedObject, getPerceivedSnapshot, perceivedToTarget } from './perceptualMemory.js'

const SCAN_STEP_MS    = 60     // ms between rotation steps
const SCAN_STEP_RAD   = 0.20   // radians rotated per step (~11.5°)
const FULL_SCAN_STEPS = Math.ceil((Math.PI * 2) / SCAN_STEP_RAD) // ≈32 steps

// ─── Robot facing angle ───────────────────────────────────────────────────────

/**
 * Get the AI robot mesh's current facing angle.
 * The root mesh 'aiRobot' is what we rotate during scanning.
 */
export function getFacingAngle() {
  const mesh = state.scene.three?.getObjectByName('aiRobot')
  // Fall back to state if mesh not ready
  return mesh ? mesh.rotation.y : (state.robot.rotation || 0)
}

/**
 * Set the AI robot mesh's facing angle AND update state.
 * Note: updateRobot() lerps rotation toward direction of travel.
 * We lock the target here; since scan steps are short, the lerp catches up.
 */
export function setFacingAngle(angle) {
  const mesh = state.scene.three?.getObjectByName('aiRobot')
  if (mesh) {
    // Set both current rotation and target to prevent lerp fighting
    mesh.rotation.y = angle
  }
  state.robot.rotation = angle
}

// ─── Rotate helper ────────────────────────────────────────────────────────────

/**
 * Smoothly rotate robot to targetAngle, casting vision at each step.
 * @returns {Promise<Array>} all vision hits collected during rotation
 */
export async function rotateTo(targetAngle, onStep) {
  return new Promise(resolve => {
    const allHits = []
    let current = getFacingAngle()

    // Shortest-arc difference
    let diff = normalizeAngle(targetAngle - current)
    const steps    = Math.max(1, Math.ceil(Math.abs(diff) / SCAN_STEP_RAD))
    const stepSize = diff / steps
    let step = 0

    const interval = setInterval(() => {
      step++
      current += stepSize
      setFacingAngle(current)

      const hits = castVision(current)
      updatePerception(hits)
      allHits.push(...hits)
      onStep?.(hits, current)

      if (step >= steps) {
        clearInterval(interval)
        resolve(allHits)
      }
    }, SCAN_STEP_MS)
  })
}

// ─── Full room scan ───────────────────────────────────────────────────────────

/**
 * Full 360° room scan from current position.
 * Rotates through FULL_SCAN_STEPS steps, building perceptual memory.
 * @param {Function} [onProgress] - called with (perceivedSnapshot, currentAngle) each step
 * @returns {Promise<Array>} final perceived snapshot
 */
export async function fullRoomScan(onProgress) {
  setStatus('🔍 Scanning room...')
  const startAngle = getFacingAngle()

  for (let i = 0; i <= FULL_SCAN_STEPS; i++) {
    const angle = startAngle + (i / FULL_SCAN_STEPS) * Math.PI * 2
    setFacingAngle(angle)

    const hits = castVision(angle)
    updatePerception(hits)

    const perceived = getPerceivedSnapshot()
    if (perceived.length > 0) {
      setStatus(`🔍 Scanning... ${perceived.length} object(s) found`)
    }

    onProgress?.(perceived, angle)
    await sleep(SCAN_STEP_MS)
  }

  // Return to original facing
  setFacingAngle(startAngle)

  const final = getPerceivedSnapshot()
  setStatus(`✅ Scan complete. Found ${final.length} object(s).`)
  return final
}

// ─── Scan for specific object ─────────────────────────────────────────────────

/**
 * Scan until a specific object is found or full rotation completes.
 * If object is already in memory with high confidence, skip scan.
 * @returns {Promise<Object|null>} perceived object if found
 */
export async function scanForObject(nameOrId) {
  const label = nameOrId.toLowerCase()
  setStatus(`👁 Looking for "${nameOrId}"...`)

  // Check memory first — if confident, skip physical scan
  const existing = findPerceivedObject(label)
  if (existing && existing.confidence > 0.5) {
    setStatus(`✅ I remember seeing ${existing.name}.`)
    return existing
  }

  // Physical sweep — rotate until found
  const startAngle = getFacingAngle()

  for (let i = 0; i <= FULL_SCAN_STEPS; i++) {
    const angle = startAngle + (i / FULL_SCAN_STEPS) * Math.PI * 2
    setFacingAngle(angle)

    const hits = castVision(angle)
    updatePerception(hits)

    const found = findPerceivedObject(label)
    if (found && found.confidence > 0.35) {
      setStatus(`✅ Found ${found.name}!`)
      // Rotate to face it
      const faceAngle = angleToTarget(found.estimatedPos)
      await rotateTo(faceAngle)
      return found
    }

    await sleep(SCAN_STEP_MS)
  }

  // Return to start
  setFacingAngle(startAngle)
  setStatus(`❌ Could not find "${nameOrId}".`)
  return null
}

// ─── Approach object ──────────────────────────────────────────────────────────

/**
 * Approach a perceived object using pathfinding-compatible navigation.
 * Imports robot.js navigateTo to use A* pathfinding (avoids walls).
 */
export async function approachObject(perceivedObj, stopDistance = 0.35) {
  if (!perceivedObj) return false

  const { navigateTo } = await import('../robot.js')
  const [tx, ty, tz] = perceivedObj.estimatedPos

  setStatus(`🚶 Approaching ${perceivedObj.name}...`)

  return new Promise(resolve => {
    navigateTo(tx, 0.35, tz, () => resolve(true), 2.5)
  })
}

// ─── Look at ─────────────────────────────────────────────────────────────────

/**
 * Rotate robot to face a world position.
 */
export async function lookAt(worldPos) {
  const angle = angleToTarget(worldPos)
  await rotateTo(angle)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function setStatus(text) {
  const el = document.getElementById('status-bar')
  if (el) el.textContent = text
}
