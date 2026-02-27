/* Minimal helpers for TAM edge semantics (SAP PowerDesigner TAM Block Diagram).
 *
 * These are intentionally small and self-contained so they can be reused by any
 * future interactive mxGraph editor features (eg. drag-to-connect).
 */

export type TamCategory = 'communication' | 'access'
export type TamCommunicationType = 'unidirectional' | 'bidirectional' | 'requestResponse'
export type TamAccessType = 'readAccess' | 'writeAccess' | 'modifyAccess'
export type TamDirection = 'sourceToTarget' | 'targetToSource'

function getStyle(cell: any): string {
  return String(cell?.getStyle?.() ?? cell?.style ?? '')
}

function setStyle(cell: any, style: string) {
  if (!cell) return
  if (typeof cell.setStyle === 'function') cell.setStyle(style)
  else cell.style = style
}

function setStyleKey(style: string, key: string, value: string): string {
  // mxGraph styles are `k=v;...`. Remove existing key then append.
  const parts = style
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(p => !p.startsWith(key + '='))
  parts.push(`${key}=${value}`)
  return parts.join(';') + ';'
}

export function isStorageNode(cell: any): boolean {
  // Prefer explicit field, otherwise infer from style.
  const v = String(cell?.getAttribute?.('nodeType') ?? cell?.value?.nodeType ?? '')
  if (v === 'storage') return true
  const style = getStyle(cell)
  // Heuristic: storage shapes are images referencing the storage icon.
  return /storage\.svg/i.test(style) || /tamNodeType=storage/i.test(style)
}

export function isActiveNode(cell: any): boolean {
  const v = String(cell?.getAttribute?.('nodeType') ?? cell?.value?.nodeType ?? '')
  if (v === 'component' || v === 'subcomponent') return true
  // Default heuristic: any vertex that isn't a storage.
  return !!cell?.vertex && !isStorageNode(cell)
}

export function inferTamCategory(source: any, target: any): TamCategory | 'blocked' {
  const sStorage = isStorageNode(source)
  const tStorage = isStorageNode(target)
  if (sStorage && tStorage) return 'blocked'
  if ((sStorage && isActiveNode(target)) || (tStorage && isActiveNode(source))) return 'access'
  return 'communication'
}

export function applyTamCommunicationStyle(
  edge: any,
  opts: { tamEdgeType: TamCommunicationType; protocol: string; direction: TamDirection }
) {
  const { tamEdgeType, protocol, direction } = opts

  let startArrow = 'none'
  let endArrow = 'none'
  if (tamEdgeType === 'bidirectional' || tamEdgeType === 'requestResponse') {
    startArrow = 'block'
    endArrow = 'block'
  } else {
    if (direction === 'sourceToTarget') endArrow = 'block'
    else startArrow = 'block'
  }

  let style = getStyle(edge)
  style = setStyleKey(style, 'startArrow', startArrow)
  style = setStyleKey(style, 'endArrow', endArrow)
  style = setStyleKey(style, 'tamCategory', 'communication')
  style = setStyleKey(style, 'tamEdgeType', tamEdgeType)
  style = setStyleKey(style, 'direction', direction)
  style = setStyleKey(style, 'protocol', protocol)
  setStyle(edge, style)

  // Protocol is the edge label.
  if (edge) edge.value = protocol
}

export function applyTamAccessStyle(
  edge: any,
  opts: { tamEdgeType: TamAccessType; direction: TamDirection; displayAsDoubleArc?: boolean }
) {
  const { tamEdgeType, direction, displayAsDoubleArc } = opts

  let startArrow = 'none'
  let endArrow = 'none'

  if (tamEdgeType === 'modifyAccess') {
    startArrow = 'block'
    endArrow = 'block'
  } else {
    if (direction === 'sourceToTarget') endArrow = 'block'
    else startArrow = 'block'
  }

  let style = getStyle(edge)
  style = setStyleKey(style, 'dashed', '1')
  style = setStyleKey(style, 'dashPattern', '4 4')
  style = setStyleKey(style, 'startArrow', startArrow)
  style = setStyleKey(style, 'endArrow', endArrow)
  style = setStyleKey(style, 'tamCategory', 'access')
  style = setStyleKey(style, 'tamEdgeType', tamEdgeType)
  style = setStyleKey(style, 'direction', direction)
  if (tamEdgeType === 'modifyAccess') {
    style = setStyleKey(style, 'displayAsDoubleArc', displayAsDoubleArc === false ? '0' : '1')
  }
  setStyle(edge, style)
}

export function reverseTamEdge(edge: any) {
  if (!edge) return

  // Swap endpoints where possible.
  const tmp = edge.source
  edge.source = edge.target
  edge.target = tmp

  // Flip persisted direction + arrowheads.
  const style = getStyle(edge)
  const dirMatch = /direction=([^;]+);?/i.exec(style)
  const dir = (dirMatch?.[1] ?? 'sourceToTarget') as TamDirection
  const nextDir: TamDirection = dir === 'sourceToTarget' ? 'targetToSource' : 'sourceToTarget'

  let next = style
  next = setStyleKey(next, 'direction', nextDir)

  const sMatch = /startArrow=([^;]+);?/i.exec(style)
  const eMatch = /endArrow=([^;]+);?/i.exec(style)
  const startArrow = sMatch?.[1]
  const endArrow = eMatch?.[1]
  if (startArrow || endArrow) {
    next = setStyleKey(next, 'startArrow', endArrow ?? 'none')
    next = setStyleKey(next, 'endArrow', startArrow ?? 'none')
  }

  setStyle(edge, next)

  // If there's a request/response marker label, flip its arrow glyph.
  const kids = edge?.children ?? []
  for (const k of kids) {
    const v = String(k?.value ?? '')
    if (v === 'R→') k.value = '←R'
    else if (v === '←R') k.value = 'R→'
  }
}
