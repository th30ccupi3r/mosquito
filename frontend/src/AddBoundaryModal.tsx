import React, { useEffect, useState } from 'react'

export type BoundaryConfig = {
  left: { enabled: boolean; label: string }
  right: { enabled: boolean; label: string }
}

export type BoundaryAssignments = {
  components: { [name: string]: 'left' | 'right' | 'main' }
  humans: { [name: string]: 'left' | 'right' | 'main' }
  agents: { [name: string]: 'left' | 'right' | 'main' }
  storages: { [name: string]: 'left' | 'right' | 'main' }
}

type Side = 'left' | 'right' | 'main'

function PlacementSection(props: {
  title: string
  hint: string
  names: string[]
  assignments: { [name: string]: Side }
  setAssignments: (fn: (a: { [name: string]: Side }) => { [name: string]: Side }) => void
}) {
  const { title, hint, names, assignments, setAssignments } = props
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>{title}</div>
      <div className="val-hint" style={{ marginTop: 0, marginBottom: 10 }}>{hint}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflow: 'auto', paddingRight: 6 }}>
        {names.length === 0 ? (
          <div className="val-hint" style={{ marginTop: 0 }}>None yet.</div>
        ) : (
          names.map((name) => {
            const cur = assignments[name] ?? 'main'
            const set = (v: Side) => setAssignments((a) => ({ ...a, [name]: v }))
            return (
              <div key={name} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, alignItems: 'center' }}>
                <div style={{ fontSize: 13 }}>{name}</div>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                  <input type="radio" name={`${title}_${name}`} checked={cur === 'main'} onChange={() => set('main')} />
                  Main
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                  <input type="radio" name={`${title}_${name}`} checked={cur === 'left'} onChange={() => set('left')} />
                  Left
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                  <input type="radio" name={`${title}_${name}`} checked={cur === 'right'} onChange={() => set('right')} />
                  Right
                </label>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export function AddBoundaryModal(props: {
  isOpen: boolean
  onClose: () => void
  onApply: (b: BoundaryConfig, assignments: BoundaryAssignments) => void
  initial?: BoundaryConfig
  componentNames: string[]
  humanNames: string[]
  agentNames: string[]
  storageNames: string[]
  initialAssignments?: BoundaryAssignments
}) {
  const { isOpen, onClose, onApply, initial, componentNames, humanNames, agentNames, storageNames, initialAssignments } = props

  const [leftEnabled, setLeftEnabled] = useState<boolean>(false)
  const [leftLabel, setLeftLabel] = useState<string>('On-Premise')
  const [rightEnabled, setRightEnabled] = useState<boolean>(false)
  const [rightLabel, setRightLabel] = useState<string>('Cloud')

  const [compA, setCompA] = useState<{ [name: string]: Side }>({})
  const [humanA, setHumanA] = useState<{ [name: string]: Side }>({})
  const [agentA, setAgentA] = useState<{ [name: string]: Side }>({})
  const [storageA, setStorageA] = useState<{ [name: string]: Side }>({})

  useEffect(() => {
    if (!isOpen) return
    setLeftEnabled(initial?.left.enabled ?? true)
    setLeftLabel(initial?.left.label ?? 'On-Premise')
    setRightEnabled(initial?.right.enabled ?? true)
    setRightLabel(initial?.right.label ?? 'Cloud')
    setCompA(initialAssignments?.components ?? {})
    setHumanA(initialAssignments?.humans ?? {})
    setAgentA(initialAssignments?.agents ?? {})
    setStorageA(initialAssignments?.storages ?? {})
  }, [isOpen, initial, initialAssignments])

  if (!isOpen) return null

  const canApply =
    (leftEnabled ? leftLabel.trim().length > 0 : true) &&
    (rightEnabled ? rightLabel.trim().length > 0 : true)

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">Boundaries</div>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          <div className="modal-warning">
            Boundaries are optional dashed vertical lines. Items can be assigned to the left boundary, right boundary, or remain in the main area.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10, alignItems: 'center' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={leftEnabled} onChange={(e) => setLeftEnabled(e.target.checked)} />
              Left
            </label>
            <input
              className="modal-input"
              disabled={!leftEnabled}
              value={leftLabel}
              onChange={(e) => setLeftLabel(e.target.value)}
              placeholder="Left boundary label"
            />

            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={rightEnabled} onChange={(e) => setRightEnabled(e.target.checked)} />
              Right
            </label>
            <input
              className="modal-input"
              disabled={!rightEnabled}
              value={rightLabel}
              onChange={(e) => setRightLabel(e.target.value)}
              placeholder="Right boundary label"
            />
          </div>

          <PlacementSection
            title="Component placement"
            hint="Assign components to the left boundary, right boundary, or leave them in the main area. Subcomponents inherit their parent's placement."
            names={componentNames}
            assignments={compA}
            setAssignments={setCompA}
          />

          <PlacementSection
            title="Human placement"
            hint="Assign human actors to a boundary lane. If a boundary is disabled, the actor will render in the main lane."
            names={humanNames}
            assignments={humanA}
            setAssignments={setHumanA}
          />

          <PlacementSection
            title="Agent placement"
            hint="Assign agents to a boundary lane. If a boundary is disabled, the agent will render in the main lane."
            names={agentNames}
            assignments={agentA}
            setAssignments={setAgentA}
          />

          <PlacementSection
            title="Storage placement"
            hint="Assign storages (databases) to a boundary lane. If a boundary is disabled, the storage will render in the main lane."
            names={storageNames}
            assignments={storageA}
            setAssignments={setStorageA}
          />
        </div>

        <div className="modal-foot">
          <button className="tb-btn" onClick={onClose}>Cancel</button>
          <button
            className="tb-btn"
            disabled={!canApply}
            onClick={() =>
              onApply({
                left: { enabled: leftEnabled, label: leftLabel.trim() },
                right: { enabled: rightEnabled, label: rightLabel.trim() }
              }, { components: compA, humans: humanA, agents: agentA, storages: storageA })
            }
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
