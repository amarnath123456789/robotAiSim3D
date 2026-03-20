import * as THREE from 'three'
import { state } from './state.js'
import { addMemory } from './memory.js'
import { moveRobotTo, getRobotPosition } from './robot.js'

let currentAction = null
let actionQueue = []
let onComplete = null

export function startExecution(branch) {
  state.robot.status = 'executing'
  actionQueue = flattenBranch(branch)
  state.execution.currentInstruction = branch.action
  setStatus(`Executing: ${branch.action}`)
  runNextAction()
}

function flattenBranch(branch) {
  const actions = []

  // Move to waypoints if any
  if (branch.waypoints?.length > 0) {
    branch.waypoints.forEach(wp => {
      actions.push({ type: 'move_to', x: wp.x, z: wp.z })
    })
  }

  // Arm action based on branch action text
  const actionText = branch.action.toLowerCase()
  if (actionText.includes('grab') || actionText.includes('pick') || actionText.includes('take')) {
    actions.push({ type: 'set_arm', position: 'extended' })
    actions.push({ type: 'set_arm', position: 'down' })
    actions.push({ type: 'snap', target: findNearestSnapable() })
    actions.push({ type: 'set_arm', position: 'retracted' })
  } else if (actionText.includes('place') || actionText.includes('put') || actionText.includes('release')) {
    actions.push({ type: 'set_arm', position: 'down' })
    actions.push({ type: 'release' })
    actions.push({ type: 'set_arm', position: 'retracted' })
  }

  return actions
}

function findNearestSnapable() {
  const rp = getRobotPosition()
  let nearest = null
  let minDist = Infinity

  state.objects.forEach(obj => {
    if (!obj.snapable || obj.state !== 'intact') return
    const dx = obj.position.x - rp.x
    const dz = obj.position.z - rp.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (dist < minDist) {
      minDist = dist
      nearest = obj.id
    }
  })

  return nearest
}

export function runNextAction() {
  if (actionQueue.length === 0) {
    onExecutionComplete('success', 'Action completed successfully')
    return
  }

  currentAction = actionQueue.shift()
  executeAction(currentAction)
}

function executeAction(action) {
  if (action.type === 'move_to') {
    moveRobotTo(action.x, action.z)
    // Wait until robot is close enough then run next
    waitUntilArrived(action.x, action.z, runNextAction)

  } else if (action.type === 'set_arm') {
    state.robot.armPosition = action.position
    setTimeout(runNextAction, 500)

  } else if (action.type === 'snap') {
    snapObject(action.target)
    setTimeout(runNextAction, 400)

  } else if (action.type === 'release') {
    releaseObject()
    setTimeout(runNextAction, 400)

  } else if (action.type === 'wait') {
    setTimeout(runNextAction, action.duration || 600)
  }
}

function waitUntilArrived(targetX, targetZ, callback) {
  const check = setInterval(() => {
    const rp = getRobotPosition()
    const dx = targetX - rp.x
    const dz = targetZ - rp.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (dist < 0.15) {
      clearInterval(check)
      callback()
    }
  }, 50)
}

function snapObject(objectId) {
  if (!objectId) return
  const obj = state.objects.find(o => o.id === objectId)
  if (!obj) return

  obj.state = 'held'
  state.robot.heldObject = objectId

  // Disable physics on held object
  if (obj.rapierBody) {
    obj.rapierBody.setBodyType(0) // 0 = fixed
  }

  console.log(`Snapped: ${objectId}`)
}

function releaseObject() {
  if (!state.robot.heldObject) return
  const obj = state.objects.find(o => o.id === state.robot.heldObject)
  if (!obj) return

  obj.state = 'intact'
  state.robot.heldObject = null

  // Re-enable physics
  if (obj.rapierBody) {
    obj.rapierBody.setBodyType(2) // 2 = dynamic
    obj.rapierBody.setTranslation(
      { x: state.robot.position.x, y: state.robot.position.y + 0.3, z: state.robot.position.z },
      true
    )
  }

  console.log('Object released')
}

function onExecutionComplete(outcome, detail) {
  state.robot.status = 'idle'
  state.robot.armPosition = 'retracted'
  addMemory(
    state.execution.currentInstruction || 'unknown',
    outcome,
    detail,
    state.robot.heldObject ? [state.robot.heldObject] : []
  )
  setStatus(outcome === 'success' ? 'Done.' : `Failed: ${detail}`)
}

function setStatus(text) {
  const el = document.getElementById('status')
  if (el) el.textContent = text
}