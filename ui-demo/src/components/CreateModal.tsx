import { useEffect, useState } from 'react'
import {
  FileText,
  LayoutTemplate,
  Sparkles,
  X,
} from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { Pill, Spinner } from '../ui/primitives'
import './CreateModal.css'

const DRAFTS = 'f-drafts'

type Mode = 'pick' | 'ai' | 'template'

export default function CreateModal() {
  const createOpen = useUI((s) => s.createOpen)
  const closeCreate = useUI((s) => s.closeCreate)

  const createDoc = useStore((s) => s.createDoc)
  const generateDoc = useStore((s) => s.generateDoc)
  const createFromTemplate = useStore((s) => s.createFromTemplate)
  const templates = useStore((s) => s.templates)

  const [mode, setMode] = useState<Mode>('pick')
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)

  // reset to the picker each time the modal opens
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

  const handleBlank = () => {
    createDoc(DRAFTS, 'doc', '无标题文档')
    closeCreate()
  }

  const handleGenerate = async () => {
    const value = prompt.trim()
    if (!value || generating) return
    setGenerating(true)
    try {
      await generateDoc(value, DRAFTS)
      closeCreate()
    } finally {
      setGenerating(false)
    }
  }

  const handleTemplate = (id: string) => {
    createFromTemplate(id, DRAFTS)
    closeCreate()
  }

  return (
    <div
      className="ws-modal-overlay"
      onMouseDown={() => {
        if (!generating) closeCreate()
      }}
    >
      <div
        className="ws-modal create"
        role="dialog"
        aria-modal="true"
        aria-label="新建"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ws-modal-head">
          <div className="ws-modal-head-text">
            <div className="ws-modal-title">新建</div>
          </div>
          <button
            className="ws-modal-x"
            onClick={closeCreate}
            aria-label="关闭"
            disabled={generating}
          >
            <X size={16} />
          </button>
        </header>

        <div className="ws-modal-body">
          <div className="cm-choices">
            {/* blank doc */}
            <button className="cm-choice" onClick={handleBlank}>
              <span className="cm-choice-ico">
                <FileText size={18} />
              </span>
              <span className="cm-choice-text">
                <span className="cm-choice-title">空白文档</span>
                <span className="cm-choice-desc">从一张白纸开始</span>
              </span>
            </button>

            {/* AI generate */}
            <button
              className={`cm-choice${mode === 'ai' ? ' is-open' : ''}`}
              onClick={() => setMode('ai')}
            >
              <span className="cm-choice-ico cm-choice-ico-ai">
                <Sparkles size={18} />
              </span>
              <span className="cm-choice-text">
                <span className="cm-choice-title">用 AI 生成</span>
                <span className="cm-choice-desc">描述需求,自动起草</span>
              </span>
            </button>
            {mode === 'ai' && (
              <div className="cm-panel">
                <textarea
                  className="cm-textarea"
                  placeholder="描述你想要的文档,例如:给新客户的项目方案"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={generating}
                  autoFocus
                />
                <div className="cm-panel-foot">
                  <button
                    className="ws-btn ws-btn-primary"
                    onClick={handleGenerate}
                    disabled={generating || !prompt.trim()}
                  >
                    {generating ? <Spinner size={14} /> : null}
                    {generating ? '正在生成…' : '生成'}
                  </button>
                </div>
              </div>
            )}

            {/* from template */}
            <button
              className={`cm-choice${mode === 'template' ? ' is-open' : ''}`}
              onClick={() => setMode('template')}
            >
              <span className="cm-choice-ico">
                <LayoutTemplate size={18} />
              </span>
              <span className="cm-choice-text">
                <span className="cm-choice-title">从模板</span>
                <span className="cm-choice-desc">套用现成的版式</span>
              </span>
            </button>
            {mode === 'template' && (
              <div className="cm-panel">
                <div className="cm-tpl-list">
                  {templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      className="cm-tpl"
                      onClick={() => handleTemplate(tpl.id)}
                    >
                      <span className="cm-tpl-name">{tpl.name}</span>
                      <Pill>{tpl.category}</Pill>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
