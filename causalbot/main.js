import { initScene, renderScene } from './src/scene.js'
import { initRobot, initDebugRobot, updateRobot, updateDebugRobot } from './src/robot.js'
import { initPhysics, stepPhysics, applyRobotCollisions, stepDebugRobotPhysics } from './src/physics.js'
import { initSkillRegistry } from './src/skillRegistry.js'
import { initUI } from './src/ui.js'
import { initControls, getKeys } from './src/controls.js'
import { getGridDebug } from './src/pathfinder.js'
import { state } from './src/state.js'
import * as THREE from 'three'

const clock = new THREE.Clock()

async function init() {
  console.log('Booting CausalBot...')
  await initScene()
  await initRobot()
  await initDebugRobot()
  await initPhysics()
  // visualiseGrid() // uncomment to see obstacle grid
  initSkillRegistry()
  initControls()
  initUI()
  console.log('All systems ready.')
  animate()
}

function animate() {
  requestAnimationFrame(animate)
  const delta = clock.getDelta()
  const keys = getKeys()

  updateRobot(delta)
  updateDebugRobot(delta)

  stepPhysics(delta)
  stepDebugRobotPhysics(keys, delta)
  
  applyRobotCollisions()
  
  renderScene()
}
 
// Optional: visualise pathfinding grid in Three.js (dev only)
function visualiseGrid() {
  const { grid, cols, rows, cellSize, halfExtent } = getGridDebug()
  const geo = new THREE.PlaneGeometry(cellSize * 0.85, cellSize * 0.85)
  geo.rotateX(-Math.PI / 2)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const blocked = grid[r * cols + c] === 1
      if (!blocked) continue
      const mat  = new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.25 })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(c * cellSize - halfExtent, 0.02, r * cellSize - halfExtent)
      state.scene.three.add(mesh)
    }
  }
}

init().catch(err => console.error('Boot failed:', err))