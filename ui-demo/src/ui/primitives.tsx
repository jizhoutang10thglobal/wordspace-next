import type { CSSProperties } from 'react'
import { Loader2 } from 'lucide-react'
import { VISIBILITY_META, type Member, type Visibility } from '../types'
import './primitives.css'

export function Avatar({
  member,
  size = 24,
  ring = false,
}: {
  member: Pick<Member, 'initials' | 'color' | 'name'>
  size?: number
  ring?: boolean
}) {
  return (
    <span
      className="ws-avatar"
      title={member.name}
      style={
        {
          '--av-size': `${size}px`,
          '--av-color': member.color,
          boxShadow: ring ? '0 0 0 2px var(--c-surface)' : undefined,
        } as CSSProperties
      }
    >
      {member.initials}
    </span>
  )
}

export function AvatarStack({
  members,
  size = 24,
  max = 4,
}: {
  members: Pick<Member, 'initials' | 'color' | 'name'>[]
  size?: number
  max?: number
}) {
  const shown = members.slice(0, max)
  const extra = members.length - shown.length
  return (
    <div className="ws-avatar-stack">
      {shown.map((m, i) => (
        <span key={i} style={{ marginLeft: i === 0 ? 0 : -size / 3 }}>
          <Avatar member={m} size={size} ring />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="ws-avatar ws-avatar-extra"
          style={{ '--av-size': `${size}px`, marginLeft: -size / 3 } as CSSProperties}
        >
          +{extra}
        </span>
      )}
    </div>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className="ws-spin" />
}

export function VisibilityDot({ v }: { v: Visibility }) {
  return (
    <span
      className="ws-vis-dot"
      title={VISIBILITY_META[v].label}
      style={{ background: VISIBILITY_META[v].color }}
    />
  )
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'accent' | 'success'
}) {
  return <span className={`ws-pill ws-pill-${tone}`}>{children}</span>
}
