import * as THREE from 'three'
import { initScene, updateScene } from './src/scene.js'
import { initRobot, updateRobot } from './src/robot.js'
import { initPhysics, stepPhysics } from './src/physics.js'
import { initUI } from './src/ui.js'
import { state } from './src/state.js'

const clock = new THREE.Clock()

async function init() {
  console.log('Initialising CausalBot...')
  await initPhysics()
  console.log('Physics ready')
  await initScene()
  console.log('Scene ready')
  await initRobot()
  console.log('Robot ready')
  initUI()
  console.log('UI ready')
  animate()
}

function animate() {
  requestAnimationFrame(animate)
  const delta = clock.getDelta()
  stepPhysics(delta)
  updateRobot(delta)
  updateScene(delta)
}

init().catch(err => console.error('INIT FAILED:', err))