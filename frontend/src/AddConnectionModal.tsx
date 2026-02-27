import React, { useEffect, useMemo, useState } from 'react'

// TAM (SAP PowerDesigner) semantics
export type TamCategory = 'communication' | 'access'
export type TamCommunicationType = 'unidirectional' | 'bidirectional' | 'requestResponse'
export type TamAccessType = 'readAccess' | 'writeAccess' | 'modifyAccess'
export type TamDirection = 'sourceToTarget' | 'targetToSource'

// Marker positions are stored as 0..1 along the rendered edge.
export type TamMarkerPos = number

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5
  return Math.max(0, Math.min(1, n))
}

function PreviewLine(props: {
  kind: 'communication' | 'access'
  tamEdgeType: TamCommunicationType | TamAccessType
  direction: TamDirection
  // Arrow markers
  showSourceArrow: boolean
  showTargetArrow: boolean
  sourceArrowPos: TamMarkerPos
  targetArrowPos: TamMarkerPos
  onChangeSourceArrowPos: (n: number) => void
  onChangeTargetArrowPos: (n: number) => void
  // R marker
  showR: boolean
  rPos: TamMarkerPos
  onChangeRPos: (n: number) => void
  // Modify symbol
  showModify: boolean
  modifyPos: TamMarkerPos
  onChangeModifyPos: (n: number) => void
}) {
  const {
    direction,
    showSourceArrow,
    showTargetArrow,
    sourceArrowPos,
    targetArrowPos,
    onChangeSourceArrowPos,
    onChangeTargetArrowPos,
    showR,
    rPos,
    onChangeRPos,
    showModify,
    modifyPos,
    onChangeModifyPos
  } = props

  const W = 360
  const H = 64
  const pad = 18
  const x0 = pad
  const x1 = W - pad
  const y = H / 2
  const toX = (t: number) => x0 + clamp01(t) * (x1 - x0)
  const toT = (clientX: number, svgLeft: number) => clamp01((clientX - svgLeft - x0) / (x1 - x0))

  const [drag, setDrag] = useState<null | 'src' | 'tgt' | 'r' | 'm'>(null)

  useEffect(() => {
    function onMove(ev: PointerEvent) {
      if (!drag) return
      const svg = document.getElementById('tam-conn-preview') as SVGSVGElement | null
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const t = toT(ev.clientX, rect.left)
      if (drag === 'src') onChangeSourceArrowPos(t)
      if (drag === 'tgt') onChangeTargetArrowPos(t)
      if (drag === 'r') onChangeRPos(t)
      if (drag === 'm') onChangeModifyPos(t)
    }
    function onUp() {
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag, onChangeModifyPos, onChangeRPos, onChangeSourceArrowPos, onChangeTargetArrowPos])

  const srcDir = direction === 'sourceToTarget' ? '←' : '→'
  const tgtDir = direction === 'sourceToTarget' ? '→' : '←'
  const rGlyph = direction === 'sourceToTarget' ? 'R→' : '←R'

  return (
    <div style={{ marginTop: 12 }}>
      <div className="small" style={{ marginBottom: 6, opacity: 0.85 }}>
        Drag the markers to position arrows / “R” / modify symbol on the link (exported to draw.io).
      </div>
      <svg id="tam-conn-preview" width={W} height={H} style={{ width: '100%', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 8, background: '#fff' }}>
        <line x1={x0} y1={y} x2={x1} y2={y} stroke="#000" strokeWidth="2" />

        {showSourceArrow ? (
          <g
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture?.(e.pointerId)
              setDrag('src')
            }}
          >
            <circle cx={toX(sourceArrowPos)} cy={y} r={10} fill="#fff" stroke="#000" />
            <text x={toX(sourceArrowPos)} y={y + 4} textAnchor="middle" fontSize="12" fontWeight="700">
              {srcDir}
            </text>
          </g>
        ) : null}

        {showTargetArrow ? (
          <g
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture?.(e.pointerId)
              setDrag('tgt')
            }}
          >
            <circle cx={toX(targetArrowPos)} cy={y} r={10} fill="#fff" stroke="#000" />
            <text x={toX(targetArrowPos)} y={y + 4} textAnchor="middle" fontSize="12" fontWeight="700">
              {tgtDir}
            </text>
          </g>
        ) : null}

        {showR ? (
          <g
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture?.(e.pointerId)
              setDrag('r')
            }}
          >
            <rect x={toX(rPos) - 18} y={y - 20} width={36} height={18} rx={6} fill="#fff" stroke="#000" />
            <text x={toX(rPos)} y={y - 7} textAnchor="middle" fontSize="11" fontWeight="700">
              {rGlyph}
            </text>
          </g>
        ) : null}

        {showModify ? (
          <g
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture?.(e.pointerId)
              setDrag('m')
            }}
          >
            <rect x={toX(modifyPos) - 20} y={y + 6} width={40} height={16} rx={6} fill="#fff" stroke="#000" />
            <text x={toX(modifyPos)} y={y + 18} textAnchor="middle" fontSize="11" fontWeight="700">
              ⇄
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  )
}

export function AddConnectionModal(props: {
  isOpen: boolean
  onClose: () => void
  nodeNames: string[]
  storageNames: string[]
  activeNames: string[]
  onAdd: (c:
    | {
        tamCategory: 'communication'
        from: string
        to: string
        tamEdgeType: TamCommunicationType
        direction: TamDirection
        protocol: string
        sourceArrowPos?: TamMarkerPos
        targetArrowPos?: TamMarkerPos
        rMarkerPos?: TamMarkerPos
      }
    | {
        tamCategory: 'access'
        from: string
        to: string
        tamEdgeType: TamAccessType
        direction: TamDirection
        displayAsDoubleArc?: boolean
        sourceArrowPos?: TamMarkerPos
        targetArrowPos?: TamMarkerPos
        modifySymbolPos?: TamMarkerPos
      }
  ) => void
}) {
  const { isOpen, onClose, nodeNames, storageNames, activeNames, onAdd } = props

  const defaults = useMemo(() => {
    const a = nodeNames[0] ?? ''
    const b = nodeNames[1] ?? nodeNames[0] ?? ''
    return { a, b }
  }, [nodeNames])

  const [from, setFrom] = useState(defaults.a)
  const [to, setTo] = useState(defaults.b)
  const [tamEdgeTypeComm, setTamEdgeTypeComm] = useState<TamCommunicationType>('unidirectional')
  const [tamEdgeTypeAccess, setTamEdgeTypeAccess] = useState<TamAccessType>('readAccess')
  const [direction, setDirection] = useState<TamDirection>('sourceToTarget')
  const [protocol, setProtocol] = useState('https')
  const [displayAsDoubleArc, setDisplayAsDoubleArc] = useState(true)

  // Draggable marker positions (0..1). Defaults match TAM-ish visual placement.
  const [sourceArrowPos, setSourceArrowPos] = useState<TamMarkerPos>(0.1)
  const [targetArrowPos, setTargetArrowPos] = useState<TamMarkerPos>(0.9)
  const [rMarkerPos, setRMarkerPos] = useState<TamMarkerPos>(0.5)
  const [modifySymbolPos, setModifySymbolPos] = useState<TamMarkerPos>(0.5)

  useEffect(() => {
    // keep selections valid if YAML changes
    if (!nodeNames.includes(from)) setFrom(defaults.a)
    if (!nodeNames.includes(to)) setTo(defaults.b)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeNames.join('|')])

  const isStorage = (n: string) => storageNames.includes(n)
  const isActive = (n: string) => activeNames.includes(n) || (!isStorage(n) && nodeNames.includes(n))

  const sourceRole = isStorage(from) ? 'storage' : isActive(from) ? 'active' : 'unknown'
  const targetRole = isStorage(to) ? 'storage' : isActive(to) ? 'active' : 'unknown'

  let inferred: TamCategory | 'blocked' = 'communication'
  if (sourceRole === 'storage' && targetRole === 'storage') inferred = 'blocked'
  else if ((sourceRole === 'storage' && targetRole === 'active') || (sourceRole === 'active' && targetRole === 'storage')) inferred = 'access'
  else inferred = 'communication'

  // Defaults when switching endpoints: active -> storage should default direction active->storage
  useEffect(() => {
    if (inferred === 'access') {
      if (sourceRole === 'active' && targetRole === 'storage') setDirection('sourceToTarget')
      if (sourceRole === 'storage' && targetRole === 'active') setDirection('targetToSource')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  // Keep marker defaults sane when edge type changes.
  useEffect(() => {
    // Default arrows sit near ends; symbols near center.
    setSourceArrowPos((p) => clamp01(p ?? 0.1))
    setTargetArrowPos((p) => clamp01(p ?? 0.9))
    setRMarkerPos((p) => clamp01(p ?? 0.5))
    setModifySymbolPos((p) => clamp01(p ?? 0.5))
  }, [tamEdgeTypeComm, tamEdgeTypeAccess])

  const needsProtocol = inferred === 'communication'
  const canAdd = from.trim() && to.trim() && (!needsProtocol || protocol.trim()) && inferred !== 'blocked'

  // IMPORTANT: don't early-return before all hooks run (Rules of Hooks)
  if (!isOpen) return null

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-head">
          <div className="modal-title">Add connection</div>
          <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          {nodeNames.length < 2 ? (
            <div className="modal-warning">
              Add at least <b>two</b> nodes (human/agent/component/storage) before creating a channel.
            </div>
          ) : null}

          <div className="modal-grid">
            <label className="modal-label">
              From
              <select className="modal-input" value={from} onChange={(e) => setFrom(e.target.value)}>
                {nodeNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <label className="modal-label">
              To
              <select className="modal-input" value={to} onChange={(e) => setTo(e.target.value)}>
                {nodeNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {inferred === 'blocked' ? (
            <div className="modal-warning" style={{ marginTop: 10 }}>
              Storage-to-storage is not a TAM access/communication link. Connect storages via an active element instead.
            </div>
          ) : null}

          {inferred === 'communication' ? (
            <>
              <div className="modal-label">Channel type</div>
              <div className="modal-dir">
                <button
                  className={tamEdgeTypeComm === 'unidirectional' ? 'dir-btn active' : 'dir-btn'}
                  onClick={() => setTamEdgeTypeComm('unidirectional')}
                  type="button"
                >
                  Unidirectional
                </button>
                <button
                  className={tamEdgeTypeComm === 'bidirectional' ? 'dir-btn active' : 'dir-btn'}
                  onClick={() => setTamEdgeTypeComm('bidirectional')}
                  type="button"
                >
                  Bidirectional
                </button>
                <button
                  className={tamEdgeTypeComm === 'requestResponse' ? 'dir-btn active' : 'dir-btn'}
                  onClick={() => setTamEdgeTypeComm('requestResponse')}
                  type="button"
                >
                  Request/Response (R)
                </button>
              </div>

              <label className="modal-label" style={{ marginTop: 10 }}>
                Protocol (required, shown as edge label)
                <input
                  className="modal-input"
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value)}
                  placeholder="e.g., HTTPS, mTLS, AMQP, SFTP"
                />
              </label>

              <div className="modal-label" style={{ marginTop: 10 }}>Direction</div>
              <div className="modal-dir">
                <button
                  className={direction === 'sourceToTarget' ? 'dir-btn active' : 'dir-btn'}
                  onClick={() => setDirection('sourceToTarget')}
                  type="button"
                  disabled={tamEdgeTypeComm === 'bidirectional'}
                >
                  From → To
                </button>
                <button
                  className={direction === 'targetToSource' ? 'dir-btn active' : 'dir-btn'}
                  onClick={() => setDirection('targetToSource')}
                  type="button"
                  disabled={tamEdgeTypeComm === 'bidirectional'}
                >
                  To → From
                </button>
              </div>
              {tamEdgeTypeComm === 'requestResponse' ? (
                <div className="small" style={{ marginTop: 8, opacity: 0.9 }}>
                  RequestResponse: “R” indicates a request-response pair; arrow shows request direction.
                </div>
              ) : null}

              <PreviewLine
                kind="communication"
                tamEdgeType={tamEdgeTypeComm}
                direction={direction}
                showSourceArrow={tamEdgeTypeComm === 'bidirectional' || tamEdgeTypeComm === 'requestResponse' || (tamEdgeTypeComm === 'unidirectional' && direction === 'targetToSource')}
                showTargetArrow={tamEdgeTypeComm === 'bidirectional' || tamEdgeTypeComm === 'requestResponse' || (tamEdgeTypeComm === 'unidirectional' && direction === 'sourceToTarget')}
                sourceArrowPos={sourceArrowPos}
                targetArrowPos={targetArrowPos}
                onChangeSourceArrowPos={(n) => setSourceArrowPos(clamp01(n))}
                onChangeTargetArrowPos={(n) => setTargetArrowPos(clamp01(n))}
                showR={tamEdgeTypeComm === 'requestResponse'}
                rPos={rMarkerPos}
                onChangeRPos={(n) => setRMarkerPos(clamp01(n))}
                showModify={false}
                modifyPos={modifySymbolPos}
                onChangeModifyPos={(n) => setModifySymbolPos(clamp01(n))}
              />
            </>
          ) : (
            <>
              <div className="modal-label">Access type</div>
              <div className="modal-dir">
                <button
                  className={tamEdgeTypeAccess === 'readAccess' ? 'dir-btn active' : 'dir-btn'}
                  onClick={() => setTamEdgeTypeAccess('readAccess')}
                  type="button"
                >
                  Read
                </button>
                <button
                  className={tamEdgeTypeAccess === 'writeAccess' ? 'dir-btn active' : 'dir-btn'}
                  onClick={() => setTamEdgeTypeAccess('writeAccess')}
                  type="button"
                >
                  Write
                </button>
                <button
                  className={tamEdgeTypeAccess === 'modifyAccess' ? 'dir-btn active' : 'dir-btn'}
                  onClick={() => setTamEdgeTypeAccess('modifyAccess')}
                  type="button"
                >
                  Modify
                </button>
              </div>

              <div className="modal-label" style={{ marginTop: 10 }}>Direction</div>
              <div className="modal-dir">
                <button
                  className={direction === 'sourceToTarget' ? 'dir-btn active' : 'dir-btn'}
                  onClick={() => setDirection('sourceToTarget')}
                  type="button"
                >
                  From → To
                </button>
                <button
                  className={direction === 'targetToSource' ? 'dir-btn active' : 'dir-btn'}
                  onClick={() => setDirection('targetToSource')}
                  type="button"
                >
                  To → From
                </button>
              </div>

              {tamEdgeTypeAccess === 'modifyAccess' ? (
                <label className="modal-label" style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input type="checkbox" checked={displayAsDoubleArc} onChange={(e) => setDisplayAsDoubleArc(e.target.checked)} />
                  Display as double-arc
                </label>
              ) : null}
              {tamEdgeTypeAccess === 'modifyAccess' ? (
                <div className="small" style={{ marginTop: 8, opacity: 0.9 }}>
                  Modify access is shown as a double-arc (read+write) access to storage.
                </div>
              ) : null}

              <PreviewLine
                kind="access"
                tamEdgeType={tamEdgeTypeAccess}
                direction={direction}
                showSourceArrow={tamEdgeTypeAccess === 'modifyAccess' || (tamEdgeTypeAccess !== 'modifyAccess' && direction === 'targetToSource')}
                showTargetArrow={tamEdgeTypeAccess === 'modifyAccess' || (tamEdgeTypeAccess !== 'modifyAccess' && direction === 'sourceToTarget')}
                sourceArrowPos={sourceArrowPos}
                targetArrowPos={targetArrowPos}
                onChangeSourceArrowPos={(n) => setSourceArrowPos(clamp01(n))}
                onChangeTargetArrowPos={(n) => setTargetArrowPos(clamp01(n))}
                showR={false}
                rPos={rMarkerPos}
                onChangeRPos={(n) => setRMarkerPos(clamp01(n))}
                showModify={tamEdgeTypeAccess === 'modifyAccess' && displayAsDoubleArc}
                modifyPos={modifySymbolPos}
                onChangeModifyPos={(n) => setModifySymbolPos(clamp01(n))}
              />
            </>
          )}
        </div>

        <div className="modal-foot">
          <button className="tb-btn" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="tb-btn"
            disabled={!canAdd || nodeNames.length < 2}
            onClick={() =>
              inferred === 'communication'
                ? onAdd({
                    tamCategory: 'communication',
                    from,
                    to,
                    tamEdgeType: tamEdgeTypeComm,
                    direction,
                    protocol: protocol.trim(),
                    sourceArrowPos,
                    targetArrowPos,
                    rMarkerPos: tamEdgeTypeComm === 'requestResponse' ? rMarkerPos : undefined
                  })
                : onAdd({
                    tamCategory: 'access',
                    from,
                    to,
                    tamEdgeType: tamEdgeTypeAccess,
                    direction,
                    displayAsDoubleArc: tamEdgeTypeAccess === 'modifyAccess' ? displayAsDoubleArc : undefined,
                    sourceArrowPos,
                    targetArrowPos,
                    modifySymbolPos: tamEdgeTypeAccess === 'modifyAccess' ? modifySymbolPos : undefined
                  })
            }
            type="button"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
