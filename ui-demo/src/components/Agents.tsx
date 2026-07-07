import { useState, useEffect } from 'react'
import { Copy, Check, ClipboardList, TerminalSquare, ShieldCheck, ChevronDown, X } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { relTime } from '../lib/format'
import type { AgentEvent } from '../types'
// AI 创作指南（= docs/schema-1-ai-authoring.md 的分发拷贝，test/skill-guide-sync.test.js 锁一致）
import SCHEMA_PROMPT from '../lib/schema-prompt.md?raw'
import './Agents.css'

// 官方技能仓库（GitHub org `wordspace-ai`，与品牌绑定；见 docs/design/2026-07-02-ai-prompt-skill-distribution.md）
const SKILL_CMD = 'npx skills add wordspace-ai/skills'

// ---- Agent API 占位（Wendi 原稿，保留展示、规划中；暂不进真 app）----
const ACTION_VERB: Record<AgentEvent['action'], string> = {
  create: '生成',
  read: '读取',
  publish: '发布',
  update: '更新',
}
const API_BASE = 'https://api.wordspace.app/v1'
const API_KEY = 'wsk_live_••••••••3f2a'
const CURL = `curl -X POST https://api.wordspace.app/v1/documents \\
  -H "Authorization: Bearer $WS_KEY" \\
  -d '{"title":"周报","blocks":[...],"publish":"internal"}'`

// AI 接入：上半 = 现在就能用的两条路（Tab 切换：复制 Prompt / 安装 Skill），
// 下半 = Agent API 占位（Wendi 原稿，规划中）。产出不靠 AI 自觉：打开即过确定性校验器，不合规降级兜底。
export default function Agents() {
  const open = useUI((s) => s.agentsOpen)
  const close = useUI((s) => s.closeAgents)
  const toast = useStore((s) => s.toast)
  const agentEvents = useStore((s) => s.agentEvents)
  const addAgentEvent = useStore((s) => s.addAgentEvent)

  const [tab, setTab] = useState<'prompt' | 'skill'>('prompt')
  const [copied, setCopied] = useState<'prompt' | 'cmd' | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [perms, setPerms] = useState({
    create: true,
    read: true,
    publishInternal: false,
  })

  const copy = (text: string, msg = '已复制') => {
    void navigator.clipboard?.writeText(text)
    toast(msg, 'success')
  }
  const copyMark = (text: string, which: 'prompt' | 'cmd', msg: string) => {
    copy(text, msg)
    setCopied(which)
    window.setTimeout(() => setCopied((c) => (c === which ? null : c)), 1800)
  }

  const simulate = () => {
    addAgentEvent({
      agentName: '市场 Agent',
      agentColor: '#0b8793',
      action: 'create',
      docTitle: '自动周报',
    })
    toast('市场 Agent 生成了《自动周报》', 'success')
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
            <div className="ws-modal-title">AI 接入</div>
            <div className="ws-modal-sub">让任何 AI 按 Wordspace Schema 生成、编辑文档</div>
          </div>
          <button className="ws-modal-x" onClick={close} aria-label="关闭"><X size={18} /></button>
        </div>
        <div className="ws-modal-body ag-modal-body">
          <p className="ag-intro">
            两种接入方式，产出的 .html 在 Wordspace 打开时都会经过确定性校验器把关——
            不合规会自动降级，AI 犯错也弄不坏你的文档。
          </p>

          {/* 方式切换 Tab */}
        <div className="ag-tabs" role="tablist" aria-label="接入方式">
          <button
            role="tab"
            aria-selected={tab === 'prompt'}
            className={'ag-tab' + (tab === 'prompt' ? ' is-active' : '')}
            onClick={() => setTab('prompt')}
          >
            <ClipboardList size={14} />
            复制 Prompt
            <span className="ag-tab-hint">任何对话式 AI</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'skill'}
            className={'ag-tab' + (tab === 'skill' ? ' is-active' : '')}
            onClick={() => setTab('skill')}
          >
            <TerminalSquare size={14} />
            安装 Skill
            <span className="ag-tab-hint">coding agent</span>
          </button>
        </div>

        {tab === 'prompt' ? (
          <section className="ag-panel" role="tabpanel">
            <div className="ag-card">
              <div className="ag-way-head">
                <div className="ag-way-text">
                  <div className="ag-way-title">粘给任何对话式 AI，零安装</div>
                  <div className="ag-way-hint">
                    Claude、ChatGPT、Gemini……Prompt 就是完整的《Schema #1 创作指南》。
                  </div>
                </div>
                <button
                  className="ag-primary"
                  onClick={() => copyMark(SCHEMA_PROMPT, 'prompt', '已复制 Prompt，粘给你的 AI 即可')}
                >
                  {copied === 'prompt' ? <Check size={14} /> : <Copy size={14} />}
                  {copied === 'prompt' ? '已复制' : '复制 Prompt'}
                </button>
              </div>
              <div className="ag-divider" />
              <ol className="ag-steps">
                <li>点上面的按钮，把 Prompt 复制到剪贴板</li>
                <li>粘进你的 AI 对话，接着用一句话描述要写 / 要改什么（可以把现有 .html 一起贴给它）</li>
                <li>把 AI 产出的内容存成 <code>.html</code>，在 Wordspace 打开——合规即获得完整结构化编辑</li>
              </ol>
              <div className="ag-divider" />
              <button className="ag-preview-toggle" onClick={() => setPreviewOpen((v) => !v)}>
                <ChevronDown size={13} className={previewOpen ? 'is-open' : ''} />
                预览 Prompt 内容
                <span className="ag-preview-meta">{SCHEMA_PROMPT.length.toLocaleString()} 字符</span>
              </button>
              {previewOpen && <pre className="ag-preview">{SCHEMA_PROMPT}</pre>}
            </div>
          </section>
        ) : (
          <section className="ag-panel" role="tabpanel">
            <div className="ag-card">
              <div className="ag-way-head">
                <div className="ag-way-text">
                  <div className="ag-way-title">给 coding agent 装成长期技能</div>
                  <div className="ag-way-hint">
                    装一次，Claude Code、Codex、Cursor 等 agent 此后生成 / 编辑 Wordspace 文档时自动遵守 Schema。
                  </div>
                </div>
              </div>
              <div className="ag-divider" />
              <div className="ag-cmd-row">
                <pre className="ag-cmd">{SKILL_CMD}</pre>
                <button
                  className="ag-copy"
                  onClick={() => copyMark(SKILL_CMD, 'cmd', '已复制安装命令')}
                >
                  {copied === 'cmd' ? <Check size={13} /> : <Copy size={13} />}
                  复制
                </button>
              </div>
              <ol className="ag-steps">
                <li>在你的项目目录里跑上面这条命令（从 Wordspace 官方技能仓库安装）</li>
                <li>让 agent 写文档时点明「Wordspace 文档」，它会自动按 Schema 产出 <code>.html</code></li>
                <li>产出文件在 Wordspace 打开即自动校验，无需手动检查</li>
              </ol>
            </div>
          </section>
        )}

        {/* 为什么不怕 AI 犯错 */}
        <section className="ag-section">
          <div className="ag-note">
            <ShieldCheck size={15} className="ag-note-ico" />
            <span>
              AI 不需要完美：每份文档在打开时都会被<b>确定性校验器</b>逐条检查，不合规自动降级为基础编辑，
              内容永远不会被弄坏。
            </span>
          </div>
        </section>

        {/* ==== Agent API 占位（Wendi 原稿，规划中；暂不进真 app）==== */}
        <div className="ag-planned-label">Agent API · 规划中</div>

        {/* API */}
        <section className="ag-section">
          <div className="ag-label">API</div>
          <div className="ag-card">
            <div className="ag-row">
              <div className="ag-row-main">
                <div className="ag-row-key">接入地址</div>
                <code className="ag-mono">{API_BASE}</code>
              </div>
              <button className="ag-copy" onClick={() => copy(API_BASE)}>
                <Copy size={13} />
                复制
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
                复制
              </button>
            </div>
            <div className="ag-divider" />
            <div className="ag-code-wrap">
              <div className="ag-row-key ag-code-label">示例：创建并发布一篇文档</div>
              <pre className="ag-code">{CURL}</pre>
            </div>
          </div>
        </section>

        {/* 权限 */}
        <section className="ag-section">
          <div className="ag-label">权限</div>
          <div className="ag-card">
            <PermRow
              label="创建文档"
              hint="允许 Agent 在你的仓库中新建文档"
              on={perms.create}
              onToggle={() => setPerms((p) => ({ ...p, create: !p.create }))}
            />
            <div className="ag-divider" />
            <PermRow
              label="读取文档"
              hint="允许 Agent 读取已发布的文档内容"
              on={perms.read}
              onToggle={() => setPerms((p) => ({ ...p, read: !p.read }))}
            />
            <div className="ag-divider" />
            <PermRow
              label="发布到内网"
              hint="允许 Agent 将文档部署到公司内网"
              on={perms.publishInternal}
              onToggle={() =>
                setPerms((p) => ({ ...p, publishInternal: !p.publishInternal }))
              }
            />
          </div>
        </section>

        {/* 活动 */}
        <section className="ag-section">
          <div className="ag-label">活动</div>
          <button className="ag-sim" onClick={simulate}>
            模拟一次 Agent 调用
          </button>
          <div className="ag-events">
            {agentEvents.length === 0 ? (
              <div className="ag-empty">还没有 Agent 调用记录。</div>
            ) : (
              agentEvents.map((e) => (
                <div key={e.id} className="ag-event">
                  <span className="ag-chip" style={{ background: e.agentColor }}>
                    AI
                  </span>
                  <span className="ag-event-name">{e.agentName}</span>
                  <span className="ag-event-verb">{ACTION_VERB[e.action]}</span>
                  <span className="ag-event-doc">《{e.docTitle}》</span>
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
