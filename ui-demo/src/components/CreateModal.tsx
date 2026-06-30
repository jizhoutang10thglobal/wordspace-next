import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Sparkles, X, Blocks, Lock } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import type { DocKind } from '../types'
import { Spinner } from '../ui/primitives'
import './CreateModal.css'

const DRAFTS = 'f-drafts'

const kindLabel = (k: DocKind) => (k === 'page' ? '网页' : k === 'slides' ? '演示' : '文档')

// 新建文档分两层：先选「范式」（编辑范式 / 内核），范式下面才是各种模板。
// 目前只有「类 Notion」一个范式，范式 2 / 3 留 placeholder——代表将来会有多个范式，每个范式各有多套模板。
interface Paradigm {
  id: string
  name: string
  tag?: string
  desc: string
  soon: boolean
}
const PARADIGMS: Paradigm[] = [
  { id: 'notion', name: '类 Notion', tag: '当前', desc: '分块编辑的结构化文档', soon: false },
  { id: 'p2', name: '范式 2', desc: '敬请期待', soon: true },
  { id: 'p3', name: '范式 3', desc: '敬请期待', soon: true },
]

/**
 * 新建文档：左侧选范式，右侧是该范式下的模板。「类 Notion」范式下：空文档（一键直达）+ 公司模板 +
 * 用 AI 生成。从哪个文件夹触发就建到哪个文件夹（createTargetDir）。
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

  const [paradigm, setParadigm] = useState('notion')
  const [mode, setMode] = useState<'pick' | 'ai'>('pick')
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (createOpen) {
      setParadigm('notion')
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
  const active = PARADIGMS.find((p) => p.id === paradigm) ?? PARADIGMS[0]

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

  const pickParadigm = (p: Paradigm) => {
    setParadigm(p.id)
    setMode('pick')
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

        <div className="cm-split">
          {/* 左：范式 */}
          <div className="cm-rail">
            <div className="cm-rail-label">范式</div>
            {PARADIGMS.map((p) => (
              <button
                key={p.id}
                className={'cm-para' + (p.id === paradigm ? ' is-active' : '') + (p.soon ? ' is-soon' : '')}
                onClick={() => pickParadigm(p)}
              >
                <span className="cm-para-ico">{p.soon ? <Lock size={15} /> : <Blocks size={15} />}</span>
                <span className="cm-para-text">
                  <span className="cm-para-name">
                    {p.name}
                    {p.tag && <span className="cm-para-tag">{p.tag}</span>}
                  </span>
                  <span className="cm-para-desc">{p.desc}</span>
                </span>
              </button>
            ))}
            <div className="cm-rail-foot">未来每个范式有各自的编辑方式与模板</div>
          </div>

          {/* 右：该范式下的模板 */}
          <div className="cm-pane">
            {active.soon ? (
              <div className="cm-soon">
                <div className="cm-soon-ico">
                  <Lock size={22} />
                </div>
                <div className="cm-soon-title">{active.name} · 还在路上</div>
                <div className="cm-soon-desc">
                  每个范式是一套独立的编辑内核与文档结构。这个范式上线后，会在这里列出它自己的模板。
                </div>
              </div>
            ) : mode === 'pick' ? (
              <>
                <div className="cm-pane-label">{active.name} 模板</div>
                <div className="cm-grid">
                  <button className="cm-card cm-card-blank" onClick={blank}>
                    <span className="cm-card-ico">
                      <FileText size={18} />
                    </span>
                    <span className="cm-card-name">空白文档</span>
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
              </>
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
    </div>
  )
}
