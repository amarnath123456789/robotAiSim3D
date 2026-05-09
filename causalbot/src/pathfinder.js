import { state } from './state.js'

const GRID_SIZE = 0.35   // metres per cell
const GRID_HALF = 3.0    // room half-extent
const AGENT_RADIUS = 0.28  // robot collision radius

// Convert world XZ → grid indices
function toGrid(wx, wz) {
    return {
        col: Math.round((wx + GRID_HALF) / GRID_SIZE),
        row: Math.round((wz + GRID_HALF) / GRID_SIZE),
    }
}

// Convert grid indices → world XZ
function toWorld(col, row) {
    return {
        x: col * GRID_SIZE - GRID_HALF,
        z: row * GRID_SIZE - GRID_HALF,
    }
}

const COLS = Math.ceil((GRID_HALF * 2) / GRID_SIZE) + 1
const ROWS = Math.ceil((GRID_HALF * 2) / GRID_SIZE) + 1

// Build obstacle grid from current physics world state
function buildGrid(excludeIds = []) {
    const grid = new Uint8Array(COLS * ROWS) // 0=free, 1=blocked

    // Room walls are always blocking — mark border cells
    for (let c = 0; c < COLS; c++) {
        grid[0 * COLS + c] = 1
        grid[(ROWS - 1) * COLS + c] = 1
    }
    for (let r = 0; r < ROWS; r++) {
        grid[r * COLS + 0] = 1
        grid[r * COLS + (COLS - 1)] = 1
    }

    // Mark object footprints
    Object.values(state.world.objects).forEach(obj => {
        if (excludeIds.includes(obj.id)) return
        if (obj.status === 'held') return

        const [ox, , oz] = obj.position
        const [sx, , sz] = obj.size || [0.3, 0.3, 0.3]
        const pad = AGENT_RADIUS + Math.max(sx, sz)

        const g0 = toGrid(ox - pad, oz - pad)
        const g1 = toGrid(ox + pad, oz + pad)

        for (let r = g0.row; r <= g1.row; r++) {
            for (let c = g0.col; c <= g1.col; c++) {
                if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
                    grid[r * COLS + c] = 1
                }
            }
        }
    })

    return grid
}

// Heuristic — octile distance (allows diagonals)
function h(ac, ar, bc, br) {
    const dc = Math.abs(ac - bc)
    const dr = Math.abs(ar - br)
    return Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr)
}

const DIRS = [
    [0, 1, 1], [0, -1, 1], [1, 0, 1], [-1, 0, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
]

// A* on the grid
function astar(grid, sc, sr, ec, er) {
    const key = (c, r) => r * COLS + c
    const gCost = new Float32Array(COLS * ROWS).fill(Infinity)
    const prev = new Int32Array(COLS * ROWS).fill(-1)
    const open = new Set()

    gCost[key(sc, sr)] = 0
    open.add(key(sc, sr))

    // Simple priority queue via sorted array (good enough for this grid size)
    const fCost = new Float32Array(COLS * ROWS).fill(Infinity)
    fCost[key(sc, sr)] = h(sc, sr, ec, er)

    while (open.size > 0) {
        // Pick lowest f
        let cur = -1, best = Infinity
        for (const k of open) {
            if (fCost[k] < best) { best = fCost[k]; cur = k }
        }
        open.delete(cur)

        const cc = cur % COLS
        const cr = Math.floor(cur / COLS)

        if (cc === ec && cr === er) {
            // Reconstruct path
            const path = []
            let k = key(ec, er)
            while (k !== -1) {
                const pc = k % COLS
                const pr = Math.floor(k / COLS)
                path.unshift(toWorld(pc, pr))
                k = prev[k]
            }
            return path
        }

        for (const [dc, dr, cost] of DIRS) {
            const nc = cc + dc
            const nr = cr + dr
            if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue
            if (grid[key(nc, nr)] === 1) continue

            // Diagonal: check both cardinal neighbours are free (no corner cutting)
            if (dc !== 0 && dr !== 0) {
                if (grid[key(cc + dc, cr)] === 1 || grid[key(cc, cr + dr)] === 1) continue
            }

            const ng = gCost[cur] + cost
            const nk = key(nc, nr)
            if (ng < gCost[nk]) {
                gCost[nk] = ng
                fCost[nk] = ng + h(nc, nr, ec, er)
                prev[nk] = cur
                open.add(nk)
            }
        }
    }

    return null // no path
}

// Smooth path — remove redundant collinear waypoints
function smooth(path) {
    if (path.length <= 2) return path
    const out = [path[0]]
    for (let i = 1; i < path.length - 1; i++) {
        const prev = out[out.length - 1]
        const cur = path[i]
        const next = path[i + 1]
        // Cross product of (cur-prev) × (next-cur) — if near zero, collinear
        const cross = (cur.x - prev.x) * (next.z - cur.z) - (cur.z - prev.z) * (next.x - cur.x)
        if (Math.abs(cross) > 0.01) out.push(cur)
    }
    out.push(path[path.length - 1])
    return out
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Find a walkable path from world (sx,sz) to (ex,ez).
 * Returns array of {x,z} waypoints, or null if no path exists.
 * excludeIds: object ids to ignore when building the obstacle grid (e.g. held object)
 */
export function findPath(sx, sz, ex, ez, excludeIds = []) {
    const grid = buildGrid(excludeIds)

    const start = toGrid(sx, sz)
    const end = toGrid(ex, ez)

    // Clamp end to grid bounds
    end.col = Math.max(1, Math.min(COLS - 2, end.col))
    end.row = Math.max(1, Math.min(ROWS - 2, end.row))

    // If end cell is blocked, find nearest free cell
    const gkey = (c, r) => r * COLS + c
    if (grid[gkey(end.col, end.row)] === 1) {
        let found = false
        for (let radius = 1; radius <= 4 && !found; radius++) {
            for (let dc = -radius; dc <= radius && !found; dc++) {
                for (let dr = -radius; dr <= radius && !found; dr++) {
                    const nc = end.col + dc
                    const nr = end.row + dr
                    if (nc >= 1 && nc < COLS - 1 && nr >= 1 && nr < ROWS - 1 && grid[gkey(nc, nr)] === 0) {
                        end.col = nc
                        end.row = nr
                        found = true
                    }
                }
            }
        }
        if (!found) return null
    }

    const raw = astar(grid, start.col, start.row, end.col, end.row)
    if (!raw) return null
    return smooth(raw)
}

/**
 * Debug: get the obstacle grid as a flat Uint8Array + dimensions.
 * Useful for visualising in Three.js.
 */
export function getGridDebug() {
    return { grid: buildGrid(), cols: COLS, rows: ROWS, cellSize: GRID_SIZE, halfExtent: GRID_HALF }
}