import React, { useEffect, useMemo, useState } from 'react'

export function AddSubcomponentModal(props: {
  isOpen: boolean
  onClose: () => void
  componentNames: string[]
  onAdd: (s: { parent: string; name: string }) => void
}) {
  const { isOpen, onClose, componentNames, onAdd } = props

  const defaultParent = useMemo(() => componentNames[0] ?? '', [componentNames.join('|')])
  const [parent, setParent] = useState(defaultParent)
  const [name, setName] = useState('New Subcomponent 1')

  useEffect(() => {
    if (isOpen) {
      setParent(defaultParent)
      setName('New Subcomponent 1')
    }
  }, [isOpen, defaultParent])

  if (!isOpen) return null

  const canAdd = parent.trim().length > 0 && name.trim().length > 0

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-head">
          <div className="modal-title">Add Subcomponent</div>
          <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          {componentNames.length === 0 ? (
            <div className="modal-warning">
              Add a <b>Component</b> first, then you can add subcomponents inside it.
            </div>
          ) : null}

          <div className="modal-grid">
            <label className="modal-label">
              Parent component
              <select className="modal-input" value={parent} onChange={(e) => setParent(e.target.value)}>
                {componentNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>

            <label className="modal-label">
              Subcomponent name
              <input className="modal-input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
        </div>

        <div className="modal-foot">
          <button className="tb-btn" onClick={onClose}>Cancel</button>
          <button className="tb-btn" disabled={!canAdd} onClick={() => onAdd({ parent, name })}>
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
