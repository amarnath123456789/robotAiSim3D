import { state } from './state.js'
import { getMemorySummary } from './memory.js'

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

function buildSceneDescription() {
  const objects = state.objects
    .filter(o => o.state !== 'broken')
    .map(o => `${o.name} at (${o.position.x.toFixed(1)}, ${o.position.y.toFixed(1)}, ${o.position.z.toFixed(1)}) — mass: ${o.mass}kg, fragility: ${o.fragility}`)
    .join('\n')

  const robot = state.robot
  return `Robot position: (${robot.position.x.toFixed(1)}, ${robot.position.y.toFixed(1)}, ${robot.position.z.toFixed(1)})
Held object: ${robot.heldObject || 'none'}

Objects in scene:
${objects}`
}

function buildPrompt(instruction, forcedBranch = null) {
  const scene = buildSceneDescription()
  const memory = getMemorySummary()
  const forced = forcedBranch
    ? `\nThe user has forced this branch: "${forcedBranch}". Generate consequences branching FROM this forced action.`
    : ''

  return `${scene}

Memory of past actions:
${memory}

Instruction: "${instruction}"${forced}

Generate a consequence tree for how the robot should handle this instruction. Think 3-4 steps ahead. Consider physics, fragility, and past mistakes.

Return ONLY valid JSON in this exact format:
{
  "branches": [
    {
      "id": "b1",
      "action": "short action description",
      "outcome": "what happens if this action is taken",
      "risk": "low|medium|high",
      "confidence": 0.85,
      "waypoints": [{"x": 0, "y": 0.5, "z": 1}],
      "children": [
        {
          "id": "b1a",
          "action": "next action",
          "outcome": "next outcome",
          "risk": "low",
          "confidence": 0.8,
          "waypoints": [],
          "children": []
        }
      ]
    }
  ]
}`
}

export async function generateConsequenceTree(instruction, forcedBranch = null) {
  state.robot.status = 'thinking'
  setStatus('Thinking...')

  try {
    if (!API_KEY) {
      throw new Error('Missing VITE_GEMINI_API_KEY. Add it to your .env file.')
    }

    const requestUrl = `${API_URL}?key=${encodeURIComponent(API_KEY)}`

    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: `You are a robot causal reasoning engine. Given a scene, memory, and instruction — generate a consequence tree as strict JSON only. No explanation, no markdown, just the JSON object. Keep actions short (under 6 words). Max 3 branches per level, max depth 3.`
            }
          ]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: buildPrompt(instruction, forcedBranch) }]
          }
        ],
        generationConfig: {
          maxOutputTokens: 1000,
          temperature: 0.2
        }
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Gemini request failed: ${response.status} ${errorText}`)
    }

    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()

    if (!text) {
      throw new Error('Gemini returned an empty response.')
    }

    // Parse JSON — strip any accidental markdown
    const clean = text.replace(/```json|```/g, '').trim()
    const tree = JSON.parse(clean)

    state.tree.branches = tree.branches
    state.robot.status = 'idle'
    return tree.branches

  } catch (err) {
    console.error('LLM call failed:', err)
    state.robot.status = 'failed'
    setStatus('Failed to think. Try again.')
    return null
  }
}

function setStatus(text) {
  const el = document.getElementById('status')
  if (el) el.textContent = text
}