import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, X, Blocks, Lock, Globe, CornerDownLeft } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { useBrowser } from '../mock/browser'
import { useT, type TFunc } from '../i18n'
import type { DocKind } from '../types'
import './CreateModal.css'

const DRAFTS = 'f-drafts'

const kindLabelWith = (t: TFunc) => (k: DocKind) =>
  k === 'page' ? t('modals.kindPage') : k === 'slides' ? t('modals.kindSlides') : t('modals.kindDoc')

// 新建文档分两层：先选「范式」（编辑范式 / 内核），范式下面才是各种模板。
// 目前只有「类 Notion」一个范式，范式 2 / 3 留 placeholder——代表将来会有多个范式，每个范式各有多套模板。
interface Paradigm {
  id: string
  name: string
  tag?: string
  desc: string
  soon: boolean
}
const paradigmsWith = (t: TFunc): Paradigm[] => [
  { id: 'notion', name: t('modals.paradigmNotion'), tag: t('modals.paradigmCurrent'), desc: t('modals.paradigmNotionDesc'), soon: false },
  { id: 'p2', name: t('modals.paradigm2'), desc: t('modals.comingSoon'), soon: true },
  { id: 'p3', name: t('modals.paradigm3'), desc: t('modals.comingSoon'), soon: true },
]

/**
 * 新建入口。两种打开方式（由 ui.createOmni 区分）：
 *  - 从「标签页 +」打开（omni）：Arc 式 modal——顶部一条地址栏（输网址/搜索 → 开网页标签页），
 *    下面接新建文档的范式 + 模板。把「新标签页」和「新建文档」拼成一个。
 *  - 从文件夹「+」/右键打开（非 omni）：只有新建文档选择器，建到 createTargetDir。
 * （「用 AI 生成」已挪出，未来集成进右下角 Agent 接入。）
 */
export default function CreateModal() {
  const t = useT()
  const PARADIGMS = paradigmsWith(t)
  const kindLabel = kindLabelWith(t)
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
    ? `${targetRoot?.name ?? firstRoot?.name ?? t('modals.docFallback')}${target.dir ? ` / ${target.dir}` : ''}`
    : (firstRoot?.name ?? t('modals.docFallback'))
  const active = PARADIGMS.find((p) => p.id === paradigm) ?? PARADIGMS[0]

  const done = () => {
    closeCreate()
    navigate('/docs')
  }
  // omni（从「标签页 +」进）→ 临时文档，不进文件树/库，手动保存才落地。
  const blank = () => {
    createDoc(DRAFTS, 'doc', t('sidebar.untitledDoc'), target, omni)
    done()
  }
  const fromTemplate = (id: string) => {
    createFromTemplate(id, DRAFTS, target, omni)
    done()
  }
  // 分类：官方模板 / 我的模板（别混在一块；每张卡只标「版式/骨架」，不再重复「文档」）。
  const officialTpls = companyTemplates.filter((t) => t.origin === 'official')
  const userTpls = companyTemplates.filter((t) => t.origin === 'user')
  const tplCard = (tpl: (typeof companyTemplates)[number]) => (
    <button
      key={tpl.id}
      className="cm-card cm-card-tpl"
      style={{ borderTopColor: tpl.accent }}
      onClick={() => fromTemplate(tpl.id)}
    >
      <span className="cm-card-kind">
        <span className="cm-card-styled" style={{ background: tpl.accent }}>{tpl.css ? t('templates.kindStyled') : t('templates.kindSkeleton')}</span>
      </span>
      <span className="cm-card-name">{tpl.name}</span>
      <span className="cm-card-desc">{tpl.description}</span>
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
        aria-label={omni ? t('modals.newTabOrDoc') : t('modals.newDoc')}
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
              placeholder={t('modals.searchOrUrl')}
              spellCheck={false}
            />
            {url.trim() && (
              <span className="cm-omnibar-kbd">
                <CornerDownLeft size={12} /> {t('common.open')}
              </span>
            )}
            <button className="ws-modal-x cm-omnibar-x" onClick={closeCreate} aria-label={t('common.close')}>
              <X size={16} />
            </button>
          </div>
        ) : (
          <header className="ws-modal-head">
            <div className="ws-modal-head-text">
              <div className="ws-modal-title">{t('modals.newDoc')}</div>
              <div className="cm-where">{t('modals.inLocation', { where })}</div>
            </div>
            <button className="ws-modal-x" onClick={closeCreate} aria-label={t('common.close')}>
              <X size={16} />
            </button>
          </header>
        )}

        <div className="cm-split">
          {/* 左：范式 */}
          <div className="cm-rail">
            <div className="cm-rail-label">{t('modals.paradigm')}</div>
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
            <div className="cm-rail-foot">{t('modals.paradigmRailFoot')}</div>
          </div>

          {/* 右：该范式下的模板 */}
          <div className="cm-pane">
            {active.soon ? (
              <div className="cm-soon">
                <div className="cm-soon-ico">
                  <Lock size={22} />
                </div>
                <div className="cm-soon-title">{t('modals.paradigmSoon', { name: active.name })}</div>
                <div className="cm-soon-desc">
                  {t('modals.paradigmSoonDesc')}
                </div>
              </div>
            ) : (
              <>
                <div className="cm-pane-label">{t('modals.officialTemplates')}</div>
                <div className="cm-grid">
                  <button className="cm-card cm-card-blank" onClick={blank}>
                    <span className="cm-card-ico">
                      <FileText size={18} />
                    </span>
                    <span className="cm-card-name">{t('modals.blankDoc')}</span>
                    <span className="cm-card-desc">{t('modals.blankDocDesc')}</span>
                  </button>
                  {officialTpls.map(tplCard)}
                </div>
                {userTpls.length > 0 && (
                  <>
                    <div className="cm-pane-label cm-pane-label-2">{t('templates.myTemplates')}</div>
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
