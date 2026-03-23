import RAPIER from '@dimforge/rapier3d-compat'
import { state } from './state.js'

let world
let eventQueue
let accumulator = 0
const FIXED_STEP = 1 / 60  // 60Hz fixed timestep

export async function initPhysics() {
  await RAPIER.init()

  world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 })
  world.numSolverIterations = 8  // more iterations = more accurate
  eventQueue = new RAPIER.EventQueue(true)

  // Floor — maximum friction, barely bounces
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(10, 0.05, 10)
      .setFriction(0.9)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setRestitution(0.05)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min),
    floor
  )

  // Table top
  const tableTop = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.78, 0)
  )
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.7, 0.04, 0.4)
      .setFriction(0.7)
      .setRestitution(0.1),
    tableTop
  )

  // Table legs — 4 thin pillars so objects slide off correctly
  ;[[-0.65, -0.35], [-0.65, 0.35], [0.65, -0.35], [0.65, 0.35]].forEach(([x, z]) => {
    const leg = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0.38, z)
    )
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.03, 0.38, 0.03).setFriction(0.5),
      leg
    )
  })

  // Room walls — objects bounce off them
  ;[
    { pos: [0, 1.5, -3.0], size: [3.5, 1.5, 0.05] },
    { pos: [0, 1.5,  3.0], size: [3.5, 1.5, 0.05] },
    { pos: [-3.0, 1.5, 0], size: [0.05, 1.5, 3.5] },
    { pos: [ 3.0, 1.5, 0], size: [0.05, 1.5, 3.5] },
  ].forEach(({ pos, size }) => {
    const wb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...pos))
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(...size).setFriction(0.3).setRestitution(0.4),
      wb
    )
  })

  // Objects — each with real-world tuned physics values
  setupObject('object_glass', {
    collider: () => RAPIER.ColliderDesc.cylinder(0.07, 0.04),
    mass: 0.22,
    friction: 0.65,
    restitution: 0.05,       // glass barely bounces
    linearDamping: 0.3,
    angularDamping: 0.5,
    gravityScale: 1.0,
  })

  setupObject('object_box', {
    collider: () => RAPIER.ColliderDesc.cuboid(0.17, 0.17, 0.17),
    mass: 2.8,
    friction: 0.85,           // cardboard is grippy
    restitution: 0.08,
    linearDamping: 0.7,       // heavy, stops quickly
    angularDamping: 0.9,
    gravityScale: 1.0,
  })

  setupObject('object_ball', {
    collider: () => RAPIER.ColliderDesc.ball(0.13),
    mass: 0.45,
    friction: 0.3,            // ball rolls easily
    restitution: 0.82,        // bouncy — like a real ball
    linearDamping: 0.02,      // almost no air resistance
    angularDamping: 0.05,     // keeps spinning
    gravityScale: 1.0,
  })

  state.scene.rapierWorld = world
  console.log('Physics ready — full simulation active')
}

function setupObject(id, cfg) {
  const obj = state.world.objects[id]
  if (!obj) return

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(...obj.position)
      .setLinearDamping(cfg.linearDamping)
      .setAngularDamping(cfg.angularDamping)
      .setGravityScale(cfg.gravityScale)
      .setCcdEnabled(true)   // prevents tunnelling through floor at high speed
  )

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

  obj._body = body
  obj._cfg = cfg
  obj._prevVel = { x: 0, y: 0, z: 0 }
}

export function stepPhysics(delta) {
  if (!world) return

  // Fixed timestep accumulator — decouples physics from frame rate
  // This is the correct way — no jitter, no tunnelling
  accumulator += Math.min(delta, 0.05)  // cap at 50ms to prevent spiral of death
  while (accumulator >= FIXED_STEP) {
    world.step(eventQueue)
    accumulator -= FIXED_STEP
  }

  // Process collision events — detect hard impacts
  eventQueue.drainCollisionEvents((h1, h2, started) => {
    if (!started) return
    checkImpactBreakage()
  })

  // Sync physics world → Three.js meshes
  Object.values(state.world.objects).forEach(obj => {
    if (!obj._body || obj.status === 'held') return

    const t = obj._body.translation()
    const r = obj._body.rotation()
    const v = obj._body.linvel()

    // Check impact speed for breakage (compare velocity change)
    const dvx = v.x - (obj._prevVel?.x || 0)
    const dvy = v.y - (obj._prevVel?.y || 0)
    const dvz = v.z - (obj._prevVel?.z || 0)
    const impactDeltaV = Math.sqrt(dvx*dvx + dvy*dvy + dvz*dvz)

    if (
      impactDeltaV > 4.0 &&
      obj.id === 'object_glass' &&
      obj.status === 'intact'
    ) {
      obj.status = 'broken'
      shatterGlass(obj)
    }

    obj._prevVel = { x: v.x, y: v.y, z: v.z }

    // Reset objects that fall off world
    if (t.y < -3) {
      obj._body.setTranslation({ x: obj.position[0], y: 1.5, z: obj.position[2] }, true)
      obj._body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      obj._body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      obj.status = 'intact'
      const mesh = state.scene.three?.getObjectByName(obj.id)
      if (mesh) mesh.visible = true
      return
    }

    obj.position[0] = t.x
    obj.position[1] = t.y
    obj.position[2] = t.z

    const mesh = state.scene.three?.getObjectByName(obj.id)
    if (mesh) {
      mesh.position.set(t.x, t.y, t.z)
      mesh.quaternion.set(r.x, r.y, r.z, r.w)
    }

    // Sync shards
    obj._shards?.forEach(({ mesh: sm, body: sb }) => {
      if (!sb) return
      const st = sb.translation()
      const sr = sb.rotation()
      sm.position.set(st.x, st.y, st.z)
      sm.quaternion.set(sr.x, sr.y, sr.z, sr.w)
      // Fade out shards over time
      if (sm.material && sm.material.opacity > 0) {
        sm.material.opacity -= 0.002
      }
    })
  })
}

function checkImpactBreakage() {
  const glass = state.world.objects['object_glass']
  if (!glass?._body || glass.status !== 'intact') return
  const v = glass._body.linvel()
  const speed = Math.sqrt(v.x**2 + v.y**2 + v.z**2)
  if (speed > 5) {
    glass.status = 'broken'
    shatterGlass(glass)
  }
}

function shatterGlass(obj) {
  const scene = state.scene.three
  const mesh = scene?.getObjectByName(obj.id)
  if (!mesh) return

  mesh.visible = false
  updateStatus('Glass shattered!')

  obj._shards = []
  for (let i = 0; i < 8; i++) {
    const geo = new (mesh.geometry.constructor)()
    const mat = mesh.material.clone()
    mat.transparent = true
    mat.opacity = 0.9
    mat.color?.set(0x88ccff)

    const shard = new (mesh.constructor)(mesh.geometry.clone(), mat)
    shard.scale.setScalar(0.08 + Math.random() * 0.12)
    shard.position.set(
      obj.position[0] + (Math.random() - 0.5) * 0.2,
      obj.position[1],
      obj.position[2] + (Math.random() - 0.5) * 0.2
    )
    scene.add(shard)

    const shardBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(shard.position.x, shard.position.y, shard.position.z)
        .setLinearDamping(0.5)
        .setAngularDamping(0.3)
    )
    world.createCollider(
      RAPIER.ColliderDesc.ball(0.03).setMass(0.01).setRestitution(0.2),
      shardBody
    )

    // Explode outward with random impulse
    shardBody.applyImpulse({
      x: (Math.random() - 0.5) * 2.5,
      y: 1.5 + Math.random() * 2,
      z: (Math.random() - 0.5) * 2.5
    }, true)
    shardBody.applyTorqueImpulse({
      x: Math.random() - 0.5,
      y: Math.random() - 0.5,
      z: Math.random() - 0.5
    }, true)

    obj._shards.push({ mesh: shard, body: shardBody })
  }
}

export function applyRobotCollisions() {
  if (!world) return
  const rx = state.robot.position[0]
  const ry = state.robot.position[1]
  const rz = state.robot.position[2]

  Object.values(state.world.objects).forEach(obj => {
    if (!obj._body || obj.status === 'held') return
    const op = obj._body.translation()
    const dx = op.x - rx
    const dy = op.y - ry
    const dz = op.z - rz
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz)

    if (dist < 0.5 && dist > 0.001) {
      const force = (0.5 - dist) * 5
      obj._body.wakeUp()
      obj._body.applyImpulse({
        x: (dx/dist) * force,
        y: 0.2,
        z: (dz/dist) * force
      }, true)
    }
  })
}

export function releaseObjectPhysics(objectId, robotPos, forwardAngle = 0) {
  const obj = state.world.objects[objectId]
  if (!obj?._body) return

  obj._body.setBodyType(2)
  obj._body.setTranslation(
    {
      x: robotPos.x + Math.sin(forwardAngle) * 0.5,
      y: robotPos.y + 0.1,
      z: robotPos.z + Math.cos(forwardAngle) * 0.5
    },
    true
  )
  obj._body.setLinvel({ x: 0, y: -0.5, z: 0 }, true)
  obj._body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  obj._body.wakeUp()
}

export function getWorld() { return world }

function updateStatus(text) {
  const el = document.getElementById('status-bar')
  if (el) el.textContent = text
}