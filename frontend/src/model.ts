import type { TamModel, ElementRef, ValidationIssue, AreaNode, Direction } from './types'
import { stableId } from './utils'

export interface FlattenedModel {
  elements: ElementRef[]
  byName: Map<string, ElementRef>
  issues: ValidationIssue[]
}

function addElement(elements: ElementRef[], byName: Map<string, ElementRef>, issues: ValidationIssue[], kind: ElementRef['kind'], name: string, parentAreaId?: string, keyPath?: string) {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return
  if (byName.has(trimmed)) {
    issues.push({ level: 'error', message: `Duplicate element name: "${trimmed}" (names must be unique across users/components/areas/storages)`, path: keyPath })
    return
  }
  const key = parentAreaId ? `${parentAreaId}/${trimmed}` : trimmed
  const id = stableId(kind, key)
  const el: ElementRef = { id, name: trimmed, kind, parentAreaId }
  elements.push(el)
  byName.set(trimmed, el)
}

export function flattenModel(model: TamModel): FlattenedModel {
  const issues: ValidationIssue[] = []
  const elements: ElementRef[] = []
  const byName = new Map<string, ElementRef>()

  for (const a of (model as any).agents ?? []) addElement(elements, byName, issues, 'agent', a, undefined, 'agents')
  for (const u of model.users ?? []) addElement(elements, byName, issues, 'user', u, undefined, 'users')
  for (const s of model.storages ?? []) addElement(elements, byName, issues, 'storage', s, undefined, 'storages')

  function walkAreas(nodes: AreaNode[], parentAreaId?: string, path = 'areas') {
    for (let i = 0; i < nodes.length; i++) {
      const n: any = nodes[i]
      const p = `${path}[${i}]`
      if (!n?.name) {
        issues.push({ level: 'error', message: `${p}: area/component must have a name`, path: p })
        continue
      }
      const isComponent = n.type === 'component'
      if (isComponent) {
        addElement(elements, byName, issues, 'component', n.name, parentAreaId, p)
      } else {
        // area
        const areaKey = parentAreaId ? `${parentAreaId}/${n.name}` : n.name
        const areaId = stableId('area', areaKey)
        // area names must be globally unique too (simplifies referencing)
        addElement(elements, byName, issues, 'area', n.name, parentAreaId, p)
        if (Array.isArray(n.children)) walkAreas(n.children, areaId, `${p}.children`)
      }
    }
  }

  walkAreas(model.areas ?? [])

  // validate boundary refs
  const boundaries: any[] = (model as any).boundaries ?? []
  if (Array.isArray(boundaries)) {
    for (let i = 0; i < boundaries.length; i++) {
      const b: any = boundaries[i]
      const p = `boundaries[${i}]`
      for (const child of (b?.children ?? [])) {
        const name = String(child ?? '').trim()
        if (!name) continue
        if (!byName.has(name)) {
          issues.push({ level: 'warn', message: `${p}: boundary child not found (ignored): "${name}"`, path: p })
        }
      }
    }
  }

  // validate connection refs + cycles
  const edges: Array<{ from: string; to: string; dir: Direction; kind: string; path: string }> = []
  for (let i = 0; i < (model.connections ?? []).length; i++) {
    const c: any = (model.connections ?? [])[i]
    const p = `connections[${i}]`
    const from = (c?.from ?? '').trim()
    const to = (c?.to ?? '').trim()
    if (!from || !to) continue
    if (!byName.has(from)) issues.push({ level: 'error', message: `${p}: from reference not found: "${from}"`, path: p })
    if (!byName.has(to)) issues.push({ level: 'error', message: `${p}: to reference not found: "${to}"`, path: p })
    if (c.kind === 'channel' && c.direction) edges.push({ from, to, dir: c.direction, kind: 'channel', path: p })
  }

  // simple directed cycle detection on channels (ignore storages)
  const adj = new Map<string, string[]>()
  function addAdj(a: string, b: string) {
    if (!adj.has(a)) adj.set(a, [])
    adj.get(a)!.push(b)
  }
  for (const e of edges) {
    const a = e.from, b = e.to
    if (e.dir === '->' || e.dir === 'reqres') addAdj(a, b)
    else if (e.dir === '<-') addAdj(b, a)
    else if (e.dir === '<->') { addAdj(a, b); addAdj(b, a) }
  }
  const temp = new Set<string>()
  const perm = new Set<string>()
  const stack: string[] = []
  const cycles: string[][] = []

  function dfs(v: string) {
    if (perm.has(v)) return
    if (temp.has(v)) {
      const idx = stack.indexOf(v)
      if (idx >= 0) cycles.push(stack.slice(idx).concat(v))
      return
    }
    temp.add(v)
    stack.push(v)
    for (const w of adj.get(v) ?? []) dfs(w)
    stack.pop()
    temp.delete(v)
    perm.add(v)
  }

  for (const v of adj.keys()) dfs(v)
  if (cycles.length) {
    issues.push({ level: 'warn', message: `Detected channel cycle(s): ${cycles.slice(0,3).map(c => c.join(' → ')).join(' | ')}${cycles.length>3?' …':''}` })
  }

  return { elements, byName, issues }
}
