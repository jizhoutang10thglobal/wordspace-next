import { useEffect, useState } from 'react'
import { useStore } from '../../mock/store'
import type { Doc } from '../../types'

interface Caret {
  memberId: string
  name: string
  color: string
  top: number
  left: number
  height: number
}

/**
 * Simulated live collaborators. Picks 1–2 human members from the doc's
 * collaborators (excluding me) and parks a colored caret next to a random
 * block, hopping to another block every ~3s. Position is measured from the
 * editable block elements so carets sit inside the running text.
 */
export default function CollabCursors({
  doc,
  scrollEl,
  getBlockEl,
}: {
  doc: Doc
  scrollEl: HTMLElement | null
  getBlockEl: (blockId: string) => HTMLElement | null
}) {
  const meId = useStore((s) => s.meId)
  const getMember = useStore((s) => s.getMember)
  const setPresence = useStore((s) => s.setPresence)
  const [carets, setCarets] = useState<Caret[]>([])

  // who is "present" — at most two other humans
  const others = doc.collaborators
    .filter((id) => id !== meId)
    .map((id) => getMember(id))
    .filter((m): m is NonNullable<typeof m> => !!m && m.kind === 'human')
    .slice(0, 2)

  useEffect(() => {
    if (!scrollEl || others.length === 0 || doc.blocks.length === 0) {
      setCarets([])
      setPresence([])
      return
    }

    const pickBlockId = () =>
      doc.blocks[Math.floor(Math.random() * doc.blocks.length)].id

    const place = (blockId: string, color: string, name: string, memberId: string): Caret | null => {
      const el = getBlockEl(blockId)
      if (!el || !scrollEl) return null
      const er = el.getBoundingClientRect()
      const sr = scrollEl.getBoundingClientRect()
      return {
        memberId,
        name,
        color,
        top: er.top - sr.top + scrollEl.scrollTop + 4,
        left: er.left - sr.left + Math.min(er.width - 14, 8 + Math.random() * 120),
        height: Math.min(er.height - 8, 22),
      }
    }

    const tick = () => {
      const next: Caret[] = []
      for (const m of others) {
        const c = place(pickBlockId(), m.color, m.name, m.id)
        if (c) next.push(c)
      }
      setCarets(next)
      setPresence(
        next.map((c) => ({
          memberId: c.memberId,
          blockId: '',
          label: true,
        })),
      )
    }

    tick()
    const id = window.setInterval(tick, 3000)
    return () => {
      window.clearInterval(id)
      setPresence([])
    }
    // re-run when the doc, its block count, or the membership changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, doc.blocks.length, scrollEl, others.map((m) => m.id).join(',')])

  return (
    <>
      {carets.map((c) => (
        <div
          key={c.memberId}
          className="ws-caret"
          style={{
            top: c.top,
            left: c.left,
            height: c.height,
            background: c.color,
          }}
        >
          <span className="ws-caret-flag" style={{ background: c.color }}>
            {c.name}
          </span>
        </div>
      ))}
    </>
  )
}
