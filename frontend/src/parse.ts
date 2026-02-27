import YAML from 'js-yaml'
import type { TamModel, ValidationIssue, AreaNode, Direction, Boundary } from './types'

const allowedDirections: Set<Direction> = new Set(['->', '<-', '<->', 'reqres'])

export function parseYaml(yamlText: string): { model?: TamModel; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = []
  let doc: any
  try {
    doc = YAML.load(yamlText) ?? {}
  } catch (e: any) {
    issues.push({ level: 'error', message: `YAML parse error: ${e?.message ?? String(e)}` })
    return { issues }
  }

  const model: TamModel = doc as any

  if ((model as any).agents && !Array.isArray((model as any).agents)) issues.push({ level: 'error', message: 'agents must be a list of strings', path: 'agents' })
  if (model.users && !Array.isArray(model.users)) issues.push({ level: 'error', message: 'users must be a list of strings', path: 'users' })
  if (model.storages && !Array.isArray(model.storages)) issues.push({ level: 'error', message: 'storages must be a list of strings', path: 'storages' })
  if ((model as any).boundaries && !Array.isArray((model as any).boundaries)) issues.push({ level: 'error', message: 'boundaries must be a list', path: 'boundaries' })
  if (model.areas && !Array.isArray(model.areas)) issues.push({ level: 'error', message: 'areas must be a list', path: 'areas' })
  if (model.connections && !Array.isArray(model.connections)) issues.push({ level: 'error', message: 'connections must be a list', path: 'connections' })

  if (Array.isArray((model as any).boundaries)) {
    const seen = new Set<string>()
    for (let i = 0; i < (model as any).boundaries.length; i++) {
      const b: any = (model as any).boundaries[i]
      const p = `boundaries[${i}]`
      const name = (b?.name ?? '').trim()
      if (!name) issues.push({ level: 'error', message: `${p}: name is required`, path: p })
      if (name && seen.has(name)) issues.push({ level: 'error', message: `${p}: duplicate boundary name "${name}"`, path: p })
      if (name) seen.add(name)
      if (!Array.isArray(b?.children)) issues.push({ level: 'error', message: `${p}: children must be a list of strings`, path: p })
    }
  }

  // quick checks
  if (Array.isArray(model.connections)) {
    for (let i = 0; i < model.connections.length; i++) {
      const c: any = model.connections[i]
      const p = `connections[${i}]`
      if (!c?.from || !c?.to) issues.push({ level: 'error', message: `${p}: from and to are required`, path: p })
      if (c?.kind === 'channel') {
        if (!c.protocol) issues.push({ level: 'error', message: `${p}: protocol is required for channel`, path: p })
        if (!allowedDirections.has(c.direction)) issues.push({ level: 'error', message: `${p}: invalid direction (allowed: ->, <-, <->, reqres)`, path: p })
      } else if (c?.kind === 'access') {
        if (!c.access) issues.push({ level: 'error', message: `${p}: access is required for access link`, path: p })
      } else {
        issues.push({ level: 'error', message: `${p}: kind must be 'channel' or 'access'`, path: p })
      }
    }
  }

  // normalize empty
  ;(model as any).agents = (Array.isArray((model as any).agents) ? (model as any).agents : []).filter(Boolean) as string[]
  model.users = (Array.isArray(model.users) ? model.users : []).filter(Boolean) as string[]
  model.storages = (Array.isArray(model.storages) ? model.storages : []).filter(Boolean) as string[]
  ;(model as any).boundaries = (Array.isArray((model as any).boundaries) ? (model as any).boundaries : [])
    .map((b: any) => ({
      name: String(b?.name ?? '').trim(),
      children: (Array.isArray(b?.children) ? b.children : []).map((c: any) => String(c ?? '').trim()).filter(Boolean)
    }))
    .filter((b: Boundary) => Boolean(b.name)) as Boundary[]
  model.areas = Array.isArray(model.areas) ? (model.areas as AreaNode[]) : []
  model.connections = Array.isArray(model.connections) ? (model.connections as any[]) : []

  return { model, issues }
}
