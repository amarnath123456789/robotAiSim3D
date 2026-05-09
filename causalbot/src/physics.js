import RAPIER from '@dimforge/rapier3d-compat'
import { state } from './state.js'
import * as THREE from 'three'

// ─── Physics constants ────────────────────────────────────────────────────────
const FIXED_STEP      = 1 / 60     // 60 Hz fixed timestep
const MAX_SUBSTEPS    = 5          // prevent spiral-of-death (caps at 83ms catchup)
const GRAVITY         = -18.0      // stronger than real-world for snappier game feel
const MOVE_FORCE      = 28.0       // ground acceleration force
const AIR_FORCE       = 8.0        // reduced control in air
const DECEL_FORCE     = 22.0       // braking force when no input (ground)
const MAX_SPEED       = 5.5        // horizontal speed cap
const JUMP_VEL        = 7.5        // jump impulse
const COYOTE_TIME     = 0.12       // seconds after leaving ground you can still jump
const JUMP_BUFFER     = 0.12       // seconds before landing a buffered jump fires

let world
let eventQueue
let accumulator = 0
let debugBody

// Character controller state
const charCtrl = {
  coyoteTimer:  0,
  jumpBuffer:   0,
  wasGrounded:  false,
  isGrounded:   false,
}

// Cleanup tracking for shards
let shardCleanupList = []   // [{ mesh, body, age }]

// ─── World init ───────────────────────────────────────────────────────────────
export async function initPhysics() {
  await RAPIER.init()

  world = new RAPIER.World({ x: 0.0, y: GRAVITY, z: 0.0 })
  world.numSolverIterations = 12   // higher for stiff contacts
  world.numAdditionalFrictionIterations = 4
  eventQueue = new RAPIER.EventQueue(true)

  // ── Floor ──
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(10, 0.05, 10)
      .setFriction(1.0)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setRestitution(0.02)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min),
    floor
  )

  // ── Room walls ──
  const walls = [
    { pos: [0,    1.5, -3.0], size: [3.5, 1.5, 0.05] },
    { pos: [0,    1.5,  3.0], size: [3.5, 1.5, 0.05] },
    { pos: [-3.0, 1.5,  0  ], size: [0.05, 1.5, 3.5] },
    { pos: [ 3.0, 1.5,  0  ], size: [0.05, 1.5, 3.5] },
  ]
  walls.forEach(({ pos, size }) => {
    const wb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...pos))
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(...size).setFriction(0.4).setRestitution(0.35),
      wb
    )
  })

  // ── Helper: best-fit convex hull or fallback ──
  function getBestCollider(id, fallbackDesc) {
    const root = state.scene.three?.getObjectByName(id)
    if (!root) return fallbackDesc
    if (state.scene.three) state.scene.three.updateMatrixWorld(true)

    const vertices = []
    root.traverse(c => {
      if (c.isMesh && c.geometry?.attributes.position) {
        const pos     = c.geometry.attributes.position
        const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert()
        const m       = c !== root
          ? new THREE.Matrix4().copy(c.matrixWorld).premultiply(rootInv)
          : new THREE.Matrix4()
        const v = new THREE.Vector3()
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m)
          vertices.push(v.x, v.y, v.z)
        }
      }
    })

    if (vertices.length >= 9) {
      const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(vertices))
      if (desc) return desc
    }
    return fallbackDesc
  }

  // ── Dynamic scene objects ──
  setupObject('object_glass', {
    collider:       () => getBestCollider('object_glass', RAPIER.ColliderDesc.cylinder(0.07, 0.04)),
    mass:           0.22,
    friction:       0.6,
    restitution:    0.08,
    linearDamping:  0.25,
    angularDamping: 0.4,
  })

  setupObject('object_box', {
    collider:       () => getBestCollider('object_box', RAPIER.ColliderDesc.cuboid(0.17, 0.17, 0.17)),
    mass:           2.8,
    friction:       0.9,
    restitution:    0.06,
    linearDamping:  0.6,
    angularDamping: 0.85,
  })

  setupObject('object_ball', {
    collider:       () => getBestCollider('object_ball', RAPIER.ColliderDesc.ball(0.13)),
    mass:           0.45,
    friction:       0.25,
    restitution:    0.78,
    linearDamping:  0.02,
    angularDamping: 0.04,
  })

  // ── Debug (player-controlled) robot — Dynamic ──
  const drp = state.debugRobot.position
  debugBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(drp[0], drp[1], drp[2])
      .setLinearDamping(0.0)       // we manage deceleration manually
      .setAngularDamping(999.0)    // never tumble
      .setGravityScale(1.0)
      .setCcdEnabled(true)
  )
  debugBody.lockRotations(true, true)  // stay upright

  const dbCollider = getBestCollider('debugRobot', RAPIER.ColliderDesc.capsule(0.15, 0.1))
  dbCollider.setFriction(0.0).setRestitution(0.0)
  world.createCollider(dbCollider, debugBody)
  state.debugRobot._body = debugBody

  // ── AI robot — Kinematic (position driven by navigation) ──
  const arp    = state.robot.position
  const aiBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(arp[0], arp[1], arp[2])
  )
  const aiCollider = getBestCollider('aiRobot', RAPIER.ColliderDesc.capsule(0.15, 0.1))
  aiCollider.setFriction(0.0).setRestitution(0.0)
  world.createCollider(aiCollider, aiBody)
  state.robot._body = aiBody

  state.scene.rapierWorld = world
  console.log('[Physics] Engine ready — game-quality simulation active')
}

// ─── Setup a dynamic scene object ────────────────────────────────────────────
function setupObject(id, cfg) {
  const obj = state.world.objects[id]
  if (!obj) return

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(...obj.position)
      .setLinearDamping(cfg.linearDamping)
      .setAngularDamping(cfg.angularDamping)
      .setGravityScale(1.0)
      .setCcdEnabled(true)
  )
  body.wakeUp()

  world.createCollider(
    cfg.collider()
      .setMass(cfg.mass)
      .setFriction(cfg.friction)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average)
      .setRestitution(cfg.restitution)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body
  )

  obj._body      = body
  obj._cfg       = cfg
  obj._prevVel   = { x: 0, y: 0, z: 0 }
}

// ─── Main physics step (called every animation frame) ────────────────────────
export function stepPhysics(delta) {
  if (!world) return

  // Sync AI robot kinematic body to its visual mesh position
  const aiMesh = state.scene.three?.getObjectByName('aiRobot')
  if (aiMesh && state.robot._body) {
    state.robot._body.setNextKinematicTranslation(aiMesh.position)
    state.robot._body.setNextKinematicRotation(aiMesh.quaternion)
  }

  // Fixed-step accumulator — decoupled from frame rate
  accumulator += Math.min(delta, FIXED_STEP * MAX_SUBSTEPS)
  while (accumulator >= FIXED_STEP) {
    world.step(eventQueue)
    accumulator -= FIXED_STEP
  }
  // Interpolation alpha (for future smooth rendering if needed)
  // const alpha = accumulator / FIXED_STEP

  // Process collision events
  eventQueue.drainCollisionEvents((h1, h2, started) => {
    if (!started) return
    _checkImpactBreakage()
  })

  // ── Sync physics → Three.js ──
  const alpha = accumulator / FIXED_STEP  // interpolation factor

  Object.values(state.world.objects).forEach(obj => {
    if (!obj._body || obj.status === 'held') return

    const t = obj._body.translation()
    const r = obj._body.rotation()
    const v = obj._body.linvel()

    // Impact-velocity breakage check (delta-v method)
    if (obj.id === 'object_glass' && obj.status === 'intact') {
      const dvx = v.x - (obj._prevVel?.x || 0)
      const dvy = v.y - (obj._prevVel?.y || 0)
      const dvz = v.z - (obj._prevVel?.z || 0)
      const impactDeltaV = Math.sqrt(dvx*dvx + dvy*dvy + dvz*dvz)
      if (impactDeltaV > 3.5) {
        obj.status = 'broken'
        _shatterGlass(obj)
      }
    }
    obj._prevVel = { x: v.x, y: v.y, z: v.z }

    // Reset if fallen off world
    if (t.y < -4) {
      obj._body.setTranslation({ x: obj.position[0], y: 1.5, z: obj.position[2] }, true)
      obj._body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      obj._body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      obj.status = 'intact'
      const mesh = state.scene.three?.getObjectByName(obj.id)
      if (mesh) mesh.visible = true
      return
    }

    // Write back to state
    obj.position[0] = t.x
    obj.position[1] = t.y
    obj.position[2] = t.z

    const mesh = state.scene.three?.getObjectByName(obj.id)
    if (mesh) {
      mesh.position.set(t.x, t.y, t.z)
      mesh.quaternion.set(r.x, r.y, r.z, r.w)
    }
  })

  // ── Tick shard fade & cleanup ──
  _tickShards(delta)
}

// ─── Ground detection (with skin tolerance) ──────────────────────────────────
function _isGrounded(body) {
  // Cast a short ray downward from the capsule base
  const pos = body.translation()
  const ray = new RAPIER.Ray({ x: pos.x, y: pos.y, z: pos.z }, { x: 0, y: -1, z: 0 })
  // 0.45 = capsule half-height (0.15) + radius (0.1) + 0.2 tolerance
  const hit = world.castRay(ray, 0.45, true)
  return hit !== null
}

// ─── Debug robot physics step ─────────────────────────────────────────────────
export function stepDebugRobotPhysics(keys, delta) {
  if (!debugBody || state.controlMode !== 'debug') return

  const vel        = debugBody.linvel()
  const grounded   = _isGrounded(debugBody)

  // ── Coyote time ──
  if (grounded) {
    charCtrl.coyoteTimer = COYOTE_TIME
    charCtrl.isGrounded  = true
  } else {
    charCtrl.coyoteTimer = Math.max(0, charCtrl.coyoteTimer - delta)
    charCtrl.isGrounded  = false
  }

  // ── Jump buffer ──
  if (keys.space) {
    charCtrl.jumpBuffer = JUMP_BUFFER
  } else {
    charCtrl.jumpBuffer = Math.max(0, charCtrl.jumpBuffer - delta)
  }

  // ── Gather input direction ──
  const camera  = state.scene.camera
  let inputDir  = new THREE.Vector3()

  if (camera) {
    const fwd   = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    fwd.y = 0
    if (fwd.lengthSq() > 0.0001) fwd.normalize(); else fwd.set(0, 0, -1)

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
    right.y = 0
    if (right.lengthSq() > 0.0001) right.normalize(); else right.set(1, 0, 0)

    if (keys.w) inputDir.addScaledVector(fwd,   1)
    if (keys.s) inputDir.addScaledVector(fwd,  -1)
    if (keys.a) inputDir.addScaledVector(right, -1)
    if (keys.d) inputDir.addScaledVector(right,  1)
  } else {
    if (keys.w) inputDir.z -= 1
    if (keys.s) inputDir.z += 1
    if (keys.a) inputDir.x -= 1
    if (keys.d) inputDir.x += 1
  }

  const hasInput = inputDir.lengthSq() > 0.0001
  if (hasInput) inputDir.normalize()

  // ── Horizontal force-based movement ──
  const forceScale  = grounded ? MOVE_FORCE : AIR_FORCE
  const velXZ       = new THREE.Vector3(vel.x, 0, vel.z)
  const speedXZ     = velXZ.length()

  let fx = 0, fz = 0

  if (hasInput) {
    // Accelerate toward desired direction
    fx = inputDir.x * forceScale
    fz = inputDir.z * forceScale

    // Clamp to max speed — only cancel force in the moving direction
    if (speedXZ > MAX_SPEED) {
      const over = speedXZ - MAX_SPEED
      fx -= (vel.x / speedXZ) * over * forceScale * 0.5
      fz -= (vel.z / speedXZ) * over * forceScale * 0.5
    }
  } else if (grounded) {
    // Braking force
    fx = -vel.x * DECEL_FORCE
    fz = -vel.z * DECEL_FORCE
  }
  // In air with no input: no extra drag (physics handles it)

  debugBody.addForce({ x: fx, y: 0, z: fz }, true)

  // ── Jump (with coyote + buffer) ──
  if (charCtrl.jumpBuffer > 0 && charCtrl.coyoteTimer > 0) {
    debugBody.setLinvel({ x: vel.x, y: JUMP_VEL, z: vel.z }, true)
    charCtrl.coyoteTimer  = 0
    charCtrl.jumpBuffer   = 0
  }

  // ── Variable jump height: cut vertical velocity if space released early ──
  if (!keys.space && vel.y > 2.0 && !grounded) {
    debugBody.addForce({ x: 0, y: -GRAVITY * 0.8, z: 0 }, true)
  }

  // ── Face movement direction (only when moving) ──
  if (hasInput && speedXZ > 0.3) {
    const angle = Math.atan2(inputDir.x, inputDir.z)
    debugBody.setRotation(
      { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) },
      true
    )
  }

  // ── Sync back to state ──
  const t = debugBody.translation()
  const r = debugBody.rotation()
  state.debugRobot.position[0] = t.x
  state.debugRobot.position[1] = t.y
  state.debugRobot.position[2] = t.z
  state.debugRobot.rotation    = 2 * Math.atan2(r.y, r.w)
}

// ─── AI robot pushes dynamic objects on proximity contact ────────────────────
export function applyRobotCollisions() {
  if (!world) return

  const rx = state.robot.position[0]
  const ry = state.robot.position[1]
  const rz = state.robot.position[2]
  const PUSH_RADIUS    = 0.55     // metres
  const PUSH_STRENGTH  = 6.0      // N

  Object.values(state.world.objects).forEach(obj => {
    if (!obj._body || obj.status === 'held') return

    const op = obj._body.translation()
    const dx = op.x - rx
    const dy = op.y - (ry + 0.3)   // aim at mid-height
    const dz = op.z - rz
    const distSq = dx*dx + dz*dz

    if (distSq < PUSH_RADIUS * PUSH_RADIUS) {
      obj._body.wakeUp()

      const dist = Math.sqrt(distSq) + 0.0001
      const falloff = 1 - (dist / PUSH_RADIUS)  // stronger when closer
      const impulse = {
        x: (dx / dist) * PUSH_STRENGTH * falloff * FIXED_STEP,
        y: 0.5 * falloff * FIXED_STEP,
        z: (dz / dist) * PUSH_STRENGTH * falloff * FIXED_STEP,
      }
      obj._body.applyImpulse(impulse, true)
    }
  })
}

// ─── Release held object with a throw impulse ────────────────────────────────
export function releaseObjectPhysics(objectId, robotPos, forwardAngle = 0) {
  const obj = state.world.objects[objectId]
  if (!obj?._body) return

  // Switch back to dynamic
  obj._body.setBodyType(2, true)

  // Place slightly in front of robot
  obj._body.setTranslation(
    {
      x: robotPos.x + Math.sin(forwardAngle) * 0.55,
      y: robotPos.y + 0.25,
      z: robotPos.z + Math.cos(forwardAngle) * 0.55,
    },
    true
  )

  // Gentle forward-and-down placement (not a throw)
  obj._body.setLinvel(
    {
      x: Math.sin(forwardAngle) * 0.5,
      y: -0.3,
      z: Math.cos(forwardAngle) * 0.5,
    },
    true
  )
  obj._body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  obj._body.wakeUp()
}

// ─── Glass shatter ────────────────────────────────────────────────────────────
function _checkImpactBreakage() {
  const glass = state.world.objects['object_glass']
  if (!glass?._body || glass.status !== 'intact') return
  const v     = glass._body.linvel()
  const speed = Math.sqrt(v.x**2 + v.y**2 + v.z**2)
  if (speed > 5) {
    glass.status = 'broken'
    _shatterGlass(glass)
  }
}

function _shatterGlass(obj) {
  const scene = state.scene.three
  const mesh  = scene?.getObjectByName(obj.id)
  if (!mesh) return

  mesh.visible = false
  _updateStatus('Glass shattered!')

  obj._shards = []
  const NUM_SHARDS = 12

  for (let i = 0; i < NUM_SHARDS; i++) {
    const mat = mesh.material.clone()
    mat.transparent = true
    mat.opacity     = 0.85
    mat.color?.set(0x99ddff)

    const shard = new THREE.Mesh(mesh.geometry.clone(), mat)
    const scale = 0.04 + Math.random() * 0.09
    shard.scale.setScalar(scale)
    shard.position.set(
      obj.position[0] + (Math.random() - 0.5) * 0.18,
      obj.position[1] + Math.random() * 0.05,
      obj.position[2] + (Math.random() - 0.5) * 0.18
    )
    shard.rotation.set(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2
    )
    scene.add(shard)

    const sb = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(shard.position.x, shard.position.y, shard.position.z)
        .setLinearDamping(0.6)
        .setAngularDamping(0.5)
        .setGravityScale(1.2)
    )
    world.createCollider(
      RAPIER.ColliderDesc.ball(0.025 + scale * 0.15)
        .setMass(0.008)
        .setRestitution(0.25)
        .setFriction(0.5),
      sb
    )

    // Radial burst impulse
    const angle  = (i / NUM_SHARDS) * Math.PI * 2
    const spread = 0.4 + Math.random() * 0.5
    sb.applyImpulse(
      {
        x: Math.cos(angle) * spread + (Math.random() - 0.5) * 0.3,
        y: 0.8 + Math.random() * 1.4,
        z: Math.sin(angle) * spread + (Math.random() - 0.5) * 0.3,
      },
      true
    )
    sb.applyTorqueImpulse(
      {
        x: (Math.random() - 0.5) * 1.5,
        y: (Math.random() - 0.5) * 1.5,
        z: (Math.random() - 0.5) * 1.5,
      },
      true
    )

    const shardEntry = { mesh: shard, body: sb, age: 0, lifetime: 3.5 + Math.random() * 1.5 }
    obj._shards.push(shardEntry)
    shardCleanupList.push(shardEntry)
  }
}

// ─── Shard fade + deferred cleanup ───────────────────────────────────────────
function _tickShards(delta) {
  if (shardCleanupList.length === 0) return

  const toRemove = []
  shardCleanupList.forEach(s => {
    s.age += delta

    if (s.mesh.material) {
      // Fade starts at 70% of lifetime
      const fadeStart = s.lifetime * 0.7
      if (s.age > fadeStart) {
        s.mesh.material.opacity = Math.max(0, 0.85 * (1 - (s.age - fadeStart) / (s.lifetime - fadeStart)))
      }
    }

    if (s.age >= s.lifetime) {
      toRemove.push(s)
    }
  })

  toRemove.forEach(s => {
    if (s.mesh.parent) {
      state.scene.three.remove(s.mesh)
      s.mesh.geometry.dispose()
      s.mesh.material.dispose()
    }
    if (s.body && world) {
      try { world.removeRigidBody(s.body) } catch (_) {}
    }
    shardCleanupList.splice(shardCleanupList.indexOf(s), 1)
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
export function getWorld() { return world }

function _updateStatus(text) {
  const el = document.getElementById('status-bar')
  if (el) el.textContent = text
}