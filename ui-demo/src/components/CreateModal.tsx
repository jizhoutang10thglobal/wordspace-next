import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Sparkles, X, Blocks, Lock, Copy, Check, ExternalLink } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import type { DocKind } from '../types'
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

// 「用 AI 生成」= 帮用户用自己的 AI 生成一份合规文档。把 Schema 规则写进提示词，
// 只要 AI 守着这套规则，产出的 .html 就是 Wordspace 能直接打开的合规文件。
// （mockup：提示词内容是示意，足够说明思路；复制是真的。）
const SCHEMA_PROMPT = `你是 Wordspace 文档生成器。请只输出一个完整的 HTML 文档，并严格遵守 Wordspace Schema #1（受限 HTML）：

【结构】正文由一段段「块」直接平铺在 <body> 下：
标题 h1–h4 / 段落 p / 列表 ul·ol>li / 待办（li 带 data-checked）/ 引用 blockquote / 提示框 div.callout / 分隔线 hr / 规整矩形表格（不合并单元格）。标题最深到 h4。

【行内】只用 <strong> <em> <u> <s> <code> <a>，文字颜色和高亮走固定 class。

【禁止】
- 不要 <script> 或任何 on* 事件
- 不要 position:absolute 等绝对定位
- 不要在块元素上写 style=""（颜色用固定 class）
- 表格不要 colspan / rowspan
- 不要 <iframe> / <object> 等外部嵌入
- 不要外链 CSS 或 <style> 排版

只输出 HTML，不要额外解释。`

const SKILL_CMD = 'claude plugin install wordspace/schema-skill'
const SKILL_URL = 'https://wordspace.ai/skill'
const SKILL_DOCS = 'https://wordspace.ai/skill/guide'

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
  const createFromTemplate = useStore((s) => s.createFromTemplate)
  const templates = useStore((s) => s.templates)
  const spaces = useStore((s) => s.spaces)
  const activeSpaceId = useStore((s) => s.activeSpaceId)

  const [paradigm, setParadigm] = useState('notion')
  const [mode, setMode] = useState<'pick' | 'ai'>('pick')
  const [aiTab, setAiTab] = useState<'prompt' | 'skill'>('prompt')
  const [prompt, setPrompt] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (createOpen) {
      setParadigm('notion')
      setMode('pick')
      setAiTab('prompt')
      setPrompt('')
      setCopied(null)
    }
  }, [createOpen])

  useEffect(() => {
    if (!createOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCreate()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [createOpen, closeCreate])

  if (!createOpen) return null

  const space = spaces.find((s) => s.id === activeSpaceId)
  const dir = targetDir ?? undefined // undefined → store defaults (root / 我的草稿)
  const companyTemplates = templates.filter((t) => t.pool === 'private')
  const where =
    targetDir && targetDir !== '' ? `${space?.name} / ${targetDir}` : (space?.name ?? '当前空间')
  const active = PARADIGMS.find((p) => p.id === paradigm) ?? PARADIGMS[0]
  const fullPrompt =
    SCHEMA_PROMPT +
    '\n\n我想要的文档：\n' +
    (prompt.trim() || '（在这里写你的需求，例如：给新客户的项目周报）')

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
  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text)
    setCopied(key)
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600)
  }

  const pickParadigm = (p: Paradigm) => {
    setParadigm(p.id)
    setMode('pick')
  }

  return (
    <div className="ws-modal-overlay" onMouseDown={closeCreate}>
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
          <button className="ws-modal-x" onClick={closeCreate} aria-label="关闭">
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
                    <span className="cm-card-desc">生成符合 Schema 的文档</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="cm-ai">
                <p className="cm-ai-intro">
                  Wordspace 不自己跑 AI——而是给你一段<strong>内置 Schema 规则</strong>的提示词，或一个 Schema
                  Skill。只要 AI 守着这套规则，产出的 .html 就是 Wordspace 能直接打开的合规文档。
                </p>

                <div className="cm-ai-tabs" role="tablist">
                  <button
                    className={'cm-ai-tab' + (aiTab === 'prompt' ? ' is-active' : '')}
                    onClick={() => setAiTab('prompt')}
                  >
                    复制 Prompt · 单次
                  </button>
                  <button
                    className={'cm-ai-tab' + (aiTab === 'skill' ? ' is-active' : '')}
                    onClick={() => setAiTab('skill')}
                  >
                    安装 Skill · 长期
                  </button>
                </div>

                {aiTab === 'prompt' ? (
                  <div className="cm-ai-sec">
                    <label className="cm-ai-flabel" htmlFor="cm-ai-ask">
                      描述你想要的文档（可选）
                    </label>
                    <textarea
                      id="cm-ai-ask"
                      className="cm-ai-input cm-ai-input-sm"
                      placeholder="例如：给新客户的项目周报"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                    />
                    <div className="cm-ai-flabel cm-ai-flabel-row">
                      <span>完整提示词（已含 Schema 规则）</span>
                      <button
                        className={'cm-copy' + (copied === 'prompt' ? ' is-done' : '')}
                        onClick={() => copy('prompt', fullPrompt)}
                      >
                        {copied === 'prompt' ? (
                          <>
                            <Check size={13} /> 已复制
                          </>
                        ) : (
                          <>
                            <Copy size={13} /> 一键复制
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="cm-prompt">{fullPrompt}</pre>
                    <p className="cm-ai-hint">
                      粘到 ChatGPT / Claude，把它生成的 .html 拖回 Wordspace 打开即可。
                    </p>
                  </div>
                ) : (
                  <div className="cm-ai-sec">
                    <ol className="cm-skill">
                      <li className="cm-skill-step">
                        <span className="cm-step-n">1</span>
                        <div className="cm-step-body">
                          <div className="cm-step-title">安装 Wordspace Schema Skill</div>
                          <div className="cm-step-desc">装一次，你的 AI 就长期记得这套 Schema。</div>
                          <div className="cm-step-actions">
                            <a className="cm-link-btn" href={SKILL_URL} target="_blank" rel="noreferrer">
                              打开 wordspace.ai/skill <ExternalLink size={12} />
                            </a>
                            <button
                              className={'cm-cmd' + (copied === 'cmd' ? ' is-done' : '')}
                              onClick={() => copy('cmd', SKILL_CMD)}
                            >
                              <code>{SKILL_CMD}</code>
                              {copied === 'cmd' ? <Check size={13} /> : <Copy size={13} />}
                            </button>
                          </div>
                        </div>
                      </li>
                      <li className="cm-skill-step">
                        <span className="cm-step-n">2</span>
                        <div className="cm-step-body">
                          <div className="cm-step-title">在你的 AI 里调用它</div>
                          <div className="cm-step-desc">例：「用 Wordspace Schema 帮我写一份产品周报」</div>
                        </div>
                      </li>
                      <li className="cm-skill-step">
                        <span className="cm-step-n">3</span>
                        <div className="cm-step-body">
                          <div className="cm-step-title">生成即合规</div>
                          <div className="cm-step-desc">
                            Skill 内置 Schema，输出的文档直接能在 Wordspace 打开、继续块编辑。
                          </div>
                          <a
                            className="cm-link-btn cm-link-plain"
                            href={SKILL_DOCS}
                            target="_blank"
                            rel="noreferrer"
                          >
                            查看完整教程 <ExternalLink size={12} />
                          </a>
                        </div>
                      </li>
                    </ol>
                  </div>
                )}

                <div className="cm-ai-foot">
                  <button className="ws-btn" onClick={() => setMode('pick')}>
                    返回
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
