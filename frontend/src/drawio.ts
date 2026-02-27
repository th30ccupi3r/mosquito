import type { TamModel, ElementRef } from './types'
import { escapeXml, stableId, clamp } from './utils'
import { ICONS_DARK as ICONS } from './icons.generated'

type Cell = {
  id: string
  value?: string
  style?: string
  vertex?: 1
  edge?: 1
  parent?: string
  source?: string
  target?: string
  geometry?: { x?: number; y?: number; width?: number; height?: number; relative?: 1 }
}

const PAGE_ID = 'page-1'
const DIAGRAM_ID = stableId('diagram', PAGE_ID)

// Dark palette for generated diagrams (so exported .drawio files are readable
// without relying on the editor's UI theme).
const palette = {
  bg: '#0b0f16',
  panel: '#0f172a',
  panel2: '#111827',
  stroke: '#334155',
  strokeSoft: '#475569',
  text: '#e5e7eb',
  edge: '#94a3b8',
  access: '#2dd4bf'
}

const defaults = {
  user: { w: 80, h: 80 },
  storage: { w: 110, h: 70 },
  component: { w: 160, h: 60 },
  area: { pad: 20, header: 28, minW: 260, minH: 180 }
}

const boundaryStyle = `swimlane;startSize=34;horizontal=0;rounded=0;whiteSpace=wrap;html=1;container=1;collapsible=0;childLayout=none;` +
  `fillColor=#0b1220;swimlaneFillColor=#0b1220;strokeColor=${palette.stroke};fontColor=${palette.text};fontStyle=1;`

const boundaryPad = 26
const boundaryGap = 24

function xmlCell(c: Cell): string {
  const attrs: string[] = []
  attrs.push(`id="${escapeXml(c.id)}"`)
  if (c.value !== undefined) attrs.push(`value="${escapeXml(c.value)}"`)
  if (c.style) attrs.push(`style="${escapeXml(c.style)}"`)
  if (c.vertex) attrs.push(`vertex="1"`)
  if (c.edge) attrs.push(`edge="1"`)
  if (c.parent) attrs.push(`parent="${escapeXml(c.parent)}"`)
  if (c.source) attrs.push(`source="${escapeXml(c.source)}"`)
  if (c.target) attrs.push(`target="${escapeXml(c.target)}"`)
  let geo = ''
  if (c.geometry) {
    const g = c.geometry
    const ga: string[] = []
    if (g.x !== undefined) ga.push(`x="${g.x}"`)
    if (g.y !== undefined) ga.push(`y="${g.y}"`)
    if (g.width !== undefined) ga.push(`width="${g.width}"`)
    if (g.height !== undefined) ga.push(`height="${g.height}"`)
    if (g.relative) ga.push(`relative="1"`)
    geo = `<mxGeometry ${ga.join(' ')} as="geometry"/>`
  }
  return `<mxCell ${attrs.join(' ')}>${geo}</mxCell>`
}

/*function styleImage(dataUri: string, extra: string = '') {
  return `shape=image;image=${dataUri};perimeter=ellipsePerimeter;verticalLabelPosition=bottom;verticalAlign=top;align=center;imageAspect=0;${extra}`
}*/
function styleImage(dataUri: string, extra: string = '') {
  return `shape=image;image=${dataUri};imageAspect=0;perimeter=none;` +
         `verticalLabelPosition=bottom;verticalAlign=top;align=center;` +
         `html=1;resizable=0;${extra}`
}

function styleRect(extra: string = '') {
  return `rounded=6;whiteSpace=wrap;html=1;align=center;verticalAlign=middle;fontColor=${palette.text};${extra}`
}

function styleArea(extra: string = '') {
  // draw.io container-ish
  return `swimlane;startSize=${defaults.area.header};horizontal=0;rounded=1;whiteSpace=wrap;html=1;container=1;collapsible=0;childLayout=none;fontColor=${palette.text};${extra}`
}

function styleEdge(extra: string = '') {
  return `endArrow=block;endFill=1;rounded=0;html=1;edgeStyle=orthogonalEdgeStyle;strokeColor=${palette.edge};${extra}`
}

function styleEdgeBidir(extra: string = '') {
  return `startArrow=block;startFill=1;endArrow=block;endFill=1;rounded=0;html=1;edgeStyle=orthogonalEdgeStyle;strokeColor=${palette.edge};${extra}`
}

function placeRow(items: { id: string; w: number; h: number }[], x0: number, y: number, gap: number) {
  let x = x0
  const out = new Map<string, { x: number; y: number; w: number; h: number }>()
  for (const it of items) {
    out.set(it.id, { x, y, w: it.w, h: it.h })
    x += it.w + gap
  }
  return out
}

type AreaLayout = {
  id: string
  name: string
  parentId?: string
  childrenAreas: AreaLayout[]
  components: ElementRef[]
  box: { x: number; y: number; w: number; h: number }
}

export function generateDrawioXml(model: TamModel, elements: ElementRef[]): { xml: string; stats: { vertices: number; edges: number } } {
  const cells: Cell[] = []
  // root boilerplate
  cells.push({ id: '0' })
  cells.push({ id: '1', parent: '0' })

  // background (first vertex so it stays behind everything)
  cells.push({
    id: 'bg',
    value: '',
    style: `shape=rectangle;rounded=0;fillColor=${palette.bg};strokeColor=none;`,
    vertex: 1,
    parent: '1',
    geometry: { x: 0, y: 0, width: 1600, height: 900 }
  })

  const agents = elements.filter(e => e.kind === 'agent')
  // "users" map to *Human Agents* per TAM block diagram guidance.
  const users = elements.filter(e => e.kind === 'user')
  const storages = elements.filter(e => e.kind === 'storage')
  const components = elements.filter(e => e.kind === 'component')
  const areasByName = new Map(elements.filter(e=>e.kind==='area').map(a=>[a.name,a]))

  // Build area tree layout based on YAML (by matching names in model.areas)
  function buildAreaTree(nodes: any[], parentId?: string): AreaLayout[] {
    const out: AreaLayout[] = []
    for (const n of nodes ?? []) {
      if (!n?.name) continue
      if (n.type === 'component') continue
      const areaEl = areasByName.get(n.name)
      if (!areaEl) continue
      const areaId = stableId('area', parentId ? `${parentId}/${n.name}` : n.name)
      const subtree = buildAreaTree(n.children ?? [], areaId)
      // components directly in this area
      const comps: ElementRef[] = []
      for (const ch of n.children ?? []) {
        if (ch?.type === 'component' && typeof ch?.name === 'string') {
          const comp = elements.find(e => e.kind==='component' && e.name===ch.name)
          if (comp) comps.push(comp)
        }
      }
      out.push({
        id: areaId,
        name: n.name,
        parentId,
        childrenAreas: subtree,
        components: comps,
        box: { x: 0, y: 0, w: defaults.area.minW, h: defaults.area.minH }
      })
    }
    return out
  }

  const areaTree = buildAreaTree(model.areas ?? [])

  // helper: gather area layout ids by name (including descendants)
  function gatherAreaIdsByName(targetName: string): string[] {
    const out: string[] = []
    function walk(list: AreaLayout[]) {
      for (const a of list) {
        if (a.name === targetName) {
          collect(a)
        } else {
          walk(a.childrenAreas)
        }
      }
    }
    function collect(a: AreaLayout) {
      out.push(a.id)
      for (const ch of a.childrenAreas) collect(ch)
      for (const c of a.components) out.push(c.id)
    }
    walk(areaTree)
    return out
  }

  // Layout constants
  const canvasW = 1400
  const margin = 40
  const topY = 40
  const midY = 160
  const bottomY = 650

  // Agents row (system + human agents, per TAM guidance)
  const agentRow = [...agents, ...users]
  const agentItems = agentRow.map(u => ({ id: u.id, w: defaults.user.w, h: defaults.user.h }))
  const agentGap = agentRow.length ? clamp((canvasW - 2*margin - agentItems.reduce((s,i)=>s+i.w,0)) / Math.max(1, agentRow.length-1), 20, 120) : 40
  const agentsPos = placeRow(agentItems, margin, topY, agentGap)

  // Storages row
  const storageItems = storages.map(s => ({ id: s.id, w: defaults.storage.w, h: defaults.storage.h }))
  const storageGap = storages.length ? clamp((canvasW - 2*margin - storageItems.reduce((s,i)=>s+i.w,0)) / Math.max(1, storages.length-1), 20, 140) : 60
  const storagesPos = placeRow(storageItems, margin, bottomY, storageGap)

  // Area layout (simple: pack horizontally, compute size from children)
  function measureArea(a: AreaLayout): { w: number; h: number } {
    // measure children first
    const childSizes = a.childrenAreas.map(measureArea)
    const compCount = a.components.length
    const cols = Math.max(1, Math.min(3, compCount))
    const rows = Math.ceil(compCount / cols)
    const compsW = cols * defaults.component.w + (cols-1) * 20
    const compsH = rows * defaults.component.h + (rows-1) * 16
    const childrenW = childSizes.length ? childSizes.reduce((s,c)=>s + c.w, 0) + (childSizes.length-1)*20 : 0
    const childrenH = childSizes.length ? Math.max(...childSizes.map(c=>c.h)) : 0

    const innerW = Math.max(compsW, childrenW, defaults.area.minW - 2*defaults.area.pad)
    const innerH = compsH + (compCount && childSizes.length ? 24 : 0) + childrenH
    const w = innerW + 2*defaults.area.pad
    const h = Math.max(defaults.area.minH, innerH + defaults.area.pad + defaults.area.header)
    a.box.w = w
    a.box.h = h
    return { w, h }
  }
  for (const a of areaTree) measureArea(a)

  function totalWidth(areas: AreaLayout[]) {
    if (!areas.length) return 0
    return areas.reduce((s,a)=>s+a.box.w,0) + (areas.length-1)*30
  }

  function layoutAreas(areas: AreaLayout[], x: number, y: number) {
    let curX = x
    for (const a of areas) {
      a.box.x = curX
      a.box.y = y
      // children inside
      const innerX = curX + defaults.area.pad
      const innerY = y + defaults.area.header + defaults.area.pad
      // place nested areas first
      if (a.childrenAreas.length) {
        layoutAreas(a.childrenAreas, innerX, innerY)
      }
      // place components (grid) below nested areas (or at top if none)
      const nestedH = a.childrenAreas.length ? Math.max(...a.childrenAreas.map(ch => ch.box.y + ch.box.h)) - innerY : 0
      const startY = innerY + (a.childrenAreas.length ? nestedH + 24 : 0)
      const cols = Math.max(1, Math.min(3, a.components.length))
      for (let i = 0; i < a.components.length; i++) {
        const c = a.components[i]
        const col = i % cols
        const row = Math.floor(i / cols)
        const cx = innerX + col * (defaults.component.w + 20)
        const cy = startY + row * (defaults.component.h + 16)
        // store as a temp (we'll use a map)
        compPos.set(c.id, { x: cx, y: cy, w: defaults.component.w, h: defaults.component.h, parent: a.id })
      }
      curX += a.box.w + 30
    }
  }

  const compPos = new Map<string, { x: number; y: number; w: number; h: number; parent?: string }>()
  // components not in any area: place in middle row too
  const compsInAreas = new Set<string>()
  function markComps(a: AreaLayout) { for (const c of a.components) compsInAreas.add(c.id); for (const ch of a.childrenAreas) markComps(ch) }
  for (const a of areaTree) markComps(a)
  const freeComps = components.filter(c => !compsInAreas.has(c.id))
  const freeCols = Math.max(1, Math.min(4, freeComps.length))
  for (let i=0;i<freeComps.length;i++){
    const c = freeComps[i]
    const col = i % freeCols
    const row = Math.floor(i / freeCols)
    const cx = margin + col*(defaults.component.w+24)
    const cy = midY + row*(defaults.component.h+20)
    compPos.set(c.id,{x:cx,y:cy,w:defaults.component.w,h:defaults.component.h})
  }

  // layout areas across the middle, centered-ish
  const areasW = totalWidth(areaTree)
  const startX = Math.max(margin, (canvasW - areasW) / 2)
  layoutAreas(areaTree, startX, midY)

  // ------------------------------------------------------------
  // Boundaries (Internet vs On-Prem etc.)
  // We keep the internal layout, then pack boundary columns left-to-right
  // and shift all elements belonging to each boundary accordingly.
  // ------------------------------------------------------------

  const boundaries = (model as any).boundaries ?? []
  const boundaryOrder: Array<{ name: string; children: string[]; id: string }>=[]
  if (Array.isArray(boundaries) && boundaries.length) {
    for (const b of boundaries as any[]) {
      const name = String(b?.name ?? '').trim()
      if (!name) continue
      boundaryOrder.push({ name, children: Array.isArray(b?.children) ? b.children.map((c:any)=>String(c??'').trim()).filter(Boolean) : [], id: stableId('boundary', name) })
    }
  }

  // Map element id -> boundary id
  const boundaryByElementId = new Map<string, string>()
  const boundaryByAreaId = new Map<string, string>()

  // assign explicit children
  for (const b of boundaryOrder) {
    for (const childName of b.children) {
      const el = elements.find(e => e.name === childName)
      if (el) boundaryByElementId.set(el.id, b.id)
      // if boundary lists an area, include the area's descendants
      for (const id of gatherAreaIdsByName(childName)) {
        boundaryByElementId.set(id, b.id)
        if (id.startsWith(stableId('area',''))) {
          // no-op; stableId isn't prefix-stable; we handle area ids separately below
        }
      }
    }
  }

  // if any items are unassigned, put them into an implicit boundary
  const needsUnassigned = boundaryOrder.length > 0 && elements.some(e => !boundaryByElementId.has(e.id))
  if (needsUnassigned) {
    const un = { name: 'Unassigned', children: [], id: stableId('boundary', 'Unassigned') }
    boundaryOrder.push(un)
    for (const e of elements) {
      if (!boundaryByElementId.has(e.id)) boundaryByElementId.set(e.id, un.id)
    }
  }

  // Build quick lookup of top-level area ids by name (so we can parent them to a boundary)
  function markTopLevelAreas(list: AreaLayout[]) {
    for (const a of list) {
      const bId = boundaryByElementId.get(a.id) || boundaryByElementId.get(elements.find(e=>e.kind==='area'&&e.name===a.name)?.id ?? '')
      if (bId) boundaryByAreaId.set(a.id, bId)
      for (const ch of a.childrenAreas) markTopLevelAreas([ch])
    }
  }
  if (boundaryOrder.length) markTopLevelAreas(areaTree)

  // positions for all ids we may shift
  type Pos = { x:number; y:number; w:number; h:number }
  const posById = new Map<string, Pos>()
  for (const [id,p] of agentsPos.entries()) posById.set(id, { x:p.x, y:p.y, w:p.w, h:p.h })
  for (const [id,p] of storagesPos.entries()) posById.set(id, { x:p.x, y:p.y, w:p.w, h:p.h })
  for (const [id,p] of compPos.entries()) posById.set(id, { x:p.x, y:p.y, w:p.w, h:p.h })
  function addAreaPos(list: AreaLayout[]) {
    for (const a of list) {
      posById.set(a.id, { x:a.box.x, y:a.box.y, w:a.box.w, h:a.box.h })
      addAreaPos(a.childrenAreas)
    }
  }
  addAreaPos(areaTree)

  // for each boundary: compute bounds and shift to packed columns
  const boundaryRects: Array<{ id:string; name:string; x:number; y:number; w:number; h:number }>=[]
  if (boundaryOrder.length) {
    let curX = margin
    const diagramTop = 10
    const diagramH = 900

    // compute element sets per boundary
    const idsByBoundary = new Map<string, Set<string>>()
    for (const b of boundaryOrder) idsByBoundary.set(b.id, new Set())
    for (const [id,bId] of boundaryByElementId.entries()) {
      if (!idsByBoundary.has(bId)) continue
      idsByBoundary.get(bId)!.add(id)
    }
    // include components that live inside areas already assigned
    for (const [cid, p] of compPos.entries()) {
      if (p.parent && boundaryByElementId.has(p.parent)) {
        const bId = boundaryByElementId.get(p.parent)!
        idsByBoundary.get(bId)?.add(cid)
      }
    }

    for (const b of boundaryOrder) {
      const ids = idsByBoundary.get(b.id) ?? new Set<string>()
      const pts: Pos[] = []
      for (const id of ids) {
        const p = posById.get(id)
        if (p) pts.push(p)
      }
      if (!pts.length) {
        // empty boundary still rendered with a minimum width
        const w = 380
        boundaryRects.push({ id:b.id, name:b.name, x:curX, y:diagramTop, w, h:diagramH })
        curX += w + boundaryGap
        continue
      }
      const minX = Math.min(...pts.map(p=>p.x))
      const maxX = Math.max(...pts.map(p=>p.x + p.w))
      const w = Math.max(380, (maxX - minX) + 2*boundaryPad)
      const x = curX
      const delta = (x + boundaryPad) - minX

      // apply shift
      for (const id of ids) {
        const p = posById.get(id)
        if (p) p.x += delta
      }
      // also shift nested area boxes
      function shiftAreas(list: AreaLayout[]) {
        for (const a of list) {
          if (ids.has(a.id)) {
            a.box.x += delta
          }
          shiftAreas(a.childrenAreas)
        }
      }
      shiftAreas(areaTree)

      boundaryRects.push({ id:b.id, name:b.name, x, y:diagramTop, w, h:diagramH })
      curX += w + boundaryGap
    }

    // write shifted positions back
    for (const [id,p] of agentsPos.entries()) {
      const pp = posById.get(id); if (pp) { p.x = pp.x }
    }
    for (const [id,p] of storagesPos.entries()) {
      const pp = posById.get(id); if (pp) { p.x = pp.x }
    }
    for (const [id,p] of compPos.entries()) {
      const pp = posById.get(id); if (pp) { p.x = pp.x }
    }

    // resize background to cover all boundaries
    const totalW = boundaryRects.length ? (boundaryRects[boundaryRects.length-1].x + boundaryRects[boundaryRects.length-1].w + margin) : 1600
    const bg = cells.find(c => c.id === 'bg')
    if (bg?.geometry) {
      bg.geometry.width = Math.max(1600, totalW)
      bg.geometry.height = 920
    }
  }

  // Emit boundary columns (behind everything else, above bg)
  for (const b of boundaryRects) {
    cells.push({
      id: b.id,
      value: b.name,
      style: boundaryStyle,
      vertex: 1,
      parent: '1',
      geometry: { x: b.x, y: b.y, width: b.w, height: b.h }
    })
  }

  // Create area vertices
  function emitAreas(areas: AreaLayout[]) {
    for (const a of areas) {
      const parent = boundaryByAreaId.get(a.id) ?? a.parentId ?? '1'
      //const parent = a.parentId ? '1' : '1'
      cells.push({
        id: a.id,
        value: a.name,
        style: styleArea(`fillColor=${palette.panel};swimlaneFillColor=${palette.panel2};strokeColor=${palette.stroke};fontStyle=1;`),
        vertex: 1,
        parent,
        geometry: { x: a.box.x, y: a.box.y, width: a.box.w, height: a.box.h }
      })
      // optional header icon (small image in title)
      const iconId = stableId('areaIcon', a.id)
      cells.push({
        id: iconId,
        value: '',
        style: styleImage(ICONS.common_feature_areas, 'perimeter=none;'),
        vertex: 1,
        parent: a.id,
        geometry: { x: 8, y: 6, width: 48, height: 14 }
      })
      emitAreas(a.childrenAreas)
    }
  }
  emitAreas(areaTree)

  // Create agent vertices
  for (const a of agents) {
    const p = agentsPos.get(a.id)!
    cells.push({
      id: a.id,
      value: a.name,
      style: styleImage(ICONS.agent, `fontColor=${palette.text};`),
      vertex: 1,
      parent: boundaryByElementId.get(a.id) ?? '1',
      geometry: { x: p.x, y: p.y, width: p.w, height: p.h }
    })
  }

  // Create human agent vertices
  for (const u of users) {
    const p = agentsPos.get(u.id)!
    cells.push({
      id: u.id,
      value: u.name,
      style: styleImage(ICONS.human, `fontColor=${palette.text};`),
      vertex: 1,
      parent: boundaryByElementId.get(u.id) ?? '1',
      geometry: { x: p.x, y: p.y, width: p.w, height: p.h }
    })
  }

  // Create storage vertices
  for (const s of storages) {
    const p = storagesPos.get(s.id)!
    cells.push({
      id: s.id,
      value: s.name,
      style: styleImage(ICONS.storage, `fontColor=${palette.text};`),
      vertex: 1,
      parent: boundaryByElementId.get(s.id) ?? '1',
      geometry: { x: p.x, y: p.y, width: p.w, height: p.h }
    })
  }

  // Create component vertices
  for (const c of components) {
    const p = compPos.get(c.id)
    if (!p) continue
    cells.push({
      id: c.id,
      value: c.name,
      style: styleRect(`fillColor=${palette.panel2};strokeColor=${palette.strokeSoft};`),
      vertex: 1,
      parent: p.parent ?? boundaryByElementId.get(c.id) ?? '1',
      geometry: { x: p.x, y: p.y, width: p.w, height: p.h }
    })
  }

  // edges
  let edgeCount = 0
  function newEdgeId(key: string) { edgeCount++; return stableId('e', `${key}:${edgeCount}`) }

  const nameToId = new Map(elements.map(e => [e.name, e.id] as const))

  function edgeLabelId(edgeId: string, suffix: string) {
    return stableId('label', `${edgeId}:${suffix}`)
  }

  for (let i = 0; i < (model.connections ?? []).length; i++) {
    const c: any = (model.connections ?? [])[i]
    const fromId = nameToId.get((c.from ?? '').trim())
    const toId = nameToId.get((c.to ?? '').trim())
    if (!fromId || !toId) continue

    if (c.kind === 'channel') {
      const dir = c.direction as any
      const protocol = String(c.protocol ?? '').trim()
      const label = String(c.label ?? '').trim()
      let source = fromId, target = toId
      let edgeStyle = styleEdge('')
      if (dir === '<-') { source = toId; target = fromId }
      if (dir === '<->') edgeStyle = styleEdgeBidir('')
      if (dir === 'reqres') edgeStyle = styleEdge('') // request direction follows from->to

      const eid = stableId('channel', `${c.from}|${c.to}|${dir}|${protocol}|${label}`)
      cells.push({
        id: eid,
        value: '', // edge value handled by labels
        style: edgeStyle,
        edge: 1,
        parent: '1',
        source,
        target,
        geometry: { relative: 1 }
      })

      // protocol / label as edge label
      const text = [label, protocol].filter(Boolean).join('\n')
      if (text) {
        cells.push({
          id: edgeLabelId(eid, 'text'),
          value: text,
          style: `shape=label;align=center;verticalAlign=middle;html=1;resizable=0;points=[];whiteSpace=wrap;fillColor=${palette.bg};strokeColor=none;fontColor=${palette.text};`,
          vertex: 1,
          parent: eid,
          geometry: { x: 0.5, y: -20, width: 1, height: 1, relative: 1 }
        })
      }

      if (dir === 'reqres') {
        const reqMarker = (c.direction === '<-') ? '←R' : 'R→'
        cells.push({
          id: edgeLabelId(eid, 'req'),
          value: reqMarker,
          style: `shape=label;align=center;verticalAlign=middle;html=1;resizable=0;points=[];whiteSpace=wrap;fillColor=${palette.bg};strokeColor=${palette.stroke};rounded=1;fontStyle=1;fontColor=${palette.text};`,
          vertex: 1,
          parent: eid,
          geometry: { x: 0.5, y: 10, width: 28, height: 18, relative: 1 }
        })
      }
    }

    if (c.kind === 'access') {
      const access = String(c.access ?? '').trim()
      const label = String(c.label ?? '').trim()
      let source = fromId, target = toId
      // Accesses connect agents to storages (Read/Write/Modify), shown as dashed lines per TAM.
      let edgeStyle = styleEdge(`strokeColor=${palette.access};dashed=1;`)
      let icon = ICONS.read_write_modify_both
      if (access === 'read_write_modify_both') { edgeStyle = styleEdgeBidir(`strokeColor=${palette.access};dashed=1;`); icon = ICONS.read_write_modify_both }
      if (access === 'read_write_modify_single_right') { edgeStyle = styleEdge(`strokeColor=${palette.access};dashed=1;`); icon = ICONS.read_write_modify_single_right }
      if (access === 'read_write_modify_single_left') { edgeStyle = styleEdge(`strokeColor=${palette.access};dashed=1;`); icon = ICONS.read_write_modify_single_left; source = toId; target = fromId }

      const eid = stableId('access', `${c.from}|${c.to}|${access}|${label}`)
      cells.push({
        id: eid,
        value: '',
        style: edgeStyle,
        edge: 1,
        parent: '1',
        source,
        target,
        geometry: { relative: 1 }
      })

      // access icon as edge label (image)
      cells.push({
        id: edgeLabelId(eid, 'icon'),
        value: '',
        style: styleImage(icon, 'perimeter=none;'),
        vertex: 1,
        parent: eid,
        geometry: { x: 0.5, y: -8, width: 64, height: 20, relative: 1 }
      })

      if (label) {
        cells.push({
          id: edgeLabelId(eid, 'label'),
          value: label,
          style: `shape=label;align=center;verticalAlign=middle;html=1;resizable=0;points=[];whiteSpace=wrap;fillColor=${palette.bg};strokeColor=none;fontColor=${palette.text};`,
          vertex: 1,
          parent: eid,
          geometry: { x: 0.5, y: 18, width: 1, height: 1, relative: 1 }
        })
      }
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" modified="${new Date().toISOString()}" agent="tam-drawio-local" version="20.8.16" type="device">
  <diagram id="${DIAGRAM_ID}" name="Page-1">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="900" math="0" shadow="0">
      <root>
        ${cells.map(xmlCell).join('\n        ')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`

  const vertices = cells.filter(c=>c.vertex).length
  const edges = cells.filter(c=>c.edge).length
  return { xml, stats: { vertices, edges } }
}
