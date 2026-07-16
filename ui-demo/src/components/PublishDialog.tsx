import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  Building2,
  Check,
  Copy,
  Globe,
  Lock,
  Users,
  X,
} from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { useT } from '../i18n'
import { Avatar, Spinner } from '../ui/primitives'
import { VISIBILITY_META, type Visibility } from '../types'
import './PublishDialog.css'

const ORDER: Visibility[] = ['private', 'invited', 'internal', 'public']

const ICON: Record<Visibility, typeof Lock> = {
  private: Lock,
  invited: Users,
  internal: Building2,
  public: Globe,
}

function slugify(title: string) {
  return title.replace(/\s+/g, '-')
}

function urlFor(
  v: Visibility,
  title: string,
  publishedUrl?: string,
): string | undefined {
  if (publishedUrl) return publishedUrl
  const slug = encodeURIComponent(slugify(title))
  if (v === 'public') return `https://tenthglobal.com/${slug}`
  if (v === 'internal') return `https://team.tenthglobal.com/${slug}`
  return undefined
}

export default function PublishDialog() {
  const t = useT()
  const publishDocId = useUI((s) => s.publishDocId)
  const closePublish = useUI((s) => s.closePublish)

  const getDoc = useStore((s) => s.getDoc)
  const getMember = useStore((s) => s.getMember)
  const workspace = useStore((s) => s.workspace)
  const setVisibility = useStore((s) => s.setVisibility)
  const inviteCollaborator = useStore((s) => s.inviteCollaborator)
  const publishDoc = useStore((s) => s.publishDoc)
  const toast = useStore((s) => s.toast)

  const doc = publishDocId ? getDoc(publishDocId) : undefined

  const [email, setEmail] = useState('')
  const [deploying, setDeploying] = useState(false)

  useEffect(() => {
    if (!publishDocId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePublish()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [publishDocId, closePublish])

  // reset transient state when the target doc changes
  useEffect(() => {
    setEmail('')
    setDeploying(false)
  }, [publishDocId])

  if (!publishDocId || !doc) return null

  const selected = doc.visibility
  const published = !!doc.publishedUrl
  const liveUrl = urlFor(selected, doc.title, doc.publishedUrl)

  const collaborators = doc.collaborators
    .map((id) => getMember(id))
    .filter((m): m is NonNullable<typeof m> => !!m)

  const handleInvite = () => {
    const value = email.trim()
    if (!value) return
    inviteCollaborator(doc.id, value)
    setEmail('')
  }

  const handlePublish = async () => {
    setDeploying(true)
    try {
      await publishDoc(doc.id, selected)
    } finally {
      setDeploying(false)
    }
  }

  const handleCopy = () => {
    if (liveUrl && navigator.clipboard) navigator.clipboard.writeText(liveUrl)
    toast(t('modals.linkCopied'), 'success')
  }

  return (
    <div className="ws-modal-overlay" onMouseDown={closePublish}>
      <div
        className="ws-modal pub"
        role="dialog"
        aria-modal="true"
        aria-label={t('modals.shareAndPublish')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ws-modal-head">
          <div className="ws-modal-head-text">
            <div className="ws-modal-title">{t('modals.shareAndPublish')}</div>
            <div className="ws-modal-sub">{doc.title}</div>
          </div>
          <button
            className="ws-modal-x"
            onClick={closePublish}
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
        </header>

        <div className="ws-modal-body">
          <div className="pub-levels">
            {ORDER.map((v) => {
              const meta = VISIBILITY_META[v]
              const Icon = ICON[v]
              const active = v === selected
              return (
                <button
                  key={v}
                  className={`pub-level${active ? ' is-active' : ''}`}
                  onClick={() => setVisibility(doc.id, v)}
                >
                  <span
                    className="pub-level-ico"
                    style={{ '--vis': meta.color } as CSSProperties}
                  >
                    <Icon size={16} />
                  </span>
                  <span className="pub-level-text">
                    <span className="pub-level-label">{meta.label}</span>
                    <span className="pub-level-desc">{meta.desc}</span>
                  </span>
                  {active && (
                    <Check className="pub-level-check" size={16} />
                  )}
                </button>
              )
            })}
          </div>

          {selected === 'invited' && (
            <div className="pub-panel">
              <div className="pub-invite">
                <input
                  className="ws-input"
                  type="email"
                  placeholder={t('modals.inviteEmailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleInvite()
                  }}
                />
                <button className="ws-btn" onClick={handleInvite}>
                  {t('modals.invite')}
                </button>
              </div>
              {collaborators.length > 0 && (
                <div className="pub-collabs">
                  {collaborators.map((m) => (
                    <div key={m.id} className="pub-collab">
                      <Avatar member={m} size={24} />
                      <span className="pub-collab-name">{m.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {(selected === 'internal' || selected === 'public') && (
            <div className="pub-panel">
              {published && liveUrl ? (
                <>
                  <div className="pub-url-row">
                    <span className="pub-url" title={liveUrl}>
                      {liveUrl}
                    </span>
                    <button className="ws-btn" onClick={handleCopy}>
                      <Copy size={13} />
                      {t('common.copy')}
                    </button>
                  </div>
                  <button
                    className="ws-btn ws-btn-primary pub-deploy"
                    onClick={handlePublish}
                    disabled={deploying}
                  >
                    {deploying ? <Spinner size={14} /> : null}
                    {deploying ? t('modals.deploying') : t('modals.redeploy')}
                  </button>
                  <div className="pub-note">
                    {t('modals.deployNote', { target: workspace.deployTarget })}
                  </div>
                </>
              ) : (
                <>
                  {liveUrl && (
                    <div className="pub-url-row">
                      <span className="pub-url pub-url-pending" title={liveUrl}>
                        {liveUrl}
                      </span>
                    </div>
                  )}
                  <button
                    className="ws-btn ws-btn-primary pub-deploy"
                    onClick={handlePublish}
                    disabled={deploying}
                  >
                    {deploying ? <Spinner size={14} /> : null}
                    {deploying ? t('modals.deploying') : t('modals.publish')}
                  </button>
                  <div className="pub-note">
                    {t('modals.deployNote', { target: workspace.deployTarget })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <footer className="ws-modal-foot">
          <button
            className="ws-btn ws-btn-primary"
            onClick={closePublish}
          >
            {t('common.done')}
          </button>
        </footer>
      </div>
    </div>
  )
}
