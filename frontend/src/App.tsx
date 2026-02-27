import React, { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { yaml as yamlLang } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import { debounce } from './utils'
import MxGraphPreview from './MxGraphPreview'
import { AddConnectionModal, TamAccessType, TamCommunicationType, TamDirection, TamMarkerPos } from './AddConnectionModal'
import { AddBoundaryModal, type BoundaryConfig } from './AddBoundaryModal'
import { extractAgentNames, extractComponentNames, extractHumanNames, extractNodeNames, extractStorageNames, extractSubcomponentNames } from './yamlModel'
import { AddSubcomponentModal } from './AddSubcomponentModal'
import { RenameModal, RenameKind } from './RenameModal'
import YAML from 'js-yaml'

type Issue = { level: 'error' | 'warn'; message: string; path?: string }
type RenderResponse = { xml: string; issues: Issue[] }

function mergeEditedRouting(baseXml: string, editedXml: string): string {
  if (!baseXml || !editedXml) return baseXml
  try {
    const parser = new DOMParser()
    const baseDoc = parser.parseFromString(baseXml, 'application/xml')
    const editedDoc = parser.parseFromString(editedXml, 'application/xml')
    if (baseDoc.querySelector('parsererror') || editedDoc.querySelector('parsererror')) return baseXml

    const edgeIds = new Set<string>()
    const editedCells = Array.from(editedDoc.getElementsByTagName('mxCell'))
    for (const cell of editedCells) {
      if (cell.getAttribute('edge') === '1') {
        const id = cell.getAttribute('id')
        if (id) edgeIds.add(id)
      }
    }

    const editedById = new Map<string, Element>()
    for (const cell of editedCells) {
      const id = cell.getAttribute('id')
      if (!id) continue
      const parentId = cell.getAttribute('parent')
      if (edgeIds.has(id) || (parentId && edgeIds.has(parentId))) {
        editedById.set(id, cell)
      }
    }

    const baseCells = Array.from(baseDoc.getElementsByTagName('mxCell'))
    for (const baseCell of baseCells) {
      const id = baseCell.getAttribute('id')
      if (!id) continue
      const editedCell = editedById.get(id)
      if (!editedCell) continue

      const editedGeom = editedCell.getElementsByTagName('mxGeometry')[0]
      if (!editedGeom) continue
      const baseGeom = baseCell.getElementsByTagName('mxGeometry')[0]
      const cloned = editedGeom.cloneNode(true) as Element
      if (baseGeom && baseGeom.parentNode === baseCell) baseCell.replaceChild(cloned, baseGeom)
      else baseCell.appendChild(cloned)
    }

    return new XMLSerializer().serializeToString(baseDoc)
  } catch {
    return baseXml
  }
}

function downloadText(filename: string, text: string, mime = 'application/xml') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

async function renderYaml(yamlText: string): Promise<RenderResponse> {
  // Use relative path; Vite proxies /render to the local backend.
  const res = await fetch('/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ yaml: yamlText })
  })
  if (!res.ok) {
    return { xml: '', issues: [{ level: 'error', message: `Backend error: ${res.status} ${res.statusText}` }] }
  }
  return (await res.json()) as RenderResponse
}

export default function App() {
  // Start truly empty. We'll scaffold the minimal TAM structure only once the user
  // begins inserting elements.
  const DEFAULT_YAML = ''
  const BASE_TAM_DOC = `trust_boundaries:\nhuman_agents:\nagents:\nareas:\ncomponents:\nstorages:\nchannels:\naccesses:\n`

  const [yamlText, setYamlText] = useState<string>(DEFAULT_YAML)
  const [xml, setXml] = useState('')
  // When the user manually adjusts routing in the preview, we keep an override
  // XML so export reflects the exact line layout.
  const [editedXml, setEditedXml] = useState<string>('')
  const editedXmlRef = useRef<string>('')
  const [editRoutes, setEditRoutes] = useState<boolean>(false)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark'
    return localStorage.getItem('tamTheme') === 'light' ? 'light' : 'dark'
  })
  const [issues, setIssues] = useState<Issue[]>([])
  const [status, setStatus] = useState<'idle' | 'rendering'>('idle')
  const editorRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const nodeNames = useMemo(() => extractNodeNames(yamlText), [yamlText])
  const componentNames = useMemo(() => extractComponentNames(yamlText), [yamlText])
  const storageNames = useMemo(() => extractStorageNames(yamlText), [yamlText])
const humanNames = useMemo(() => extractHumanNames(yamlText), [yamlText])
const agentNames = useMemo(() => extractAgentNames(yamlText), [yamlText])
  const subcomponentNames = useMemo(() => extractSubcomponentNames(yamlText), [yamlText])
  const activeNames = useMemo(() => {
    // Active elements include components, subcomponents, and other "active" nodes (humans/agents).
    return [...new Set([...componentNames, ...subcomponentNames, ...humanNames, ...agentNames])]
  }, [componentNames.join('|'), subcomponentNames.join('|'), humanNames.join('|'), agentNames.join('|')])
  const [connOpen, setConnOpen] = useState(false)
  const [boundaryOpen, setBoundaryOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [subOpen, setSubOpen] = useState(false)

  const rerender = useMemo(
    () =>
      debounce(async (text: string) => {
        // When empty, don't render anything and don't show validation noise.
        if (!text.trim()) {
          localStorage.setItem('tamYaml', '')
          setXml('')
          setIssues([])
          setStatus('idle')
          return
        }

        localStorage.setItem('tamYaml', text)
        setStatus('rendering')
        try {
          const out = await renderYaml(text)
          setXml(out.xml)
          // Preserve manual edge routing edits (and edge-attached markers) for
          // unchanged edges when YAML changes.
          const merged = mergeEditedRouting(out.xml, editedXmlRef.current)
          setEditedXml(merged === out.xml ? '' : merged)
          setIssues(out.issues ?? [])
        } catch (e: any) {
          setXml('')
          setIssues([{ level: 'error', message: `Failed to reach backend: ${e?.message ?? String(e)}` }])
        } finally {
          setStatus('idle')
        }
      }, 400),
    []
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('tamTheme', theme)
  }, [theme])

  useEffect(() => {
    editedXmlRef.current = editedXml
  }, [editedXml])

  useEffect(() => {
    // Intentionally do not auto-render on first mount.
    // The initial experience should be an empty editor with no diagram.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onChange(val: string) {
    setYamlText(val)
    rerender(val)
  }

  const hasErrors = issues.some((i) => i.level === 'error')

  // Toolbar snippet helpers
  function insertUnderTopLevelKey(key: string, snippet: string) {
    const current = yamlText.trim() ? yamlText : BASE_TAM_DOC
    const lines = current.split(/\r?\n/)
    const headerRe = new RegExp(`^${key}\\s*:\\s*(?:\\[\\s*\\]|null)?\\s*$`)
    const idx = lines.findIndex((l) => headerRe.test(l.trim()))

    if (idx === -1) {
      const next = current.replace(/\s*$/, '') + `\n\n${key}:\n` + snippet.trimEnd() + `\n`
      onChange(next)
      return
    } 

    // Normalize `key: []` or `key: null` into a proper section header so we don't create duplicate keys
    // (duplicate keys can break parsing and make connection dropdowns empty)
    if (idx !== -1 && new RegExp(`^\\s*${key}\\s*:\\s*(?:\\[\\s*\\]|null)\\s*$`).test(lines[idx])) {
      lines[idx] = `${key}:`
    }

    let insertAt = lines.length
    for (let i = idx + 1; i < lines.length; i++) {
      const l = lines[i]
      const t = l.trim()
      // Next top-level section starts at any unindented "key:" line (with or without a value like null/[]).
      // This prevents inserting list items under the wrong section when keys like "accesses: null" exist.
      if (/^[A-Za-z0-9_]+\s*:\s*(?:.*)?$/.test(t) && !l.startsWith('  ') && !l.startsWith('\t')) {
        insertAt = i
        break
      }
    }
    lines.splice(insertAt, 0, snippet.trimEnd())
    onChange(lines.join('\n'))
  }

  function nextNumber(prefixRe: RegExp): number {
    const nums = [...yamlText.matchAll(prefixRe)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n))
    return (nums.length ? Math.max(...nums) : 0) + 1
  }

  const addHuman = () => {
    const n = nextNumber(/\bNew Customer (\d+)\b/g)
    insertUnderTopLevelKey('human_agents', `  - New Customer ${n}\n`)
  }
  const addAgent = () => {
    const n = nextNumber(/\bNew Agent (\d+)\b/g)
    insertUnderTopLevelKey('agents', `  - name: New Agent ${n}\n`)
  }
  const addComponent = () => {
    const n = nextNumber(/\bNew Component (\d+)\b/g)
    insertUnderTopLevelKey('components', `  - name: New Component ${n}\n`)
  }
  const addStorage = () => {
    const n = nextNumber(/\bNew Storage (\d+)\b/g)
    insertUnderTopLevelKey('storages', `  - New Storage ${n}\n`)
  }

function insertSubcomponent(parentComponent: string, subName: string) {
  const base = yamlText.trim() ? yamlText : BASE_TAM_DOC
  let doc: any = {}
  try {
    doc = (YAML.load(base) as any) ?? {}
  } catch {
    doc = {}
  }
  if (!Array.isArray(doc.components)) doc.components = []
  // Normalize components into objects with name
  doc.components = doc.components
    .map((c: any) => (typeof c === 'string' ? { name: c } : c))
    .filter((c: any) => c && typeof c.name === 'string')

  const comp = doc.components.find((c: any) => c.name === parentComponent)
  if (!comp) return

  if (!Array.isArray(comp.subcomponents)) comp.subcomponents = []
  comp.subcomponents.push({ name: subName })

  const dumped = YAML.dump(doc, { noRefs: true, lineWidth: -1 }).trimEnd() + "\n"
  onChange(dumped)
}

  function insertChannel(channel: {
    from: string
    to: string
    tamEdgeType: TamCommunicationType
    direction: TamDirection
    protocol: string
    sourceArrowPos?: TamMarkerPos
    targetArrowPos?: TamMarkerPos
    rMarkerPos?: TamMarkerPos
  }) {
    const n = nextNumber(/\bname:\s*chan_(\d+)\b/g)
    const entryLines = [
      `  - name: chan_${n}`,
      `    from: ${JSON.stringify(channel.from)}`,
      `    to: ${JSON.stringify(channel.to)}`,
      `    protocol: ${JSON.stringify(channel.protocol)}`,
      `    tamEdgeType: ${JSON.stringify(channel.tamEdgeType)}`,
      `    direction: ${JSON.stringify(channel.direction)}`
    ]
    if (typeof channel.sourceArrowPos === 'number') entryLines.push(`    sourceArrowPos: ${channel.sourceArrowPos}`)
    if (typeof channel.targetArrowPos === 'number') entryLines.push(`    targetArrowPos: ${channel.targetArrowPos}`)
    if (typeof channel.rMarkerPos === 'number' && channel.tamEdgeType === 'requestResponse') entryLines.push(`    rMarkerPos: ${channel.rMarkerPos}`)
    const entry = entryLines.join('\n') + '\n'
    insertUnderTopLevelKey('channels', entry)
  }

  function insertAccess(access: {
    from: string
    to: string
    tamEdgeType: TamAccessType
    direction: TamDirection
    displayAsDoubleArc?: boolean
    sourceArrowPos?: TamMarkerPos
    targetArrowPos?: TamMarkerPos
    modifySymbolPos?: TamMarkerPos
  }) {
    const entryLines = [
      `  - from: ${JSON.stringify(access.from)}`,
      `    to: ${JSON.stringify(access.to)}`,
      `    tamEdgeType: ${JSON.stringify(access.tamEdgeType)}`,
      `    direction: ${JSON.stringify(access.direction)}`
    ]
    if (access.tamEdgeType === 'modifyAccess') {
      entryLines.push(`    displayAsDoubleArc: ${access.displayAsDoubleArc !== false ? 'true' : 'false'}`)
      if (typeof access.modifySymbolPos === 'number') entryLines.push(`    modifySymbolPos: ${access.modifySymbolPos}`)
    }
    if (typeof access.sourceArrowPos === 'number') entryLines.push(`    sourceArrowPos: ${access.sourceArrowPos}`)
    if (typeof access.targetArrowPos === 'number') entryLines.push(`    targetArrowPos: ${access.targetArrowPos}`)
    const entry = entryLines.join('\n') + '\n'
    insertUnderTopLevelKey('accesses', entry)
  }

  function replaceOrInsertTopLevelBlock(key: string, block: string) {
    const text = yamlText.trim() ? yamlText : BASE_TAM_DOC
    const reBlock = new RegExp(`^${key}\\s*:\\s*\\n(?:^[ \\t].*\\n)*`, 'm')
    if (reBlock.test(text)) {
      const next = text.replace(reBlock, block)
      onChange(next)
      return
    }
    // Insert near the top (after an optional existing YAML header comments).
    const next = block + (text.startsWith('\n') ? text : '\n' + text)
    onChange(next)
  }

  
  function getBoundaryAssignmentsFromYaml(): import('./AddBoundaryModal').BoundaryAssignments {
    try {
      const doc = (YAML.load(yamlText) as any) ?? {}

      const out = {
        components: {} as { [name: string]: 'left' | 'right' | 'main' },
        humans: {} as { [name: string]: 'left' | 'right' | 'main' },
        agents: {} as { [name: string]: 'left' | 'right' | 'main' },
        storages: {} as { [name: string]: 'left' | 'right' | 'main' }
      }

      const norm = (b: any): 'left' | 'right' | 'main' => (b === 'left' || b === 'right') ? b : 'main'

      const comps = Array.isArray(doc.components) ? doc.components : []
      for (const c of comps) {
        const name = typeof c === 'string' ? c : c?.name
        if (!name) continue
        const b = typeof c === 'object' ? c.boundary : undefined
        out.components[String(name)] = norm(b)
      }

      const humans = Array.isArray(doc.human_agents) ? doc.human_agents : []
      for (const h of humans) {
        const name = typeof h === 'string' ? h : h?.name
        if (!name) continue
        const b = typeof h === 'object' ? h.boundary : undefined
        out.humans[String(name)] = norm(b)
      }

      const agents = Array.isArray(doc.agents) ? doc.agents : []
      for (const a of agents) {
        const name = typeof a === 'string' ? a : a?.name
        if (!name) continue
        const b = typeof a === 'object' ? a.boundary : undefined
        out.agents[String(name)] = norm(b)
      }

      const storages = Array.isArray(doc.storages) ? doc.storages : []
      for (const s of storages) {
        const name = typeof s === 'string' ? s : s?.name
        if (!name) continue
        const b = typeof s === 'object' ? s.boundary : undefined
        out.storages[String(name)] = norm(b)
      }

      return out
    } catch {
      return { components: {}, humans: {}, agents: {}, storages: {} }
    }
  }

function applyBoundaries(cfg: BoundaryConfig, assignments?: { [name: string]: 'left' | 'right' | 'main' }) {
    // Apply boundaries + component assignments in a single YAML parse/dump pass.
    // Doing this in two passes can lose the inserted "boundaries" block due to React state timing.
    try {
      const doc = (YAML.load(yamlText) as any) ?? {}
      doc.boundaries = {
        left: { enabled: !!cfg.left.enabled, label: (cfg.left.label || 'Left').trim() },
        right: { enabled: !!cfg.right.enabled, label: (cfg.right.label || 'Right').trim() }
      }

      if (assignments) {
        const normSide = (v: any) => (v === 'left' || v === 'right') ? v : null

        const comps = Array.isArray(doc.components) ? doc.components : []
        doc.components = comps.map((c: any) => {
          const name = typeof c === 'string' ? c : c?.name
          if (!name) return c
          const a = normSide(assignments.components?.[String(name)])
          if (!a) {
            if (typeof c === 'string') return c
            const { boundary, ...rest } = c
            return rest
          }
          // ensure object form so we can carry boundary property
          if (typeof c === 'string') return { name: c, boundary: a }
          return { ...c, boundary: a }
        })

        const humans = Array.isArray(doc.human_agents) ? doc.human_agents : []
        doc.human_agents = humans.map((h: any) => {
          const name = typeof h === 'string' ? h : h?.name
          if (!name) return h
          const a = normSide(assignments.humans?.[String(name)])
          if (!a) {
            if (typeof h === 'string') return h
            const { boundary, ...rest } = h
            return rest
          }
          if (typeof h === 'string') return { name: h, boundary: a }
          return { ...h, boundary: a }
        })

        const agents = Array.isArray(doc.agents) ? doc.agents : []
        doc.agents = agents.map((ag: any) => {
          const name = typeof ag === 'string' ? ag : ag?.name
          if (!name) return ag
          const a = normSide(assignments.agents?.[String(name)])
          if (!a) {
            if (typeof ag === 'string') return ag
            const { boundary, ...rest } = ag
            return rest
          }
          if (typeof ag === 'string') return { name: ag, boundary: a }
          return { ...ag, boundary: a }
        })

        const storages = Array.isArray(doc.storages) ? doc.storages : []
        doc.storages = storages.map((s: any) => {
          const name = typeof s === 'string' ? s : s?.name
          if (!name) return s
          const a = normSide(assignments.storages?.[String(name)])
          if (!a) {
            if (typeof s === 'string') return s
            const { boundary, ...rest } = s
            return rest
          }
          if (typeof s === 'string') return { name: s, boundary: a }
          return { ...s, boundary: a }
        })
      }

      onChange(YAML.dump(doc, { lineWidth: -1 }))
    } catch (e) {
      // Fallback: if YAML is invalid for some reason, at least insert boundaries block.
      const block =
        `boundaries:
` +
        `  left:
` +
        `    enabled: ${cfg.left.enabled ? 'true' : 'false'}
` +
        `    label: ${JSON.stringify(cfg.left.label || 'Left')}
` +
        `  right:
` +
        `    enabled: ${cfg.right.enabled ? 'true' : 'false'}
` +
        `    label: ${JSON.stringify(cfg.right.label || 'Right')}
`
      replaceOrInsertTopLevelBlock('boundaries', block)
    }
  }

  const addConnection = () => setConnOpen(true)
  const addBoundary = () => setBoundaryOpen(true)

  const exportDrawio = () => {
    const toExport = editedXml || xml
    if (!toExport || hasErrors) return
    downloadText('tam-diagram.drawio', toExport)
  }

  const downloadYaml = () => {
    downloadText('tam-model.yaml', yamlText, 'text/yaml')
  }

  const loadYamlFromDisk = () => {
    fileInputRef.current?.click()
  }

  const onLoadYamlFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      onChange(text)
    }
    reader.readAsText(file)
  }

  const applyRename = (kind: RenameKind, fromName: string, toName: string) => {
    try {
      const doc = (YAML.load(yamlText) as any) ?? {}

      const replaceEndpoint = (s: any) => {
        if (typeof s !== 'string') return s
        const v = s
        if (kind === 'component') {
          if (v === fromName) return toName
          if (v.startsWith(fromName + '/')) return toName + v.slice(fromName.length)
          return v
        }
        if (kind === 'storage') {
          return v === fromName ? toName : v
        }
        // subcomponent: fromName is qualified Comp/Sub
        const [c, sc] = fromName.split('/', 2)
        if (!c || !sc) return v
        if (v === fromName) return `${c}/${toName}`
        return v
      }

      // components
      if (Array.isArray(doc.components)) {
        doc.components = doc.components.map((c: any) => {
          if (typeof c === 'string') {
            return kind === 'component' && c === fromName ? toName : c
          }
          if (c && typeof c === 'object') {
            if (kind === 'component' && typeof c.name === 'string' && c.name === fromName) c.name = toName
            if (kind === 'subcomponent' && typeof c.name === 'string') {
              const [pc, psc] = fromName.split('/', 2)
              if (pc && psc && c.name === pc && Array.isArray(c.subcomponents)) {
                c.subcomponents = c.subcomponents.map((scObj: any) => {
                  if (typeof scObj === 'string') return scObj === psc ? toName : scObj
                  if (scObj && typeof scObj.name === 'string' && scObj.name === psc) scObj.name = toName
                  return scObj
                })
              }
            }
          }
          return c
        })
      }

      // storages
      if (Array.isArray(doc.storages)) {
        doc.storages = doc.storages.map((s: any) => {
          if (typeof s === 'string') return kind === 'storage' && s === fromName ? toName : s
          if (s && typeof s === 'object' && typeof s.name === 'string') {
            if (kind === 'storage' && s.name === fromName) s.name = toName
          }
          return s
        })
      }

      // channels endpoints
      if (Array.isArray(doc.channels)) {
        doc.channels = doc.channels.map((ch: any) => {
          if (ch && typeof ch === 'object') {
            ch.from = replaceEndpoint(ch.from)
            ch.to = replaceEndpoint(ch.to)
          }
          return ch
        })
      }

      // accesses endpoints (best-effort)
      if (Array.isArray(doc.accesses)) {
        doc.accesses = doc.accesses.map((a: any) => {
          if (a && typeof a === 'object') {
            if ('from' in a) a.from = replaceEndpoint((a as any).from)
            if ('to' in a) a.to = replaceEndpoint((a as any).to)
            if ('actor' in a) a.actor = replaceEndpoint((a as any).actor)
            if ('resource' in a) a.resource = replaceEndpoint((a as any).resource)
          }
          return a
        })
      }

      const dumped = YAML.dump(doc, { lineWidth: -1, noRefs: true, sortKeys: false })
      onChange(dumped)
    } catch (e: any) {
      alert(`Rename failed: ${e?.message ?? String(e)}`)
    }
  }

  return (
    <div className="tam-root">
      <div className="tam-toolbar">
        <div className="tb-left">
          <div className="tb-title">Mosquito: TAM Builder</div>
          <button className="tb-btn" onClick={addAgent}>Add Agent</button>
          <button className="tb-btn" onClick={addHuman}>Add Human Agent</button>
          <button className="tb-btn" onClick={addComponent}>Add Component</button>
          <button className="tb-btn" onClick={() => setSubOpen(true)} disabled={componentNames.length === 0}>Add Subcomponent</button>
          <button className="tb-btn" onClick={addStorage}>Add Storage</button>
          <button className="tb-btn" onClick={addConnection}>Add Connection</button>
          <button className="tb-btn" onClick={addBoundary}>Add Boundary</button>
        </div>
        <div className="tb-right">
          <button className="tb-btn" onClick={loadYamlFromDisk}>
            Load YAML
          </button>
          <button className="tb-btn" onClick={() => setRenameOpen(true)} disabled={!yamlText.trim()}>
            Rename…
          </button>
          <button className="tb-btn" onClick={downloadYaml}>
            Save YAML
          </button>
          <button className="tb-btn" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>
            Theme: {theme === 'dark' ? 'Dark' : 'Light'}
          </button>
          <button
            className="tb-btn"
            onClick={() => setEditRoutes((v) => !v)}
            disabled={!xml || hasErrors}
            title="Let you drag edge lines to add waypoints and avoid overlaps. Export will include your routing."
          >
            {editRoutes ? 'Routing: ON' : 'Routing: OFF'}
          </button>
          {editedXml && (
            <button
              className="tb-btn"
              onClick={() => setEditedXml('')}
              disabled={!xml || hasErrors}
              title="Discard manual routing edits and revert to YAML-rendered layout"
            >
              Reset routing
            </button>
          )}
          <button className="tb-btn" onClick={exportDrawio} disabled={!xml || hasErrors}>
            Export .drawio
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".yaml,.yml,text/yaml,text/plain"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onLoadYamlFile(f)
          // allow re-selecting same file
          e.currentTarget.value = ''
        }}
      />

      <div className="tam-main">
        <div className="tam-left">
          <div className="tam-editor">
            <CodeMirror
              value={yamlText}
              height="100%"
              extensions={theme === 'dark' ? [yamlLang(), oneDark] : [yamlLang()]}
              basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
              onCreateEditor={(view) => {
                editorRef.current = view
              }}
              onChange={(val) => onChange(val)}
            />
          </div>

          <div className="tam-validation">
            <div className="val-head">
              <div className="val-title">Validation</div>
              <div className="val-status">
                {!yamlText.trim() ? 'No YAML' : status === 'rendering' ? 'Rendering…' : hasErrors ? 'Errors' : 'OK'}
              </div>
            </div>
            {!yamlText.trim() ? (
              <div className="val-hint">Start typing or use the toolbar buttons.</div>
            ) : issues.length === 0 ? (
              <div className="val-ok">✓ No issues</div>
            ) : (
              <div className="val-list">
                {issues.map((i, idx) => (
                  <div key={idx} className={`val-item ${i.level}`}>
                    <div className="val-item-top">
                      <span className="val-level">{i.level.toUpperCase()}</span>
                      {i.path ? <span className="val-path">{i.path}</span> : null}
                    </div>
                    <div className="val-msg">{i.message}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="val-hint">
              Tip: Arrow keys pan the preview. All other diagram shortcuts are blocked.
            </div>
          </div>
        </div>

        <div className="tam-right">
          <div className="tam-preview">
            {!yamlText.trim() ? (
              <div className="preview-empty">
                <div className="preview-title">Diagram preview</div>
                <div className="preview-sub">Add your first element to generate a diagram.</div>
              </div>
            ) : xml && !hasErrors ? (
              <MxGraphPreview
                xml={editedXml || xml}
                editableRoutes={editRoutes}
                onXmlEdited={(nextXml) => setEditedXml(nextXml)}
              />
            ) : (
              <div className="preview-empty">
                <div className="preview-title">Diagram preview</div>
                <div className="preview-sub">Fix YAML validation errors to render.</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <AddConnectionModal
        isOpen={connOpen}
        onClose={() => setConnOpen(false)}
        nodeNames={nodeNames}
        storageNames={storageNames}
        activeNames={activeNames}
        onAdd={(c) => {
          if (c.tamCategory === 'communication') insertChannel(c)
          else insertAccess(c)
          setConnOpen(false)
        }}
      />

      <RenameModal
        isOpen={renameOpen}
        onClose={() => setRenameOpen(false)}
        components={componentNames}
        storages={storageNames}
        subcomponents={subcomponentNames}
        onApply={(kind, fromName, toName) => {
          applyRename(kind, fromName, toName)
          setRenameOpen(false)
        }}
      />

      <AddBoundaryModal
        isOpen={boundaryOpen}
        onClose={() => setBoundaryOpen(false)}
        componentNames={componentNames}
        humanNames={humanNames}
        agentNames={agentNames}
        storageNames={storageNames}
        initialAssignments={getBoundaryAssignmentsFromYaml()}
        onApply={(cfg, assignments) => {
          applyBoundaries(cfg, assignments)
          setBoundaryOpen(false)
        }}
      />

      <AddSubcomponentModal
        isOpen={subOpen}
        onClose={() => setSubOpen(false)}
        componentNames={componentNames}
        onAdd={(s: { parent: string; name: string }) => {
          insertSubcomponent(s.parent, s.name)
          setSubOpen(false)
        }}
      />
    </div>
  )
}
