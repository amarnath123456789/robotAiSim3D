import { state } from './state.js'
import { buildTree, executeBranch, getTreeMeshes } from './tree.js'
import * as THREE from 'three'

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

export function initUI() {
  const input = document.getElementById('instruction')

  // Submit instruction on Enter
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return
    const text = input.value.trim()
    if (!text) return
    if (state.robot.status === 'executing') return

    input.value = ''
    state.execution.currentInstruction = text
    await buildTree(text)
  })

  // Click on tree branches
  window.addEventListener('click', (e) => {
    if (!state.tree.visible) return

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1

    raycaster.setFromCamera(mouse, state.scene.camera)
    const meshes = getTreeMeshes()
    const hits = raycaster.intersectObjects(meshes)

    if (hits.length > 0) {
      const branch = hits[0].object.userData.branch
      if (branch) {
        console.log('Branch forced:', branch.action)
        const instruction = state.execution.currentInstruction
        buildTree(instruction, branch.action)
      }
    }
  })

  // Hover tooltip on branches
  window.addEventListener('mousemove', (e) => {
    if (!state.tree.visible) return

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1

    raycaster.setFromCamera(mouse, state.scene.camera)
    const meshes = getTreeMeshes()
    const hits = raycaster.intersectObjects(meshes)

    const tooltip = document.getElementById('tooltip')
    if (hits.length > 0) {
      const b = hits[0].object.userData.branch
      tooltip.style.display = 'block'
      tooltip.style.left = (e.clientX + 12) + 'px'
      tooltip.style.top = (e.clientY - 10) + 'px'
      tooltip.innerHTML = `
        <strong>${b.action}</strong><br/>
        ${b.outcome}<br/>
        Risk: ${b.risk} &nbsp;·&nbsp; Confidence: ${Math.round(b.confidence * 100)}%
      `
    } else {
      tooltip.style.display = 'none'
    }
  })

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') resetScene()
    if (e.key === ' ') togglePause()
    if (e.key === 'Escape') cancelExecution()
  })

  setStatus('Ready')
}

function resetScene() {
  state.objects.forEach(obj => {
    if (obj.rapierBody) {
      obj.rapierBody.setTranslation(
        { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        true
      )
      obj.rapierBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
    }
    obj.state = 'intact'
  })
  state.robot.status = 'idle'
  setStatus('Scene reset.')
}

function togglePause() {
  state.execution.paused = !state.execution.paused
  setStatus(state.execution.paused ? 'Paused' : 'Resumed')
}

function cancelExecution() {
  state.execution.cancelled = true
  state.execution.actionQueue = []
  state.robot.status = 'idle'
  setStatus('Cancelled.')
}

function setStatus(text) {
  const el = document.getElementById('status')
  if (el) el.textContent = text
}