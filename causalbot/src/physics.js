import RAPIER from '@dimforge/rapier3d-compat'
import { state } from './state.js'

let world = null

export async function initPhysics() {
  await RAPIER.init()

  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })

  // Static floor
  const floorBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0)
  )
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(10, 0.05, 10), floorBody
  )

  // Static table top
  const tableBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.78, 0)
  )
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.8, 0.04, 0.5), tableBody
  )

  // Dynamic objects
  state.objects.forEach(obj => {
    const rigidBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(obj.position.x, obj.position.y, obj.position.z)
        .setLinearDamping(0.5)
        .setAngularDamping(0.5)
    )

    let colliderDesc
    if (obj.id === 'ball') {
      colliderDesc = RAPIER.ColliderDesc.ball(0.12)
    } else if (obj.id === 'glass') {
      colliderDesc = RAPIER.ColliderDesc.cylinder(0.08, 0.04)
    } else {
      colliderDesc = RAPIER.ColliderDesc.cuboid(0.18, 0.18, 0.18)
    }

    colliderDesc.setMass(obj.mass).setRestitution(obj.id === 'ball' ? 0.6 : 0.1)
    world.createCollider(colliderDesc, rigidBody)
    obj.rapierBody = rigidBody
  })

  state.scene.rapierWorld = world
  console.log('Rapier physics ready')
}

export function stepPhysics(delta) {
  if (!world) return
  world.step()
  syncPhysicsToScene()
}

function syncPhysicsToScene() {
  state.objects.forEach(obj => {
    if (!obj.rapierBody) return
    if (obj.state === 'held') return

    const pos = obj.rapierBody.translation()
    const rot = obj.rapierBody.rotation()

    obj.position.x = pos.x
    obj.position.y = pos.y
    obj.position.z = pos.z

    // Sync Three.js mesh
    const mesh = state.scene.threeScene?.getObjectByName(obj.id)
    if (mesh) {
      mesh.position.set(pos.x, pos.y, pos.z)
      mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w)
    }

    // Break fragile objects on hard impact
    const vel = obj.rapierBody.linvel()
    const speed = Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2)
    if (speed > 4 && obj.fragility > 0.5 && obj.state === 'intact') {
      obj.state = 'broken'
      console.warn(`${obj.name} broke from impact!`)
      // Visual feedback — turn mesh red
      const brokenMesh = state.scene.threeScene?.getObjectByName(obj.id)
      if (brokenMesh?.material) {
        brokenMesh.material = brokenMesh.material.clone()
        brokenMesh.material.color.set(0xff2222)
      }
    }
  })
}

export function getObjectBody(id) {
  return state.objects.find(o => o.id === id)?.rapierBody
}