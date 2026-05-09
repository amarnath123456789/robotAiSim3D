/**
 * The robot's internal world model.
 * Built from vision observations, NOT from state.world.objects.
 * Entries decay in confidence if not recently seen.
 */

const CONFIDENCE_DECAY_RATE = 0.04   // per second — slow enough to be usable
const MIN_CONFIDENCE        = 0.08   // below this = "I vaguely think it was there"
const FORGET_THRESHOLD      = 0.0    // below this = forgotten entirely

/** @type {Map<string, PerceivedObject>} */
const perceivedObjects = new Map()
let lastUpdateTime = Date.now()

export function updatePerception(visionHits) {
  const now = Date.now()
  const dt  = Math.min((now - lastUpdateTime) / 1000, 1.0) // cap at 1s to avoid jump decay
  lastUpdateTime = now

  // Decay all existing entries
  perceivedObjects.forEach((obj, key) => {
    obj.confidence -= CONFIDENCE_DECAY_RATE * dt
    obj.lastSeen   += dt
    if (obj.confidence <= FORGET_THRESHOLD) {
      perceivedObjects.delete(key)
    }
  })

  // Merge new hits into memory
  visionHits.forEach(hit => {
    const existing = perceivedObjects.get(hit.meshName)
    if (existing) {
      // Weighted position blend — more confident new hits shift estimate more
      const alpha = hit.confidence * 0.6
      existing.estimatedPos = existing.estimatedPos.map(
        (v, i) => v * (1 - alpha) + hit.estimatedPos[i] * alpha
      )
      // Confidence recovery capped at 1.0
      existing.confidence = Math.min(1.0, existing.confidence + hit.confidence * 0.4)
      existing.lastSeen   = 0
      existing.distance   = hit.distance
    } else {
      perceivedObjects.set(hit.meshName, {
        meshName:     hit.meshName,
        name:         inferName(hit.meshName),
        estimatedPos: [...hit.estimatedPos],
        confidence:   hit.confidence,
        distance:     hit.distance,
        lastSeen:     0,
        properties:   inferProperties(hit.meshName),
      })
    }
  })
}

/**
 * Get snapshot of perceived world for LLM planner.
 * Returns objects above MIN_CONFIDENCE, sorted by confidence desc.
 */
export function getPerceivedSnapshot() {
  const objs = []
  perceivedObjects.forEach(obj => {
    if (obj.confidence < MIN_CONFIDENCE) return
    objs.push({
      // Match omniscient format as closely as possible so LLM gets consistent fields
      id:         obj.meshName,
      n:          obj.name,
      p:          obj.estimatedPos.map(v => +v.toFixed(2)),
      st:         'intact',          // perceived objects are assumed intact unless told otherwise
      m:          obj.properties.heavy    ? 2.5 : 0.5,
      fr:         obj.properties.fragile  ? 0.8 : 0.1,
      sn:         obj.properties.snapable,
      confidence: +obj.confidence.toFixed(2),
      lastSeen:   +obj.lastSeen.toFixed(1),
      dist:       +obj.distance.toFixed(2),
    })
  })
  return objs.sort((a, b) => b.confidence - a.confidence)
}

/**
 * Find a perceived object by name or mesh id (case-insensitive substring match).
 * Returns highest-confidence match.
 */
export function findPerceivedObject(nameOrId) {
  const lower = nameOrId.toLowerCase()
  let best = null
  perceivedObjects.forEach(obj => {
    const matchMesh = obj.meshName.toLowerCase().includes(lower)
    const matchName = obj.name.toLowerCase().includes(lower)
    const matchRev  = lower.includes(obj.name.toLowerCase()) && obj.name.length > 2
    if (matchMesh || matchName || matchRev) {
      if (!best || obj.confidence > best.confidence) best = obj
    }
  })
  return best
}

/**
 * Get a raw perceived object from map (by meshName exact)
 */
export function getPerceivedByMeshName(meshName) {
  return perceivedObjects.get(meshName) || null
}

export function clearPerception() {
  perceivedObjects.clear()
  lastUpdateTime = Date.now()
}

export function getPerceivedCount() {
  return perceivedObjects.size
}

// ─── Convert perceived object to skill-compatible "target" ────────────────────

/**
 * Perceived objects use `estimatedPos`, but skills use `target.position`.
 * This adapter bridges the gap so pick_up / go_to work in vision mode.
 */
export function perceivedToTarget(obj) {
  if (!obj) return null
  return {
    // Core fields skills expect
    id:       obj.meshName,
    name:     obj.name,
    position: obj.estimatedPos,       // ← skills read .position[0/1/2]
    status:   'intact',
    snapable: obj.properties?.snapable ?? true,
    mass:     obj.properties?.heavy    ? 2.5 : 0.5,
    fragility:obj.properties?.fragile  ? 0.8 : 0.1,
    // Vision extras
    estimatedPos: obj.estimatedPos,
    confidence:   obj.confidence,
    _isPerceived: true,
  }
}

// ─── Inference helpers ────────────────────────────────────────────────────────

function inferName(meshName) {
  const lower = meshName.toLowerCase()
  if (lower.includes('glass'))  return 'glass'
  if (lower.includes('ball'))   return 'ball'
  if (lower.includes('box'))    return 'box'
  if (lower.includes('crate'))  return 'crate'
  if (lower.includes('chair'))  return 'chair'
  if (lower.includes('table'))  return 'table'
  if (lower.includes('cup'))    return 'cup'
  if (lower.includes('bottle')) return 'bottle'
  if (lower.includes('can'))    return 'can'
  if (lower.includes('book'))   return 'book'
  // Strip underscores/digits and use remainder
  return meshName.replace(/[_\d]+/g, ' ').trim() || meshName
}

function inferProperties(meshName) {
  const lower = meshName.toLowerCase()
  if (lower.includes('glass') || lower.includes('cup') || lower.includes('bottle')) {
    return { fragile: true,  heavy: false, snapable: true  }
  }
  if (lower.includes('box') || lower.includes('crate')) {
    return { fragile: false, heavy: true,  snapable: true  }
  }
  if (lower.includes('ball') || lower.includes('can')) {
    return { fragile: false, heavy: false, snapable: true  }
  }
  if (lower.includes('table') || lower.includes('chair') || lower.includes('sofa')) {
    return { fragile: false, heavy: true,  snapable: false }
  }
  return { fragile: false, heavy: false, snapable: true }
}
