import { state, getObject, getRobotPos } from './state.js'
import { getMemorySummary } from './memory.js'
import { getAllSkillNames, hasSkill } from './skillRegistry.js'

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent`

// ─── Minimal world snapshot — only what the LLM needs ────────────────────────

function getWorldSnapshot() {
  const rp = getRobotPos()

  return {
    r: {
      p: [+rp.x.toFixed(1), +rp.y.toFixed(1), +rp.z.toFixed(1)],
      h: state.robot.heldObject || null,
    },
    o: Object.values(state.world.objects)
      .filter(o => o.status !== 'broken') // broken objects irrelevant
      .map(o => ({
        id: o.id,
        n: o.name,
        p: o.position.map(v => +v.toFixed(1)),
        st: o.status,
        m: o.mass,
        fr: o.fragility,
        sn: o.snapable,
      })),
    b: state.world.roomBounds,
    sk: getAllSkillNames(),
    mem: getMemorySummary(),
  }
}

// ─── Classify instruction cheaply before hitting planner ─────────────────────

const DIRECT_SKILL_MAP = {
  jump: 'jump',
  backflip: 'backflip',
  frontflip: 'frontflip',
  flip: 'backflip',
  spin: 'spin',
  rotate: 'spin',
  dance: 'dance',
  celebrate: 'celebrate',
  cheer: 'celebrate',
  scared: 'scared',
  fly: 'fly',
  patrol: 'patrol',
}

function tryDirectMatch(instruction) {
  const lower = instruction.toLowerCase().trim()
  for (const [keyword, skill] of Object.entries(DIRECT_SKILL_MAP)) {
    if (lower.includes(keyword) && hasSkill(skill)) {
      return skill
    }
  }
  return null
}

// ─── Planner ─────────────────────────────────────────────────────────────────

export async function planInstruction(instruction) {
  setStatus('Thinking...')
  state.robot.eyeColor = 0xffaa00
  state.robot.status = 'thinking'

  // Fast path — skip LLM entirely for known single skills
  const direct = tryDirectMatch(instruction)
  if (direct) {
    state.robot.status = 'idle'
    state.robot.eyeColor = 0x4488ff
    return {
      reasoning: `Direct match: ${direct}`,
      goal: instruction,
      thoughts: [`Plan: ${direct}`],
      actions: [{ skill: direct, args: {}, description: instruction }],
      needsNewSkill: false,
      newSkillName: null,
      newSkillDescription: null,
      impossible: false,
      impossibleReason: null,
    }
  }

  const snap = getWorldSnapshot()

  const prompt = `Robot brain. World (compact):
r=robot(p=pos,h=held) o=objects(id,n=name,p=pos,st=status,m=mass,fr=fragility,sn=snapable) b=bounds sk=skills mem=memory
${JSON.stringify(snap)}

Instruction: "${instruction}"

Skills API: navigateTo(x,y,z) setPos(x,y,z) getPos() setArm(-1.5to1.5) grab(id) release() setEye(hex) wait(ms) getObject(id) setStatus(text) getWorldBounds()

Rules:
- Reuse existing skills. Only needsNewSkill=true if nothing fits.
- One hand. Already holding? Skip pick_up.
- Fragility>0.6 = careful. Mass>2=heavy.
- Navigate within 0.3 units before grabbing.
- Impossible? Set impossible=true.

Respond ONLY valid JSON, no markdown:
{"reasoning":"brief","goal":"brief","thoughts":["I see:...","Plan:..."],"actions":[{"skill":"name","args":{"target":"id_or_null"},"description":"brief"}],"needsNewSkill":false,"newSkillName":null,"newSkillDescription":null,"impossible":false,"impossibleReason":null}`

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callGemini(prompt, 512)
      const json = extractJSON(raw)
      const plan = JSON.parse(json)

      if (plan.impossible) {
        setStatus(plan.impossibleReason || 'Cannot do that.')
        state.robot.status = 'idle'
        state.robot.eyeColor = 0x4488ff
        return null
      }

      state.robot.status = 'idle'
      return plan

    } catch (e) {
      console.warn(`Plan attempt ${attempt + 1} failed:`, e.message)
      if (attempt === 1) {
        state.robot.status = 'failed'
        state.robot.eyeColor = 0xff3333
        setStatus('Could not understand.')
        return null
      }
      await sleep(200)
    }
  }
}

// ─── Skill inventor ───────────────────────────────────────────────────────────

export async function inventSkill(skillName, instruction, existingSkills) {
  setStatus(`Inventing: ${skillName}...`)

  const rp = getRobotPos()
  const objects = Object.values(state.world.objects)
    .map(o => `${o.name}(${o.id})@[${o.position.map(v => v.toFixed(1))}]`)
    .join(' ')

  const prompt = `Write JS async function body for robot skill "${skillName}": "${instruction}"

API: context.getPos() context.setPos(x,y,z) context.navigateTo(x,y,z,speed?) context.setArm(-1.5to1.5) context.grab(id) context.release() context.setEye(0xRRGGBB) context.wait(ms) context.getObject(id) context.target context.setStatus(text) context.getWorldBounds()

Robot@[${rp.x.toFixed(1)},${rp.y.toFixed(1)},${rp.z.toFixed(1)}] holding:${state.robot.heldObject || 'none'}
Objects: ${objects}
Existing skills (don't duplicate): ${existingSkills.join(',')}

Animation rules:
- Use loops+interpolation for ALL movement (never raw setPos jumps)
- Arc: arcY=Math.sin(t*Math.PI)*HEIGHT for jumps/flips
- Always: const p=context.getPos() at start
- Always end: arm=0, eye=0x4488ff, near start pos
- Max 20 lines, no comments, pure JS body only`

  try {
    const raw = await callGemini(prompt, 400)
    const code = raw.replace(/```javascript|```js|```/gi, '').trim()
    return code
  } catch (e) {
    console.error('Skill invention failed:', e)
    return null
  }
}

// ─── Gemini caller ────────────────────────────────────────────────────────────

async function callGemini(prompt, maxTokens = 512) {
  const res = await fetch(`${API_URL}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: maxTokens,
        candidateCount: 1,
      }
    })
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error?.message || `HTTP ${res.status}`)
  }

  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  const finishReason = data.candidates?.[0]?.finishReason
  if (finishReason === 'MAX_TOKENS') console.warn('Response cut off')
  console.log('LLM raw:', text)
  return text
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractJSON(text) {
  const clean = text.replace(/```json|```/gi, '').trim()
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON in response')
  return clean.slice(start, end + 1)
}

function setStatus(text) {
  const el = document.getElementById('status-bar')
  if (el) el.textContent = text
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}