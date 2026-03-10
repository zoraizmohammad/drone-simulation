import { useEffect, useRef, useState } from 'preact/hooks'
import type { TerminalEntry, TerminalEntryType } from '../../models/types'

// ── Color map ────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<TerminalEntryType, string> = {
  'sys':    '#64748b',
  'phase':  '#a78bfa',
  'ws-out': '#60a5fa',
  'ws-in':  '#22d3ee',
  'detect': '#4ade80',
  'tsp':    '#f59e0b',
  'nav':    '#94a3b8',
  'error':  '#f87171',
}

const TYPE_LABEL: Record<TerminalEntryType, string> = {
  'sys':    'SYS  ',
  'phase':  'PHASE',
  'ws-out': '→WS  ',
  'ws-in':  '←WS  ',
  'detect': 'DET  ',
  'tsp':    'TSP  ',
  'nav':    'NAV  ',
  'error':  'ERR  ',
}

// ── Filter config ────────────────────────────────────────────────────────────

type FilterMode = 'ALL' | 'WS' | 'INFER' | 'NAV'

const FILTER_TYPES: Record<FilterMode, TerminalEntryType[] | null> = {
  ALL:   null,
  WS:    ['ws-out', 'ws-in', 'sys', 'error'],
  INFER: ['detect', 'tsp'],
  NAV:   ['phase', 'nav'],
}

// ── Row sub-component ────────────────────────────────────────────────────────

function TerminalRow({ entry }: { entry: TerminalEntry }) {
  const color = TYPE_COLOR[entry.type]
  // Show time as seconds since session start using the raw perf.now() ms value
  // We'll format as seconds with 1 decimal place
  const secStr = (entry.ts / 1000).toFixed(1)

  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'baseline',
      borderBottom: '1px solid #050d1a',
      padding: '1.5px 0',
    }}>
      <span style={{
        color: '#2a3a4a', fontSize: 9, flexShrink: 0, width: 58,
        fontFamily: 'monospace', userSelect: 'none',
      }}>
        {secStr}s
      </span>
      <span style={{
        color: color + 'cc', fontSize: 9, fontWeight: 700,
        flexShrink: 0, width: 44, fontFamily: 'monospace',
        letterSpacing: '0.06em',
      }}>
        {TYPE_LABEL[entry.type]}
      </span>
      <span style={{
        color,
        fontSize: 10,
        fontFamily: 'monospace',
        whiteSpace: 'pre',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        minWidth: 0,
        flex: 1,
        letterSpacing: '0.02em',
      }}>
        {entry.text}
      </span>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

interface Props {
  entries: TerminalEntry[]
  onClose: () => void
}

export function TerminalPanel({ entries, onClose }: Props) {
  const [filter, setFilter]         = useState<FilterMode>('ALL')
  const [visible, setVisible]       = useState<TerminalEntry[]>([])
  const [pinned, setPinned]         = useState(true)
  const clearBeforeId               = useRef(0)
  const scrollRef                   = useRef<HTMLDivElement | null>(null)

  // Recompute visible list when entries or filter changes
  useEffect(() => {
    const allowed = FILTER_TYPES[filter]
    setVisible(
      (allowed === null ? entries : entries.filter(e => allowed.includes(e.type)))
        .filter(e => e.id > clearBeforeId.current)
    )
  }, [entries, filter])

  // Auto-scroll when pinned
  useEffect(() => {
    if (pinned && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [visible, pinned])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setPinned(atBottom)
  }

  const handleClear = () => {
    const last = entries[entries.length - 1]
    clearBeforeId.current = last?.id ?? 0
    setVisible([])
  }

  // ── Filter button style ───────────────────────────────────────────────────

  const filterBtn = (f: FilterMode) => ({
    padding: '2px 9px',
    borderRadius: 3,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.08em',
    cursor: 'pointer',
    border: '1px solid',
    fontFamily: 'monospace',
    background:  filter === f ? '#0e2038' : 'transparent',
    color:       filter === f ? '#38bdf8' : '#334155',
    borderColor: filter === f ? '#1e3a5f' : '#1a2535',
  } as preact.JSX.CSSProperties)

  const smallBtn = (color: string): preact.JSX.CSSProperties => ({
    padding: '2px 9px',
    borderRadius: 3,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.08em',
    cursor: 'pointer',
    border: `1px solid ${color}44`,
    background: 'transparent',
    color,
    fontFamily: 'monospace',
  })

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      height: '42vh',
      zIndex: 200,
      background: '#030810',
      borderTop: '1px solid #1e3a5f',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'monospace',
    }}>
      {/* ── Header bar ──────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 14px',
        borderBottom: '1px solid #0f2744',
        background: '#070f1e',
      }}>
        {/* Title */}
        <span style={{
          color: '#38bdf8', fontWeight: 700, letterSpacing: '0.12em',
          fontSize: 10, userSelect: 'none',
        }}>
          {'>'}_&nbsp;DRONE&nbsp;TERMINAL
        </span>

        {/* Entry counter */}
        <span style={{ color: '#1e3a5f', fontSize: 9 }}>
          {visible.length} / {entries.length}
        </span>

        <div style={{ flex: 1 }} />

        {/* Filter buttons */}
        {(['ALL', 'WS', 'INFER', 'NAV'] as FilterMode[]).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={filterBtn(f)}>{f}</button>
        ))}

        {/* Divider */}
        <span style={{ color: '#1e3a5f', userSelect: 'none' }}>│</span>

        {/* CLEAR */}
        <button onClick={handleClear} style={smallBtn('#ef4444')}>CLEAR</button>

        {/* Follow / unfollow */}
        {!pinned && (
          <button onClick={() => setPinned(true)} style={smallBtn('#22d3ee')}>↓ FOLLOW</button>
        )}

        {/* Close */}
        <button onClick={onClose} style={smallBtn('#475569')}>✕</button>
      </div>

      {/* ── Legend bar ──────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        display: 'flex',
        gap: 16,
        padding: '2px 14px',
        background: '#040c18',
        borderBottom: '1px solid #0a1628',
      }}>
        {(Object.entries(TYPE_COLOR) as [TerminalEntryType, string][]).map(([t, c]) => (
          <span key={t} style={{ fontSize: 8, color: c + '99', letterSpacing: '0.06em', userSelect: 'none' }}>
            ■ {TYPE_LABEL[t].trim()}
          </span>
        ))}
      </div>

      {/* ── Log scroll area ──────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '4px 14px 8px',
          scrollbarWidth: 'thin',
          scrollbarColor: '#1e3a5f transparent',
        }}
      >
        {visible.length === 0 ? (
          <div style={{
            color: '#1e3a5f', fontSize: 10, paddingTop: 12,
            letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>
            Waiting for events…
          </div>
        ) : (
          visible.map(entry => <TerminalRow key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  )
}
