import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, Check, ClipboardList, TerminalSquare, ShieldCheck, ChevronDown } from 'lucide-react'
import { useStore } from '../mock/store'
// AI 创作指南（= docs/schema-1-ai-authoring.md 的分发拷贝，test/skill-guide-sync.test.js 锁一致）
import SCHEMA_PROMPT from '../lib/schema-prompt.md?raw'
import './Agents.css'

// 官方技能仓库（GitHub org `wordspace-ai`，与品牌绑定；见 docs/design/2026-07-02-ai-prompt-skill-distribution.md）
const SKILL_CMD = 'npx skills add wordspace-ai/skills'

// AI 接入：把「让 AI 按 Schema 写 Wordspace 文档」交到用户手里的两条路（Tab 切换）。
// 复制 Prompt——零安装，任何对话式 AI 都能用；安装 Skill——装一次，coding agent 长期自动遵守 Schema。
// 产出不靠 AI 自觉：文件在 Wordspace 打开即过确定性校验器，不合规自动降级兜底。
export default function Agents() {
  const toast = useStore((s) => s.toast)
  const [tab, setTab] = useState<'prompt' | 'skill'>('prompt')
  const [copied, setCopied] = useState<'prompt' | 'cmd' | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  const copy = (text: string, which: 'prompt' | 'cmd', msg: string) => {
    void navigator.clipboard?.writeText(text)
    setCopied(which)
    toast(msg, 'success')
    window.setTimeout(() => setCopied((c) => (c === which ? null : c)), 1800)
  }

  return (
    <div className="ag-scroll">
      <div className="ag-page">
        <header className="ag-head">
          <h1 className="ag-title">AI 接入</h1>
          <p className="ag-intro">
            让任何 AI 按 Wordspace Schema 生成、编辑文档。两种接入方式，产出的 .html
            在 Wordspace 打开时都会经过确定性校验器把关——不合规会自动降级，AI 犯错也弄不坏你的文档。
          </p>
        </header>

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
                  onClick={() => copy(SCHEMA_PROMPT, 'prompt', '已复制 Prompt，粘给你的 AI 即可')}
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
                  onClick={() => copy(SKILL_CMD, 'cmd', '已复制安装命令')}
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
              内容永远不会被弄坏。想了解规则本身，见 <Link to="/schema">Schema 页</Link>。
            </span>
          </div>
        </section>
      </div>
    </div>
  )
}
