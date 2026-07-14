import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Upload, Download, Trash2, FilePlus2, Check, Copy, Sparkles } from 'lucide-react'
import { useStore } from '../mock/store'
import type { Template } from '../types'
import TEMPLATE_PROMPT from '../lib/template-prompt.md?raw'
import './TemplatesPage.css'

/** 「模板」管理页：分组列表（官方 / 我的）+ 详情面板（改名 / 编辑 CSS / 导出 / 删除 / 试用）+ 导入。 */
export default function TemplatesPage() {
  const navigate = useNavigate()
  const templates = useStore((s) => s.templates)
  const toast = useStore((s) => s.toast)
  const createFromTemplate = useStore((s) => s.createFromTemplate)
  const renameTemplate = useStore((s) => s.renameTemplate)
  const deleteTemplateWithUndo = useStore((s) => s.deleteTemplateWithUndo)
  const updateTemplateCss = useStore((s) => s.updateTemplateCss)
  const importTemplate = useStore((s) => s.importTemplate)
  const fileRef = useRef<HTMLInputElement>(null)

  const official = templates.filter((t) => t.origin === 'official')
  const mine = templates.filter((t) => t.origin === 'user')

  const [selId, setSelId] = useState<string>(official[0]?.id ?? '')
  const sel = templates.find((t) => t.id === selId) ?? official[0]
  const isUser = sel?.origin === 'user'

  // CSS 编辑本地态（仅用户模板）：换选中或按钮触发时重置。
  const [editCss, setEditCss] = useState<string>('')
  const [violations, setViolations] = useState<{ rule: string; msg: string }[]>([])
  const [dirtyId, setDirtyId] = useState<string>('')
  const cssValue = dirtyId === sel?.id ? editCss : sel?.css ?? ''
  const beginEdit = (v: string) => {
    setDirtyId(sel!.id)
    setEditCss(v)
    setViolations([])
  }
  const saveCss = () => {
    if (!sel) return
    const r = updateTemplateCss(sel.id, cssValue)
    setViolations(r.violations)
    if (r.ok) setDirtyId('')
  }

  const doExport = (t: Template) => {
    const payload = { name: t.name, kind: t.kind, category: t.category, description: t.description, accent: t.accent, css: t.css, blocks: t.blocks }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${t.name}.wstpl.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    toast(`已导出「${t.name}」`, 'success')
  }
  const onImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    f.text().then((txt) => {
      let obj: unknown
      try {
        obj = JSON.parse(txt)
      } catch {
        toast('不是有效的 JSON 模板文件', 'danger')
        return
      }
      const r = importTemplate(obj)
      if (!r.ok) toast(r.error ?? '导入失败', 'danger')
    })
    e.target.value = ''
  }
  const tryIt = (t: Template) => {
    createFromTemplate(t.id, '')
    navigate('/docs')
  }

  // AI 生成（外部通道，衔接现有「复制 Prompt / 粘贴导入」形态）
  const [aiOpen, setAiOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [paste, setPaste] = useState('')
  const copyPrompt = () => {
    void navigator.clipboard?.writeText(TEMPLATE_PROMPT)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }
  const importPaste = () => {
    let obj: unknown
    try {
      obj = JSON.parse(paste)
    } catch {
      toast('粘贴的不是有效 JSON', 'danger')
      return
    }
    const r = importTemplate(obj)
    if (r.ok) setPaste('')
    else toast(r.error ?? '导入失败', 'danger')
  }

  const Card = ({ t }: { t: Template }) => (
    <button className={'tplp-card' + (t.id === selId ? ' is-sel' : '')} onClick={() => setSelId(t.id)}>
      <span className="tplp-swatch" style={{ background: t.accent }} />
      <span className="tplp-card-meta">
        <span className="tplp-card-name">{t.name}</span>
        <span className="tplp-card-tag">{t.css ? '版式' : '骨架'}</span>
      </span>
      {t.id === selId && <Check size={14} strokeWidth={2.2} />}
    </button>
  )

  return (
    <div className="tplp-page">
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onImportFile} />
      <header className="tplp-top">
        <button className="tplp-back" onClick={() => navigate('/docs')} title="返回">
          <ChevronLeft size={18} />
        </button>
        <h1>模板</h1>
        <div className="tplp-actions">
          <button className="tplp-btn" onClick={() => fileRef.current?.click()}>
            <Upload size={15} strokeWidth={1.8} /> 导入模板
          </button>
        </div>
      </header>

      <div className="tplp-body">
        <div className="tplp-list">
          {/* AI 生成模板：外部通道（复制 Prompt → 让 AI 产 JSON → 粘贴导入，过安全门）。 */}
          <button className={'tplp-ai-toggle' + (aiOpen ? ' is-open' : '')} onClick={() => setAiOpen((v) => !v)}>
            <Sparkles size={15} strokeWidth={1.8} /> 用 AI 生成模板
          </button>
          {aiOpen && (
            <div className="tplp-ai">
              <button className="tplp-btn tplp-ai-copy" onClick={copyPrompt}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? '已复制' : '复制创作 Prompt'}
              </button>
              <div className="tplp-ai-hint">把 Prompt 发给任意 AI，让它产出模板 JSON，粘贴到下面导入（会过安全门）。</div>
              <textarea
                className="tplp-ai-paste"
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder='粘贴 AI 产出的模板 JSON，如 {"name":"…","css":"…"}'
                spellCheck={false}
              />
              <button className="tplp-save-css" onClick={importPaste} disabled={!paste.trim()}>
                导入粘贴的模板
              </button>
            </div>
          )}

          <div className="tplp-group-label">官方</div>
          {official.map((t) => (
            <Card key={t.id} t={t} />
          ))}

          <div className="tplp-group-label">我的</div>
          {mine.length === 0 ? (
            <div className="tplp-empty">
              还没有自己的模板。<br />
              在文档的 ⋯ 菜单里「存为模板」，或从文件「导入模板」，也可以先看看上面的官方模板。
            </div>
          ) : (
            mine.map((t) => <Card key={t.id} t={t} />)
          )}
        </div>

        {sel && (
          <div className="tplp-detail">
            <div className="tplp-detail-head">
              <span className="tplp-swatch lg" style={{ background: sel.accent }} />
              {isUser ? (
                <input
                  className="tplp-name-input"
                  value={sel.name}
                  onChange={(e) => renameTemplate(sel.id, e.target.value)}
                />
              ) : (
                <span className="tplp-detail-name">{sel.name}</span>
              )}
            </div>
            <div className="tplp-detail-desc">{sel.description}</div>

            <div className="tplp-css-label">
              版式 CSS {!isUser && <span className="tplp-ro">（官方模板只读）</span>}
            </div>
            <textarea
              className="tplp-css"
              value={cssValue}
              readOnly={!isUser}
              spellCheck={false}
              onChange={(e) => beginEdit(e.target.value)}
              placeholder={sel.css ? '' : '（纯骨架模板，无版式 CSS）'}
            />
            {violations.length > 0 && (
              <div className="tplp-violations">
                {violations.map((v, i) => (
                  <div key={i} className="tplp-violation">✗ {v.msg}</div>
                ))}
              </div>
            )}
            {isUser && dirtyId === sel.id && (
              <button className="tplp-save-css" onClick={saveCss}>保存样式（过安全门）</button>
            )}

            <div className="tplp-detail-actions">
              <button className="tplp-btn" onClick={() => tryIt(sel)}>
                <FilePlus2 size={15} strokeWidth={1.8} /> 新建文档试用
              </button>
              <button className="tplp-btn" onClick={() => doExport(sel)}>
                <Download size={15} strokeWidth={1.8} /> 导出
              </button>
              {isUser && (
                <button className="tplp-btn tplp-btn-danger" onClick={() => deleteTemplateWithUndo(sel.id)}>
                  <Trash2 size={15} strokeWidth={1.8} /> 删除
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
