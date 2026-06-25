import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Sparkles, X } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { isCloudStorage, type DocKind } from '../types'
import { Spinner } from '../ui/primitives'
import './CreateModal.css'

const DRAFTS = 'f-drafts'

const kindLabel = (k: DocKind) => (k === 'page' ? '网页' : k === 'slides' ? '演示' : '文档')

/**
 * 新建文档：先给一张模板选择台。第一张永远是「空文档」（一键直达，不强迫选模板），
 * 后面是公司模板卡，再一张「用 AI 生成」。从哪个文件夹触发的就建到哪个文件夹
 * （createTargetDir）。
 */
export default function CreateModal() {
  const navigate = useNavigate()
  const createOpen = useUI((s) => s.createOpen)
  const closeCreate = useUI((s) => s.closeCreate)
  const targetDir = useUI((s) => s.createTargetDir)

  const createDoc = useStore((s) => s.createDoc)
  const generateDoc = useStore((s) => s.generateDoc)
  const createFromTemplate = useStore((s) => s.createFromTemplate)
  const templates = useStore((s) => s.templates)
  const spaces = useStore((s) => s.spaces)
  const activeSpaceId = useStore((s) => s.activeSpaceId)

  const [mode, setMode] = useState<'pick' | 'ai'>('pick')
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (createOpen) {
      setMode('pick')
      setPrompt('')
      setGenerating(false)
    }
  }, [createOpen])

  useEffect(() => {
    if (!createOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !generating) closeCreate()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [createOpen, generating, closeCreate])

  if (!createOpen) return null

  const space = spaces.find((s) => s.id === activeSpaceId)
  const dir = targetDir ?? undefined // undefined → store defaults (root / 我的草稿)
  const companyTemplates = templates.filter((t) => t.pool === 'private')
  const where =
    targetDir && targetDir !== '' ? `${space?.name} / ${targetDir}` : (space?.name ?? '当前空间')

  const done = () => {
    closeCreate()
    navigate('/docs')
  }
  const blank = () => {
    createDoc(DRAFTS, 'doc', '无标题文档', dir)
    done()
  }
  const fromTemplate = (id: string) => {
    createFromTemplate(id, DRAFTS, dir)
    done()
  }
  const generate = async () => {
    const value = prompt.trim()
    if (!value || generating) return
    setGenerating(true)
    try {
      await generateDoc(value, DRAFTS, dir)
      done()
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div
      className="ws-modal-overlay"
      onMouseDown={() => {
        if (!generating) closeCreate()
      }}
    >
      <div
        className="ws-modal cm-new"
        role="dialog"
        aria-modal="true"
        aria-label="新建文档"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ws-modal-head">
          <div className="ws-modal-head-text">
            <div className="ws-modal-title">新建文档</div>
            <div className="cm-where">在 {where}</div>
          </div>
          <button className="ws-modal-x" onClick={closeCreate} aria-label="关闭" disabled={generating}>
            <X size={16} />
          </button>
        </header>

        <div className="ws-modal-body">
          {mode === 'pick' ? (
            <div className="cm-grid">
              <button className="cm-card cm-card-blank" onClick={blank}>
                <span className="cm-card-ico">
                  <FileText size={18} />
                </span>
                <span className="cm-card-name">空文档</span>
                <span className="cm-card-desc">从一张白纸开始</span>
              </button>

              {companyTemplates.map((t) => (
                <button
                  key={t.id}
                  className="cm-card cm-card-tpl"
                  style={{ borderTopColor: t.accent }}
                  onClick={() => fromTemplate(t.id)}
                >
                  <span className="cm-card-kind" style={{ color: t.accent }}>
                    {kindLabel(t.kind)}
                  </span>
                  <span className="cm-card-name">{t.name}</span>
                  <span className="cm-card-desc">{t.description}</span>
                </button>
              ))}

              <button className="cm-card cm-card-ai" onClick={() => setMode('ai')}>
                <span className="cm-card-ico">
                  <Sparkles size={18} />
                </span>
                <span className="cm-card-name">用 AI 生成</span>
                <span className="cm-card-desc">描述需求,自动起草</span>
              </button>
            </div>
          ) : (
            <div className="cm-ai">
              <textarea
                className="cm-ai-input"
                placeholder="描述你想要的文档,例如:给新客户的项目方案"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={generating}
                autoFocus
              />
              <div className="cm-ai-foot">
                <button className="ws-btn" onClick={() => setMode('pick')} disabled={generating}>
                  返回
                </button>
                <button
                  className="ws-btn ws-btn-primary"
                  onClick={generate}
                  disabled={generating || !prompt.trim()}
                >
                  {generating ? <Spinner size={14} /> : null}
                  {generating ? '正在生成…' : '生成'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
