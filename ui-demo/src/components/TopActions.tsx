import { Share2 } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { Avatar } from '../ui/primitives'
import './TopActions.css'

// Floating top-right cluster over the document canvas: live collaborators + share.
// (The top browser chrome was removed for the Arc layout; these controls live here.)
export default function TopActions() {
  const { tabs, activeTabId, getDoc, getMember } = useStore()
  const openPublish = useUI((s) => s.openPublish)

  const tab = tabs.find((t) => t.id === activeTabId)
  const doc = tab?.docId ? getDoc(tab.docId) : undefined
  if (!doc) return null

  const collaborators = doc.collaborators
    .map((id) => getMember(id))
    .filter((m): m is NonNullable<typeof m> => !!m && m.kind === 'human')

  return (
    <div className="top-actions">
      {collaborators.length > 0 && (
        <div className="top-presence">
          {collaborators.slice(0, 3).map((m, i) => (
            <span key={m.id} style={{ marginLeft: i === 0 ? 0 : -7, zIndex: 9 - i }}>
              <Avatar member={m} size={26} ring />
            </span>
          ))}
        </div>
      )}
      <button className="top-share" onClick={() => openPublish(doc.id)}>
        <Share2 size={14} />
        分享
      </button>
    </div>
  )
}
