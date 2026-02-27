import React, { useEffect, useMemo, useState } from 'react'

export type RenameKind = 'component' | 'storage' | 'subcomponent'

export function RenameModal(props: {
  isOpen: boolean
  onClose: () => void
  components: string[]
  storages: string[]
  subcomponents: string[] // qualified "Component/Sub"
  onApply: (kind: RenameKind, fromName: string, toName: string) => void
}) {
  const { isOpen, onClose, components, storages, subcomponents, onApply } = props

  const [kind, setKind] = useState<RenameKind>('component')
  const options = useMemo(() => {
    if (kind === 'component') return components
    if (kind === 'storage') return storages
    return subcomponents
  }, [kind, components, storages, subcomponents])

  const [fromName, setFromName] = useState('')
  const [toName, setToName] = useState('')

  useEffect(() => {
    const first = options[0] ?? ''
    setFromName(first)
    setToName('')
  }, [kind, options.join('|')])

  if (!isOpen) return null

  const canApply = fromName.trim() && toName.trim() && fromName.trim() !== toName.trim()

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-head">
          <div className="modal-title">Rename</div>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-warning">
            This will update the node name <b>and</b> all references in channels/accesses.
          </div>

          <label className="modal-label">
            Type
            <select className="modal-input" value={kind} onChange={(e) => setKind(e.target.value as RenameKind)}>
              <option value="component">Component</option>
              <option value="subcomponent">Subcomponent</option>
              <option value="storage">Storage</option>
            </select>
          </label>

          {options.length === 0 ? (
            <div className="modal-warning">No items of this type exist in the YAML yet.</div>
          ) : (
            <label className="modal-label">
              Replace
              <select className="modal-input" value={fromName} onChange={(e) => setFromName(e.target.value)}>
                {options.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="modal-label">
            With
            <input
              className="modal-input"
              value={toName}
              onChange={(e) => setToName(e.target.value)}
              placeholder={kind === 'subcomponent' ? 'New Subcomponent Name (not qualified)' : 'New name'}
            />
          </label>

          {kind === 'subcomponent' ? (
            <div className="val-hint">
              Subcomponents are referenced as <code>Component/Subcomponent</code>. When renaming a subcomponent, only the
              subcomponent part is replaced.
            </div>
          ) : null}
        </div>

        <div className="modal-foot">
          <button className="tb-btn" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="tb-btn"
            disabled={!canApply || options.length === 0}
            onClick={() => onApply(kind, fromName.trim(), toName.trim())}
            type="button"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
