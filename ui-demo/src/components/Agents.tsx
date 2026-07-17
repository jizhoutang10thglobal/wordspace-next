import { useState, useEffect } from 'react'
import { Copy, Check, ClipboardList, TerminalSquare, ShieldCheck, ChevronDown, X } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { relTime } from '../lib/format'
import { useT } from '../i18n'
import type { AgentEvent } from '../types'
// AI 创作指南（= docs/schema-1-ai-authoring.md 的分发拷贝，test/skill-guide-sync.test.js 锁一致）
import SCHEMA_PROMPT from '../lib/schema-prompt.md?raw'
import './Agents.css'

// 官方技能仓库（GitHub org `wordspace-ai`，与品牌绑定；见 docs/design/2026-07-02-ai-prompt-skill-distribution.md）
const SKILL_CMD = 'npx skills add wordspace-ai/skills'

// ---- Agent API 占位（Wendi 原稿，保留展示、规划中；暂不进真 app）----
// action → misc 命名空间 key，渲染时用组件 t() 解析（切语言即更新）。
const ACTION_VERB: Record<AgentEvent['action'], string> = {
  create: 'misc.actionCreate',
  read: 'misc.actionRead',
  publish: 'misc.actionPublish',
  update: 'misc.actionUpdate',
}
const API_BASE = 'https://api.wordspace.app/v1'
const API_KEY = 'wsk_live_••••••••3f2a'

// AI 接入：上半 = 现在就能用的两条路（Tab 切换：复制 Prompt / 安装 Skill），
// 下半 = Agent API 占位（Wendi 原稿，规划中）。产出不靠 AI 自觉：打开即过确定性校验器，不合规降级兜底。
export default function Agents() {
  const t = useT()
  const open = useUI((s) => s.agentsOpen)
  const close = useUI((s) => s.closeAgents)
  const toast = useStore((s) => s.toast)
  const agentEvents = useStore((s) => s.agentEvents)
  const addAgentEvent = useStore((s) => s.addAgentEvent)
  const CURL = t('misc.curlExample')

  const [tab, setTab] = useState<'prompt' | 'skill'>('prompt')
  const [copied, setCopied] = useState<'prompt' | 'cmd' | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [perms, setPerms] = useState({
    create: true,
    read: true,
    publishInternal: false,
  })

  const copy = (text: string, msg = t('misc.copied')) => {
    void navigator.clipboard?.writeText(text)
    toast(msg, 'success')
  }
  const copyMark = (text: string, which: 'prompt' | 'cmd', msg: string) => {
    copy(text, msg)
    setCopied(which)
    window.setTimeout(() => setCopied((c) => (c === which ? null : c)), 1800)
  }

  const simulate = () => {
    const name = t('misc.simAgentName')
    const title = t('misc.simDocTitle')
    addAgentEvent({
      agentName: name,
      agentColor: '#0b8793',
      action: 'create',
      docTitle: title,
    })
    toast(t('misc.simToast', { name, title }), 'success')
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  return (
    <div className="ws-modal-overlay" onMouseDown={close}>
      <div className="ws-modal ag-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ws-modal-head">
          <div className="ws-modal-head-text">
            <div className="ws-modal-title">{t('misc.title')}</div>
            <div className="ws-modal-sub">{t('misc.subtitle')}</div>
          </div>
          <button className="ws-modal-x" onClick={close} aria-label={t('common.close')}><X size={18} /></button>
        </div>
        <div className="ws-modal-body ag-modal-body">
          <p className="ag-intro">{t('misc.intro')}</p>

          {/* 方式切换 Tab */}
        <div className="ag-tabs" role="tablist" aria-label={t('misc.tablistLabel')}>
          <button
            role="tab"
            aria-selected={tab === 'prompt'}
            className={'ag-tab' + (tab === 'prompt' ? ' is-active' : '')}
            onClick={() => setTab('prompt')}
          >
            <ClipboardList size={14} />
            {t('misc.copyPrompt')}
            <span className="ag-tab-hint">{t('misc.tabPromptHint')}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'skill'}
            className={'ag-tab' + (tab === 'skill' ? ' is-active' : '')}
            onClick={() => setTab('skill')}
          >
            <TerminalSquare size={14} />
            {t('misc.tabSkill')}
            <span className="ag-tab-hint">coding agent</span>
          </button>
        </div>

        {tab === 'prompt' ? (
          <section className="ag-panel" role="tabpanel">
            <div className="ag-card">
              <div className="ag-way-head">
                <div className="ag-way-text">
                  <div className="ag-way-title">{t('misc.promptWayTitle')}</div>
                  <div className="ag-way-hint">{t('misc.promptWayHint')}</div>
                </div>
                <button
                  className="ag-primary"
                  onClick={() => copyMark(SCHEMA_PROMPT, 'prompt', t('misc.toastPromptCopied'))}
                >
                  {copied === 'prompt' ? <Check size={14} /> : <Copy size={14} />}
                  {copied === 'prompt' ? t('misc.copied') : t('misc.copyPrompt')}
                </button>
              </div>
              <div className="ag-divider" />
              <ol className="ag-steps">
                <li>{t('misc.promptStep1')}</li>
                <li>{t('misc.promptStep2')}</li>
                <li>{t('misc.promptStep3a')}<code>.html</code>{t('misc.promptStep3b')}</li>
              </ol>
              <div className="ag-divider" />
              <button className="ag-preview-toggle" onClick={() => setPreviewOpen((v) => !v)}>
                <ChevronDown size={13} className={previewOpen ? 'is-open' : ''} />
                {t('misc.previewPrompt')}
                <span className="ag-preview-meta">{t('misc.charCount', { n: SCHEMA_PROMPT.length.toLocaleString() })}</span>
              </button>
              {previewOpen && <pre className="ag-preview">{SCHEMA_PROMPT}</pre>}
            </div>
          </section>
        ) : (
          <section className="ag-panel" role="tabpanel">
            <div className="ag-card">
              <div className="ag-way-head">
                <div className="ag-way-text">
                  <div className="ag-way-title">{t('misc.skillWayTitle')}</div>
                  <div className="ag-way-hint">{t('misc.skillWayHint')}</div>
                </div>
              </div>
              <div className="ag-divider" />
              <div className="ag-cmd-row">
                <pre className="ag-cmd">{SKILL_CMD}</pre>
                <button
                  className="ag-copy"
                  onClick={() => copyMark(SKILL_CMD, 'cmd', t('misc.toastCmdCopied'))}
                >
                  {copied === 'cmd' ? <Check size={13} /> : <Copy size={13} />}
                  {t('common.copy')}
                </button>
              </div>
              <ol className="ag-steps">
                <li>{t('misc.skillStep1')}</li>
                <li>{t('misc.skillStep2')}<code>.html</code></li>
                <li>{t('misc.skillStep3')}</li>
              </ol>
            </div>
          </section>
        )}

        {/* 为什么不怕 AI 犯错 */}
        <section className="ag-section">
          <div className="ag-note">
            <ShieldCheck size={15} className="ag-note-ico" />
            <span>
              {t('misc.noteA')}<b>{t('misc.noteBold')}</b>{t('misc.noteB')}
            </span>
          </div>
        </section>

        {/* ==== Agent API 占位（Wendi 原稿，规划中；暂不进真 app）==== */}
        <div className="ag-planned-label">{t('misc.plannedLabel')}</div>

        {/* API */}
        <section className="ag-section">
          <div className="ag-label">API</div>
          <div className="ag-card">
            <div className="ag-row">
              <div className="ag-row-main">
                <div className="ag-row-key">{t('misc.apiEndpoint')}</div>
                <code className="ag-mono">{API_BASE}</code>
              </div>
              <button className="ag-copy" onClick={() => copy(API_BASE)}>
                <Copy size={13} />
                {t('common.copy')}
              </button>
            </div>
            <div className="ag-divider" />
            <div className="ag-row">
              <div className="ag-row-main">
                <div className="ag-row-key">API Key</div>
                <code className="ag-mono">{API_KEY}</code>
              </div>
              <button className="ag-copy" onClick={() => copy(API_KEY)}>
                <Copy size={13} />
                {t('common.copy')}
              </button>
            </div>
            <div className="ag-divider" />
            <div className="ag-code-wrap">
              <div className="ag-row-key ag-code-label">{t('misc.apiExample')}</div>
              <pre className="ag-code">{CURL}</pre>
            </div>
          </div>
        </section>

        {/* 权限 */}
        <section className="ag-section">
          <div className="ag-label">{t('misc.permsLabel')}</div>
          <div className="ag-card">
            <PermRow
              label={t('misc.permCreate')}
              hint={t('misc.permCreateHint')}
              on={perms.create}
              onToggle={() => setPerms((p) => ({ ...p, create: !p.create }))}
            />
            <div className="ag-divider" />
            <PermRow
              label={t('misc.permRead')}
              hint={t('misc.permReadHint')}
              on={perms.read}
              onToggle={() => setPerms((p) => ({ ...p, read: !p.read }))}
            />
            <div className="ag-divider" />
            <PermRow
              label={t('misc.permPublish')}
              hint={t('misc.permPublishHint')}
              on={perms.publishInternal}
              onToggle={() =>
                setPerms((p) => ({ ...p, publishInternal: !p.publishInternal }))
              }
            />
          </div>
        </section>

        {/* 活动 */}
        <section className="ag-section">
          <div className="ag-label">{t('misc.activityLabel')}</div>
          <button className="ag-sim" onClick={simulate}>
            {t('misc.simulate')}
          </button>
          <div className="ag-events">
            {agentEvents.length === 0 ? (
              <div className="ag-empty">{t('misc.noEvents')}</div>
            ) : (
              agentEvents.map((e) => (
                <div key={e.id} className="ag-event">
                  <span className="ag-chip" style={{ background: e.agentColor }}>
                    AI
                  </span>
                  <span className="ag-event-name">{e.agentName}</span>
                  <span className="ag-event-verb">{t(ACTION_VERB[e.action])}</span>
                  <span className="ag-event-doc">{t('misc.docQuoted', { title: e.docTitle })}</span>
                  <span className="ag-event-time">{relTime(e.at)}</span>
                </div>
              ))
            )}
          </div>
        </section>
        </div>
      </div>
    </div>
  )
}

function PermRow({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string
  hint: string
  on: boolean
  onToggle: () => void
}) {
  return (
    <div className="ag-perm">
      <div className="ag-perm-text">
        <div className="ag-perm-label">{label}</div>
        <div className="ag-perm-hint">{hint}</div>
      </div>
      <button
        className={`ag-toggle${on ? ' is-on' : ''}`}
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onToggle}
      >
        <span className="ag-toggle-knob" />
      </button>
    </div>
  )
}
