import React, { useMemo, useState } from 'react'
import type { ElementRef } from './types'

type Props = {
  elements: ElementRef[]
  onInsertYaml: (snippet: string) => void
}

const protocols = ['HTTPS', 'HTTP', 'gRPC', 'AMQP', 'SQL', 'S3']

export default function ConnectionBuilder({ elements, onInsertYaml }: Props) {
  const names = useMemo(() => elements.map(e => e.name).sort((a,b)=>a.localeCompare(b)), [elements])
  const [from, setFrom] = useState(names[0] ?? '')
  const [to, setTo] = useState(names[1] ?? names[0] ?? '')
  const [kind, setKind] = useState<'channel'|'access'>('channel')
  const [direction, setDirection] = useState<'->'|'<-'|'<->'|'reqres'>('->')
  const [protocol, setProtocol] = useState('HTTPS')
  const [access, setAccess] = useState<'read_write_modify_both'|'read_write_modify_single_right'|'read_write_modify_single_left'>('read_write_modify_both')
  const [label, setLabel] = useState('')

  function add() {
    if (!from || !to) return
    if (kind === 'channel') {
      const snip = `  - from: ${from}\n    to: ${to}\n    kind: channel\n    direction: "${direction}"\n    protocol: ${protocol}${label ? `\n    label: "${label.replaceAll('"','\\"')}"` : ''}\n`
      onInsertYaml(snip)
    } else {
      const snip = `  - from: ${from}\n    to: ${to}\n    kind: access\n    access: ${access}${label ? `\n    label: "${label.replaceAll('"','\\"')}"` : ''}\n`
      onInsertYaml(snip)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontWeight: 800 }}>Connection builder</span>

        <select className="tam-select" value={from} onChange={e=>setFrom(e.target.value)}>
          {names.map(n=><option key={n} value={n}>{n}</option>)}
        </select>
        <span>→</span>
        <select className="tam-select" value={to} onChange={e=>setTo(e.target.value)}>
          {names.map(n=><option key={n} value={n}>{n}</option>)}
        </select>

        <select className="tam-select" value={kind} onChange={e=>setKind(e.target.value as any)}>
          <option value="channel">channel</option>
          <option value="access">access</option>
        </select>

        {kind === 'channel' ? (
          <>
            <select className="tam-select" value={direction} onChange={e=>setDirection(e.target.value as any)}>
              <option value="->">-&gt;</option>
              <option value="<-">&lt;-</option>
              <option value="<->">&lt;-&gt;</option>
              <option value="reqres">reqres</option>
            </select>
            <input className="tam-input" value={protocol} onChange={e=>setProtocol(e.target.value)} placeholder="Protocol" style={{ width: 110 }} />
            <div style={{ display: 'flex', gap: 6 }}>
              {protocols.map(p => (
                <button
                  key={p}
                  onClick={()=>setProtocol(p)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 999,
                    border: '1px solid var(--border)',
                    background: p===protocol ? 'rgba(56,189,248,0.14)' : 'var(--panel2)',
                    color: 'var(--text)'
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </>
        ) : (
          <select className="tam-select" value={access} onChange={e=>setAccess(e.target.value as any)}>
            <option value="read_write_modify_both">read_write_modify_both</option>
            <option value="read_write_modify_single_right">read_write_modify_single_right</option>
            <option value="read_write_modify_single_left">read_write_modify_single_left</option>
          </select>
        )}

        <input className="tam-input" value={label} onChange={e=>setLabel(e.target.value)} placeholder="Label (optional)" style={{ width: 220 }} />
        <button onClick={add} style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel2)', color: 'var(--text)', fontWeight: 700 }}>
          Insert
        </button>
      </div>
      <div className="small" style={{ marginTop: 8 }}>
        Inserts a valid entry under <span className="kbd">connections:</span>.
      </div>
    </div>
  )
}
