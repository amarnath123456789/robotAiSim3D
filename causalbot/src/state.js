export const state = {
  robot: {
    position: { x: 0, y: 0.5, z: 2 },
    status: 'idle',
    armPosition: 'retracted',
    heldObject: null,
    speed: 2.0,
  },
  objects: [
    { id: 'glass', name: 'glass', mass: 0.3,  fragility: 0.8, snapable: true, state: 'intact', position: { x: 0,   y: 0.9, z: 0   } },
    { id: 'box',   name: 'box',   mass: 2.0,  fragility: 0.1, snapable: true, state: 'intact', position: { x: -1,  y: 0.3, z: 1   } },
    { id: 'ball',  name: 'ball',  mass: 0.5,  fragility: 0.2, snapable: true, state: 'intact', position: { x: 0.8, y: 0.2, z: 1.2 } },
  ],
  tree: {
    branches: [],
    selectedBranch: null,
    forcedBranch: null,
    visible: false,
    animating: false,
  },
  memory: [],
  execution: {
    actionQueue: [],
    currentAction: null,
    paused: false,
    cancelled: false,
  },
  scene: {
    threeScene: null,
    camera: null,
    renderer: null,
    controls: null,
    rapierWorld: null,
  }
}