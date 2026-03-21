import RAPIER from '@dimforge/rapier3d-compat'
import { state } from './state.js'

let world

export async function initPhysics() {
  await RAPIER.init()
  world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 })

  // Floor
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.1, 10), floor)

  // Table surface
  const table = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.8, 0)
  )
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.7, 0.05, 0.4), table)

  // Dynamic objects
  Object.values(state.world.objects).forEach(obj => {
    if (!obj.snapable) return
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(...obj.position)
        .setLinearDamping(0.8)
        .setAngularDamping(0.8)
    )
    const half = obj.size.map(s => s / 2)
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(...half).setMass(obj.mass),
      body
    )
    obj._body = body
  })

  state.scene.rapierWorld = world
  console.log('Physics ready')
}

export function stepPhysics() {
  if (!world) return
  world.step()

  Object.values(state.world.objects).forEach(obj => {
    if (!obj._body || obj.status === 'held') return
    const t = obj._body.translation()
    const r = obj._body.rotation()
    obj.position[0] = t.x
    obj.position[1] = t.y
    obj.position[2] = t.z

    const mesh = state.scene.three?.getObjectByName(obj.id)
    if (mesh) {
      mesh.position.set(t.x, t.y, t.z)
      mesh.quaternion.set(r.x, r.y, r.z, r.w)
    }

    // Break check
    const v = obj._body.linvel()
    const speed = Math.hypot(v.x, v.y, v.z)
    if (speed > 5 && obj.fragility > 0.5 && obj.status === 'intact') {
      obj.status = 'broken'
      setStatus(`${obj.name} broke!`)
    }
  })
}

export function getWorld() { return world }