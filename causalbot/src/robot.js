import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { state, getRobotPos, setRobotPos } from './state.js'

const loader = new GLTFLoader()
let root, armMesh, handMesh, eyeMesh
let heldMeshParentedId = null

export async function initRobot() {
  const gltf = await loader.loadAsync('/robot1.glb')
  root = gltf.scene

  root.traverse(c => {
    if (!c.isMesh) return
    c.castShadow = true
    console.log('Robot mesh:', c.name)
    if (c.name === 'robot_arm')  armMesh  = c
    if (c.name === 'robot_hand') handMesh = c
    if (c.name === 'robot_eye')  eyeMesh  = c
  })

  if (armMesh && handMesh && handMesh.parent !== armMesh) {
    armMesh.attach(handMesh)
  }

  const p = getRobotPos()
  root.position.set(p.x, p.y, p.z)
  state.scene.three.add(root)

  console.log('Robot ready. arm:', !!armMesh, 'eye:', !!eyeMesh)
}

export function updateRobot(delta) {
  if (!root) return

  const target = getRobotPos()

  // Smooth position follow
  root.position.x = THREE.MathUtils.lerp(root.position.x, target.x, 0.08)
  root.position.y = THREE.MathUtils.lerp(root.position.y, target.y, 0.08)
  root.position.z = THREE.MathUtils.lerp(root.position.z, target.z, 0.08)

  // Face direction of travel
  const dx = target.x - root.position.x
  const dz = target.z - root.position.z
  if (Math.abs(dx) + Math.abs(dz) > 0.005) {
    const angle = Math.atan2(dx, dz)
    root.rotation.y = THREE.MathUtils.lerp(root.rotation.y, angle, 0.12)
  }

  // Arm follows state
  if (armMesh) {
    armMesh.rotation.x = THREE.MathUtils.lerp(
      armMesh.rotation.x, state.robot.armAngle, 0.1
    )
  }

  // Eye color follows status
  if (eyeMesh?.material) {
    const targetColor = new THREE.Color(state.robot.eyeColor)
    const materials = Array.isArray(eyeMesh.material) ? eyeMesh.material : [eyeMesh.material]
    const pulse = state.robot.status === 'thinking'
      ? 1.8 + Math.sin(performance.now() * 0.01) * 0.6
      : 0.7

    materials.forEach(material => {
      if (material.emissive) {
        material.emissive.lerp(targetColor, 0.15)
        if (typeof material.emissiveIntensity === 'number') {
          material.emissiveIntensity = THREE.MathUtils.lerp(material.emissiveIntensity, pulse, 0.2)
        }
      } else {
        material.color?.lerp(targetColor, 0.1)
      }
    })
  }

  // Hold object — move with robot
  if (state.robot.heldObject) {
    const obj = state.world.objects[state.robot.heldObject]
    const mesh = state.scene.three?.getObjectByName(state.robot.heldObject)
    if (obj && mesh && handMesh) {
      if (mesh.parent !== handMesh) {
        handMesh.attach(mesh)
      }
      mesh.position.set(0, 0, 0)

      const wp = new THREE.Vector3()
      mesh.getWorldPosition(wp)
      obj.position[0] = wp.x
      obj.position[1] = wp.y
      obj.position[2] = wp.z

      heldMeshParentedId = obj.id
    }
  } else if (heldMeshParentedId && state.scene.three) {
    const releasedMesh = state.scene.three.getObjectByName(heldMeshParentedId)
    if (releasedMesh && releasedMesh.parent !== state.scene.three) {
      state.scene.three.attach(releasedMesh)
    }
    heldMeshParentedId = null
  }
}

// Navigation — move robot to world position over time
export function navigateTo(x, y, z, onArrived, speed = 2.5) {
  const FLOAT_Y = 0.35  // robot sits on the ground at this height
  const interval = setInterval(() => {
    const p = getRobotPos()
    const tx = x
    const ty = FLOAT_Y  // ignore Y from caller, always on ground
    const tz = z
    const dx = tx - p.x
    const dy = ty - p.y
    const dz = tz - p.z
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz)

    if (dist < 0.12) {
      clearInterval(interval)
      onArrived?.()
      return
    }

    const step = Math.min(speed * 0.016, dist)
    const n = step / dist
    setRobotPos(p.x + dx*n, p.y + dy*n, p.z + dz*n)
  }, 16)

  return () => clearInterval(interval)
}

// Instant teleport (for jumps/special moves)
export function setRobotPosition(x, y, z) {
  setRobotPos(x, y, z)
}

export function getRobotMesh() { return root }