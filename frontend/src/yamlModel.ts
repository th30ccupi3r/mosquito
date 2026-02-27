import YAML from 'js-yaml'

/**
 * Best-effort extraction of node names from the current YAML so the UI can offer
 * valid "from" / "to" choices when adding connections.
 *
 * Subcomponents are treated as first-class nodes using a qualified name:
 *   "<Component>/<Subcomponent>"
 */
export function extractNodeNames(yamlText: string): string[] {
  try {
    const doc = (YAML.load(yamlText) as any) ?? {}
    const names: string[] = []

    const push = (s: any) => {
      if (typeof s === 'string' && s.trim()) names.push(s.trim())
    }

    const collectSimple = (arr: any) => {
      if (!Array.isArray(arr)) return
      for (const x of arr) {
        if (typeof x === 'string') {
          push(x)
        } else if (x && typeof x.name === 'string') {
          push(x.name)
        }
      }
    }

    // Humans, agents, storages, areas, external providers
    collectSimple(doc.human_agents)
    collectSimple(doc.agents)
    collectSimple(doc.storages)
    collectSimple(doc.areas)
    collectSimple(doc.external_providers)

    // Components + subcomponents
    if (Array.isArray(doc.components)) {
      for (const c of doc.components) {
        if (typeof c === 'string') {
          push(c)
          continue
        }
        if (!c || typeof c !== 'object') continue
        const parent = typeof c.name === 'string' ? c.name.trim() : ''
        if (parent) push(parent)

        const subs = (c as any).subcomponents
        if (parent && Array.isArray(subs)) {
          for (const sc of subs) {
            const sn =
              typeof sc === 'string'
                ? sc
                : sc && typeof sc.name === 'string'
                  ? sc.name
                  : ''
            if (typeof sn === 'string' && sn.trim()) {
              // qualified name for unambiguous connections
              names.push(`${parent}/${sn.trim()}`)
            }
          }
        }
      }
    }

    // de-dup while preserving order
    return [...new Set(names)].filter((s) => String(s).trim().length > 0)
  } catch {
    return []
  }
}

export function extractComponentNames(yamlText: string): string[] {
  try {
    const doc = (YAML.load(yamlText) as any) ?? {}
    const names: string[] = []
    if (Array.isArray(doc.components)) {
      for (const c of doc.components) {
        if (typeof c === 'string') names.push(c)
        else if (c && typeof c.name === 'string') names.push(c.name)
      }
    }
    return [...new Set(names)].filter((s) => String(s).trim().length > 0)
  } catch {
    return []
  }
}



export function extractStorageNames(yamlText: string): string[] {
  try {
    const doc = (YAML.load(yamlText) as any) ?? {}
    const out: string[] = []
    const storages = doc?.storages
    if (Array.isArray(storages)) {
      for (const s of storages) {
        if (typeof s === 'string' && s.trim()) out.push(s.trim())
        else if (s && typeof s.name === 'string' && s.name.trim()) out.push(s.name.trim())
      }
    }
    return out
  } catch {
    return []
  }
}

export function extractSubcomponentNames(yamlText: string): string[] {
  try {
    const doc = (YAML.load(yamlText) as any) ?? {}
    const out: string[] = []
    const comps = doc?.components
    if (!Array.isArray(comps)) return out
    for (const c of comps) {
      if (!c) continue
      const cname = typeof c === 'string' ? c : c.name
      if (typeof cname !== 'string' || !cname.trim()) continue
      const subs = (typeof c === 'object' && c) ? (c as any).subcomponents : null
      if (!Array.isArray(subs)) continue
      for (const sc of subs) {
        const sname = typeof sc === 'string' ? sc : sc?.name
        if (typeof sname === 'string' && sname.trim()) out.push(`${cname.trim()}/${sname.trim()}`)
      }
    }
    return out
  } catch {
    return []
  }
}


export function extractHumanNames(yamlText: string): string[] {
  try {
    const doc = (YAML.load(yamlText) as any) ?? {}
    const out: string[] = []
    const arr = doc?.human_agents
    if (Array.isArray(arr)) {
      for (const it of arr) {
        if (typeof it === 'string' && it.trim()) out.push(it.trim())
        else if (it && typeof it.name === 'string' && it.name.trim()) out.push(it.name.trim())
      }
    }
    return out
  } catch {
    return []
  }
}

export function extractAgentNames(yamlText: string): string[] {
  try {
    const doc = (YAML.load(yamlText) as any) ?? {}
    const out: string[] = []
    const arr = doc?.agents
    if (Array.isArray(arr)) {
      for (const it of arr) {
        if (typeof it === 'string' && it.trim()) out.push(it.trim())
        else if (it && typeof it.name === 'string' && it.name.trim()) out.push(it.name.trim())
      }
    }
    return out
  } catch {
    return []
  }
}
