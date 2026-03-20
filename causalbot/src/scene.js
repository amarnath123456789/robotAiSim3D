import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { state } from './state.js'

const loader = new GLTFLoader()

export async function initScene() {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.2
  document.body.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x111111)
  scene.fog = new THREE.Fog(0x111111, 12, 30)

  const camera = new THREE.PerspectiveCamera(
    60, window.innerWidth / window.innerHeight, 0.1, 100
  )
  camera.position.set(0, 5, 8)
  camera.lookAt(0, 0, 0)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 0, 0)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxPolarAngle = Math.PI / 2.1
  controls.update()

  // Ambient light
  const ambient = new THREE.AmbientLight(0xffffff, 0.5)
  scene.add(ambient)

  // Main directional light
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2)
  dirLight.position.set(5, 10, 5)
  dirLight.castShadow = true
  dirLight.shadow.mapSize.width = 2048
  dirLight.shadow.mapSize.height = 2048
  dirLight.shadow.camera.near = 0.5
  dirLight.shadow.camera.far = 50
  dirLight.shadow.camera.left = -10
  dirLight.shadow.camera.right = 10
  dirLight.shadow.camera.top = 10
  dirLight.shadow.camera.bottom = -10
  scene.add(dirLight)

  // Fill light
  const fillLight = new THREE.PointLight(0x4466ff, 0.4, 20)
  fillLight.position.set(-4, 3, -4)
  scene.add(fillLight)

  // Load environment GLB
  const envGltf = await loader.loadAsync('/environment.glb')
  scene.add(envGltf.scene)
  envGltf.scene.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true
      child.receiveShadow = true
    }
  })

  // Save to state
  state.scene.threeScene = scene
  state.scene.camera = camera
  state.scene.renderer = renderer
  state.scene.controls = controls

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  console.log('Scene children:', scene.children.length)
}

export function updateScene(delta) {
  state.scene.controls?.update()
  if (state.scene.renderer && state.scene.threeScene && state.scene.camera) {
    state.scene.renderer.render(state.scene.threeScene, state.scene.camera)
  }
}