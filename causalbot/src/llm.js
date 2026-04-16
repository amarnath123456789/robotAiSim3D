import { state, getObject, getRobotPos } from './state.js'
import { getMemorySummary } from './memory.js'
import { getAllSkillNames } from './skillRegistry.js'

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`

// ─── World snapshot ──────────────────────────────────────────────────────────

function getWorldSnapshot() {
  const rp = getRobotPos()
  const objs = Object.values(state.world.objects)
  const skills = getAllSkillNames()
  const memory = getMemorySummary()

  return {
    robot: {
      position: [+rp.x.toFixed(2), +rp.y.toFixed(2), +rp.z.toFixed(2)],
      holding: state.robot.heldObject || null,
      status: state.robot.status,
    },
    objects: objs.map(o => ({
      id: o.id,
      name: o.name,
      position: o.position.map(v => +v.toFixed(2)),
      status: o.status,
      mass: o.mass,
      fragility: o.fragility,
      snapable: o.snapable,
    })),
    room: { minX: -3, maxX: 3, minZ: -3, maxZ: 3, floorY: 0 },
    skills,
    memory,
  }
}

// ─── Planner ─────────────────────────────────────────────────────────────────

export async function planInstruction(instruction) {
  setStatus('Thinking...')
  state.robot.eyeColor = 0xffaa00
  state.robot.status = 'thinking'

  const snap = getWorldSnapshot()

  const prompt = `You are the intelligent brain of a 3D robot in a simulated room.
Your job is to figure out exactly what the user wants, reason through it carefully, and produce a precise action plan.

=== WORLD STATE ===
${JSON.stringify(snap, null, 2)}

=== USER INSTRUCTION ===
"${instruction}"

=== YOUR AVAILABLE SKILLS ===
${snap.skills.length ? snap.skills.map(s => `  - ${s}`).join('\n') : '  (none yet — you can request new ones)'}

=== SKILL CONTRACT ===
Every skill receives a "context" object with:
  context.target      → the resolved target object (from args.target)
  context.args        → raw args from the plan
  context.getPos()    → robot current {x,y,z}
  context.setPos(x,y,z) → instant teleport
  context.navigateTo(x,y,z) → smooth movement, returns Promise
  context.setArm(angle) → rotate arm (-1.2 = reach down, 0 = neutral, 1.2 = up)
  context.grab(id)    → snap object to robot hand
  context.release()   → drop held object with physics
  context.setEye(hex) → change eye colour
  context.wait(ms)    → pause, returns Promise
  context.getObject(nameOrId) → look up object by name or id
  context.setStatus(text) → show message on screen

=== REASONING RULES ===
1. Read the instruction carefully. What is the END GOAL?
2. What is the current world state? Is the robot holding something already?
3. What sequence of skills achieves the goal most directly?
4. For multi-step tasks (e.g. "pick up glass and put on floor"), chain multiple actions.
5. For ambiguous targets (e.g. "the thing on the table"), resolve to the most likely object id.
6. For impossible tasks (e.g. "lift the table" — mass:20), explain why and do nothing.
7. For creative/expressive tasks (e.g. "celebrate", "be scared"), invent appropriate motion skills.
8. If a skill doesn't exist but the task is achievable with the robot API, request it.
9. NEVER request a new skill if an existing one covers the task — reuse skills.
10. For navigation tasks always use go_to or go_to_object with correct object id.

=== OUTPUT FORMAT ===
Return ONLY this JSON. No markdown. No explanation outside JSON.
{
  "reasoning": "2-3 sentence explanation of what you understood and decided",
  "goal": "one sentence end goal",
  "actions": [
    {
      "skill": "skill_name",
      "args": { "target": "object_id_or_null" },
      "description": "what this action does"
    }
  ],
  "needsNewSkill": false,
  "newSkillName": null,
  "newSkillDescription": null,
  "impossible": false,
  "impossibleReason": null
}`

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await callGemini(prompt, 4096)
      const json = extractJSON(raw)
      const plan = JSON.parse(json)
      console.log('Plan reasoning:', plan.reasoning)
      console.log('Plan goal:', plan.goal)
      console.log('Plan actions:', plan.actions)

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
      if (attempt === 2) {
        state.robot.status = 'failed'
        state.robot.eyeColor = 0xff3333
        setStatus('Could not understand. Try again.')
        return null
      }
      await sleep(300)
    }
  }
}

// ─── Skill inventor ───────────────────────────────────────────────────────────

export async function inventSkill(skillName, instruction, existingSkills) {
  setStatus(`Inventing: ${skillName}...`)

  const snap = getWorldSnapshot()

  const prompt = `You are writing JavaScript for a robot skill called "${skillName}".
The skill must accomplish: "${instruction}"

=== ROBOT CONTEXT API ===
All methods are on the "context" object:

MOVEMENT:
  await context.navigateTo(x, y, z)  — move smoothly to world coords, Promise
  context.setPos(x, y, z)            — instant teleport
  context.getPos()                    — returns {x, y, z}

ARM:
  context.setArm(angle)  — -1.2=reach down, 0=neutral, 1.0=up, 1.5=high up

OBJECTS:
  context.grab(objectId)             — snap object to hand
  context.release()                  — drop with physics
  context.getObject(nameOrId)        — returns {id, name, position:[x,y,z], status, mass}
  context.target                     — pre-resolved target object (if args.target was set)
  context.args                       — raw args passed to this skill

EXPRESSION:
  context.setEye(0xRRGGBB)          — change eye colour
  context.setStatus(text)            — show text on screen

TIMING:
  await context.wait(ms)             — pause for milliseconds

=== WORLD RIGHT NOW ===
Robot at: ${JSON.stringify(snap.robot.position)}
Holding: ${snap.robot.holding || 'nothing'}
Objects: ${snap.objects.map(o => `${o.name}(${o.id}) at ${JSON.stringify(o.position)} status:${o.status}`).join(', ')}

=== EXISTING SKILLS (do not duplicate) ===
${existingSkills.length ? existingSkills.join(', ') : 'none'}

=== RULES ===
- Write ONLY the async function body — no function declaration, no wrapper
- Use context.getObject() to find objects — NEVER hardcode coordinates
- Use await on navigateTo and wait
- Max 12 lines
- Handle missing objects gracefully with early return
- For expressive skills (celebrate, scared, angry): use setPos, setArm, setEye, wait creatively
- For pick up: navigate to object, lower arm, grab, raise arm
- For place/put: navigate to target location, lower arm, release
- No markdown, no comments, just code lines

=== PATTERN EXAMPLES ===

pick up something:
const obj = context.target || context.getObject('glass');
if (!obj) { context.setStatus('Not found'); return; }
const rp = context.getPos();
const dx = rp.x - obj.position[0], dz = rp.z - obj.position[2];
const d = Math.sqrt(dx*dx+dz*dz)||1;
await context.navigateTo(obj.position[0]+(dx/d)*0.3, 1.2, obj.position[2]+(dz/d)*0.3);
context.setArm(-1.2);
await context.wait(300);
context.grab(obj.id);
context.setArm(0);
context.setStatus('Got it!');

celebrate:
context.setEye(0x00ff88);
for(let i=0;i<3;i++){const p=context.getPos();context.setPos(p.x,p.y+0.5,p.z);await context.wait(200);context.setPos(p.x,p.y,p.z);await context.wait(200);}
context.setArm(1.5);await context.wait(400);context.setArm(0);
context.setStatus('Yay!');
context.setEye(0x4488ff);

scared:
context.setEye(0xff4400);
const p=context.getPos();
for(let i=0;i<4;i++){context.setPos(p.x+(Math.random()-0.5)*0.3,p.y,p.z+(Math.random()-0.5)*0.3);await context.wait(100);}
context.setPos(p.x,p.y,p.z);context.setArm(-0.5);await context.wait(500);context.setArm(0);
context.setStatus('Eek!');context.setEye(0x4488ff);

patrol room:
const corners=[[-2,1.2,-2],[2,1.2,-2],[2,1.2,2],[-2,1.2,2]];
for(const c of corners){await context.navigateTo(c[0],c[1],c[2]);await context.wait(150);}
context.setStatus('Patrol done!');

Now write ONLY the code for "${skillName}". Nothing else.`

  try {
    const raw = await callGemini(prompt, 1200)
    const code = raw.replace(/```javascript|```js|```/gi, '').trim()
    console.log('Invented skill code:', code)
    return code
  } catch (e) {
    console.error('Skill invention failed:', e)
    return null
  }
}

// ─── Gemini caller ────────────────────────────────────────────────────────────

async function callGemini(prompt, maxTokens = 2048) {
  const res = await fetch(`${API_URL}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: maxTokens,
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
  if (finishReason === 'MAX_TOKENS') {
    console.warn('Response was cut off — MAX_TOKENS reached')
  }
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