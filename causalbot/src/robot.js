import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { state } from './state.js'

const loader = new GLTFLoader()

let robotRoot = null
let armMesh = null
let eyeMaterial = null

const ARM_ROTATIONS = {
  retracted: { x: 0,    z: 0    },
  extended:  { x: 0,    z: -0.3 },
  down:      { x: 0,    z: -0.8 },
}

const EYE_COLORS = {
  idle:      new THREE.Color(0x4488ff),
  thinking:  new THREE.Color(0xffaa00),
  executing: new THREE.Color(0x00ff88),
  failed:    new THREE.Color(0xff3333),
}

export async function initRobot() {
  const gltf = await loader.loadAsync('/robot.glb')
  robotRoot = gltf.scene
  state.scene.threeScene.add(robotRoot)

  robotRoot.position.set(
    state.robot.position.x,
    state.robot.position.y,
    state.robot.position.z
  )

  // Log all object names to help identify parts
  console.log('Robot objects:')
  robotRoot.traverse(child => {
    if (child.isMesh) {
      console.log(' -', child.name, child.material?.name)
      child.castShadow = true
    }
  })

  // Find arm by name — update 'robot_arm' to match your Blender name
  armMesh = robotRoot.getObjectByName('robot_arm')
  if (!armMesh) console.warn('Arm not found — check name in Blender outliner')

  // Find eye material — update 'robot_eye' to match your Blender name
  const eyeMesh = robotRoot.getObjectByName('robot_eye')
  if (eyeMesh) {
    eyeMaterial = eyeMesh.material.clone()
    eyeMesh.material = eyeMaterial
    eyeMaterial.emissive = EYE_COLORS.idle.clone()
    eyeMaterial.emissiveIntensity = 2
  } else {
    console.warn('Eye not found — check name in Blender outliner')
  }

  console.log('Robot loaded at', robotRoot.position)
}

export function updateRobot(delta) {
  if (!robotRoot) return
  smoothMoveRobot()
  updateArmRotation()
  updateEyeColor()
}

function smoothMoveRobot() {
  robotRoot.position.x = THREE.MathUtils.lerp(
    robotRoot.position.x, state.robot.position.x, 0.06
  )
  robotRoot.position.z = THREE.MathUtils.lerp(
    robotRoot.position.z, state.robot.position.z, 0.06
  )
  robotRoot.position.y = state.robot.position.y

  // Rotate to face direction of travel
  const dx = state.robot.position.x - robotRoot.position.x
  const dz = state.robot.position.z - robotRoot.position.z
  if (Math.abs(dx) + Math.abs(dz) > 0.01) {
    const targetAngle = Math.atan2(dx, dz)
    robotRoot.rotation.y = THREE.MathUtils.lerp(
      robotRoot.rotation.y, targetAngle, 0.1
    )
  }
}

function updateArmRotation() {
  if (!armMesh) return
  const target = ARM_ROTATIONS[state.robot.armPosition]
  armMesh.rotation.x = THREE.MathUtils.lerp(armMesh.rotation.x, target.x, 0.08)
  armMesh.rotation.z = THREE.MathUtils.lerp(armMesh.rotation.z, target.z, 0.08)
}

function updateEyeColor() {
  if (!eyeMaterial) return
  const target = EYE_COLORS[state.robot.status] || EYE_COLORS.idle
  eyeMaterial.emissive.lerp(target, 0.08)
}

export function moveRobotTo(x, z) {
  state.robot.position.x = x
  state.robot.position.z = z
}

export function getRobotPosition() {
  if (!robotRoot) return { x: 0, y: 0, z: 0 }
  return {
    x: robotRoot.position.x,
    y: robotRoot.position.y,
    z: robotRoot.position.z
  }
}