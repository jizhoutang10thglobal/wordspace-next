import { useState } from 'react'
import { Copy } from 'lucide-react'
import { useStore } from '../mock/store'
import { relTime } from '../lib/format'
import type { AgentEvent } from '../types'
import './Agents.css'

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

export default function Agents() {
  const toast = useStore((s) => s.toast)
  const agentEvents = useStore((s) => s.agentEvents)
  const addAgentEvent = useStore((s) => s.addAgentEvent)

  const [perms, setPerms] = useState({
    create: true,
    read: true,
    publishInternal: false,
  })

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text)
    toast('已复制', 'success')
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

  return (
    <div className="ag-scroll">
      <div className="ag-page">
        <header className="ag-head">
          <h1 className="ag-title">Agent 接入</h1>
          <p className="ag-intro">
            Agent 既能调用 Wordspace 生成文档,也能读取已发布的文档。人和 Agent 用的是同一份内容。
          </p>
        </header>

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
              <div className="ag-row-key ag-code-label">示例:创建并发布一篇文档</div>
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
