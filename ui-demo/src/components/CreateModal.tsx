import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, X, Blocks, Lock, Globe, CornerDownLeft } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { useBrowser } from '../mock/browser'
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

/**
 * 新建入口。两种打开方式（由 ui.createOmni 区分）：
 *  - 从「标签页 +」打开（omni）：Arc 式 modal——顶部一条地址栏（输网址/搜索 → 开网页标签页），
 *    下面接新建文档的范式 + 模板。把「新标签页」和「新建文档」拼成一个。
 *  - 从文件夹「+」/右键打开（非 omni）：只有新建文档选择器，建到 createTargetDir。
 * （「用 AI 生成」已挪出，未来集成进右下角 Agent 接入。）
 */
export default function CreateModal() {
  const navigate = useNavigate()
  const createOpen = useUI((s) => s.createOpen)
  const closeCreate = useUI((s) => s.closeCreate)
  const omni = useUI((s) => s.createOmni)
  const target = useUI((s) => s.createTarget)

  const createDoc = useStore((s) => s.createDoc)
  const createFromTemplate = useStore((s) => s.createFromTemplate)
  const newBrowserTab = useStore((s) => s.newBrowserTab)
  const templates = useStore((s) => s.templates)
  const roots = useStore((s) => s.roots)

  const [paradigm, setParadigm] = useState('notion')
  const [url, setUrl] = useState('')
  const urlRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (createOpen) {
      setParadigm('notion')
      setUrl('')
    }
  }, [createOpen])

  // Arc 式：打开 omni 入口就把光标放进地址栏，可直接打字
  useEffect(() => {
    if (createOpen && omni) urlRef.current?.focus()
  }, [createOpen, omni])

  useEffect(() => {
    if (!createOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCreate()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [createOpen, closeCreate])

  if (!createOpen) return null

  const companyTemplates = templates.filter((t) => t.pool === 'private')
  // 定位「建到哪」的展示——目标根名 + 子目录；没指定就落第一个打开的文件夹（保存时可再选）。
  const firstRoot = roots.find((r) => !r.missing)
  const targetRoot = target ? roots.find((r) => r.id === target.rootId) : undefined
  const where = target
    ? `${targetRoot?.name ?? firstRoot?.name ?? '文档'}${target.dir ? ` / ${target.dir}` : ''}`
    : (firstRoot?.name ?? '文档')
  const active = PARADIGMS.find((p) => p.id === paradigm) ?? PARADIGMS[0]

  const done = () => {
    closeCreate()
    navigate('/docs')
  }
  // omni（从「标签页 +」进）→ 临时文档，不进文件树/库，手动保存才落地。
  const blank = () => {
    createDoc(DRAFTS, 'doc', '无标题文档', target, omni)
    done()
  }
  const fromTemplate = (id: string) => {
    createFromTemplate(id, DRAFTS, target, omni)
    done()
  }
  // 分类：官方模板 / 我的模板（别混在一块；每张卡只标「版式/骨架」，不再重复「文档」）。
  const officialTpls = companyTemplates.filter((t) => t.origin === 'official')
  const userTpls = companyTemplates.filter((t) => t.origin === 'user')
  const tplCard = (t: (typeof companyTemplates)[number]) => (
    <button
      key={t.id}
      className="cm-card cm-card-tpl"
      style={{ borderTopColor: t.accent }}
      onClick={() => fromTemplate(t.id)}
    >
      <span className="cm-card-kind">
        <span className="cm-card-styled" style={{ background: t.accent }}>{t.css ? '版式' : '骨架'}</span>
      </span>
      <span className="cm-card-name">{t.name}</span>
      <span className="cm-card-desc">{t.description}</span>
    </button>
  )

  // 地址栏：开一个新网页标签页并导航过去（跟侧栏地址栏 submitOmni 同一套）
  const submitUrl = () => {
    const v = url.trim()
    if (!v) return
    newBrowserTab()
    useBrowser.getState().navigate(v)
    done()
  }

  return (
    <div className="ws-modal-overlay" onMouseDown={closeCreate}>
      <div
        className={'ws-modal cm-new' + (omni ? ' cm-omni' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={omni ? '新建标签页或文档' : '新建文档'}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {omni ? (
          // 顶部：Arc 式地址栏（输网址/搜索 → 开网页标签页）
          <div className="cm-omnibar">
            <Globe size={17} className="cm-omnibar-ico" />
            <input
              ref={urlRef}
              className="cm-omnibar-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitUrl()
              }}
              placeholder="搜索，或输入网址"
              spellCheck={false}
            />
            {url.trim() && (
              <span className="cm-omnibar-kbd">
                <CornerDownLeft size={12} /> 打开
              </span>
            )}
            <button className="ws-modal-x cm-omnibar-x" onClick={closeCreate} aria-label="关闭">
              <X size={16} />
            </button>
          </div>
        ) : (
          <header className="ws-modal-head">
            <div className="ws-modal-head-text">
              <div className="ws-modal-title">新建文档</div>
              <div className="cm-where">在 {where}</div>
            </div>
            <button className="ws-modal-x" onClick={closeCreate} aria-label="关闭">
              <X size={16} />
            </button>
          </header>
        )}

        <div className="cm-split">
          {/* 左：范式 */}
          <div className="cm-rail">
            <div className="cm-rail-label">范式</div>
            {PARADIGMS.map((p) => (
              <button
                key={p.id}
                className={
                  'cm-para' + (p.id === paradigm ? ' is-active' : '') + (p.soon ? ' is-soon' : '')
                }
                onClick={() => setParadigm(p.id)}
              >
                <span className="cm-para-ico">
                  {p.soon ? <Lock size={15} /> : <Blocks size={15} />}
                </span>
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
            ) : (
              <>
                <div className="cm-pane-label">官方模板</div>
                <div className="cm-grid">
                  <button className="cm-card cm-card-blank" onClick={blank}>
                    <span className="cm-card-ico">
                      <FileText size={18} />
                    </span>
                    <span className="cm-card-name">空白文档</span>
                    <span className="cm-card-desc">从一张白纸开始</span>
                  </button>
                  {officialTpls.map(tplCard)}
                </div>
                {userTpls.length > 0 && (
                  <>
                    <div className="cm-pane-label cm-pane-label-2">我的模板</div>
                    <div className="cm-grid">{userTpls.map(tplCard)}</div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
