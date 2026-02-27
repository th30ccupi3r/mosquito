export type Direction = '->' | '<-' | '<->' | 'reqres'
export type ConnectionKind = 'channel' | 'access'

export type AreaNode =
  | { name: string; children?: AreaNode[] } // nested area
  | { name: string; type: 'component' }     // component inside an area

export interface Boundary {
  /** Boundary title, e.g. "Internet" or "On-Premise" */
  name: string
  /** Names of elements or feature areas to place inside this boundary. */
  children: string[]
}

export interface TamModel {
  /** Non-human (system) agents. */
  agents?: string[]
  /** Human agents (kept for backwards compatibility with early templates). */
  users?: string[]
  storages?: string[]
  /** Deployment/network boundaries, e.g. Internet vs On-Premise */
  boundaries?: Boundary[]
  areas?: AreaNode[]
  connections?: Array<
    | { from: string; to: string; kind: 'channel'; direction: Direction; protocol: string; label?: string }
    | { from: string; to: string; kind: 'access'; access: 'read_write_modify_both' | 'read_write_modify_single_right' | 'read_write_modify_single_left'; label?: string }
  >
}

export type ElementKind = 'agent' | 'user' | 'storage' | 'component' | 'area'

export interface ElementRef {
  id: string
  name: string
  kind: ElementKind
  parentAreaId?: string
}

export interface ValidationIssue {
  level: 'error' | 'warn'
  message: string
  path?: string
}
