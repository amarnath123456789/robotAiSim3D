import * as THREE from 'three'
import { state } from './state.js'
import { generateConsequenceTree } from './llm.js'
import { startExecution } from './executor.js'

let treeGroup = null
const branchMeshes = []

const RISK_COLORS = {
  low:    new THREE.Color(0x1D9E75),
  medium: new THREE.Color(0xEF9F27),
  high:   new THREE.Color(0xE24B4A),
}

export async function buildTree(instruction, forcedBranch = null) {
  clearTree()

  const branches = await generateConsequenceTree(instruction, forcedBranch)
  if (!branches) return

  state.tree.visible = true
  state.tree.branches = branches

  treeGroup = new THREE.Group()
  state.scene.threeScene.add(treeGroup)

  const origin = new THREE.Vector3(
    state.robot.position.x,
    state.robot.position.y + 0.6,
    state.robot.position.z
  )

  renderBranches(branches, origin, 0, Math.PI * 2, 0)
  setStatus('Choose a branch or wait 3 seconds...')

  // Auto pick best branch after 3 seconds
  setTimeout(() => {
    if (state.tree.visible) {
      const best = getBestBranch(branches)
      if (best) executeBranch(best)
    }
  }, 3000)
}

function renderBranches(branches, origin, angleStart, angleRange, depth) {
  const radius = 1.8 - depth * 0.4
  const angleStep = angleRange / branches.length

  branches.forEach((branch, i) => {
    const angle = angleStart + angleStep * i + angleStep / 2
    const end = new THREE.Vector3(
      origin.x + Math.cos(angle) * radius,
      origin.y + 0.3 - depth * 0.2,
      origin.z + Math.sin(angle) * radius
    )

    const color = RISK_COLORS[branch.risk] || RISK_COLORS.low
    const tube = createBranchTube(origin, end, color, branch.confidence)

    tube.userData.branch = branch
    tube.userData.instruction = state.execution.currentInstruction
    treeGroup.add(tube)
    branchMeshes.push(tube)

    // Recursively render children
    if (branch.children?.length > 0) {
      renderBranches(branch.children, end, angle - angleStep / 2, angleStep, depth + 1)
    }
  })
}

function createBranchTube(start, end, color, confidence) {
  const points = [start, end]
  const curve = new THREE.CatmullRomCurve3(points)
  const geometry = new THREE.TubeGeometry(curve, 8, 0.02 + confidence * 0.03, 6, false)
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.3 + confidence * 0.4,
  })
  return new THREE.Mesh(geometry, material)
}

function getBestBranch(branches) {
  return branches.reduce((best, b) =>
    b.confidence > (best?.confidence || 0) ? b : best, null
  )
}

export function executeBranch(branch) {
  clearTree()
  startExecution(branch)
}

export function clearTree() {
  if (treeGroup) {
    state.scene.threeScene.remove(treeGroup)
    treeGroup = null
  }
  branchMeshes.length = 0
  state.tree.visible = false
  state.tree.branches = []
}

export function getTreeMeshes() {
  return branchMeshes
}

function setStatus(text) {
  const el = document.getElementById('status')
  if (el) el.textContent = text
}