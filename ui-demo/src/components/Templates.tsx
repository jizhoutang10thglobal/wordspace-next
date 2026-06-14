import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useStore } from '../mock/store'
import { Pill } from '../ui/primitives'
import type { DocKind, Template } from '../types'
import './Templates.css'

type Pool = 'private' | 'public'

const POOLS: { id: Pool; label: string }[] = [
  { id: 'private', label: '公司模板' },
  { id: 'public', label: '公开池' },
]

const KIND_LABEL: Record<DocKind, string> = {
  doc: '文档',
  page: '网页',
  slides: '演示',
}

function TemplateCard({ tpl }: { tpl: Template }) {
  const createFromTemplate = useStore((s) => s.createFromTemplate)
  return (
    <div className="tpl-card">
      <div
        className="tpl-preview"
        style={{ '--tpl-accent': tpl.accent } as CSSProperties}
      >
        <span className="tpl-preview-strip" />
        <span className="tpl-kind">
          <span className="tpl-kind-dot" />
          {KIND_LABEL[tpl.kind]}
        </span>
      </div>
      <div className="tpl-body">
        <div className="tpl-name">{tpl.name}</div>
        <div className="tpl-chip">
          <Pill>{tpl.category}</Pill>
        </div>
        <p className="tpl-desc">{tpl.description}</p>
        <button
          className="tpl-use"
          onClick={() => createFromTemplate(tpl.id, 'f-drafts')}
        >
          用此模板新建
        </button>
      </div>
    </div>
  )
}

export default function Templates() {
  const templates = useStore((s) => s.templates)
  const [pool, setPool] = useState<Pool>('private')

  const shown = useMemo(
    () => templates.filter((t) => t.pool === pool),
    [templates, pool],
  )

  return (
    <div className="tpl-scroll">
      <div className="tpl-page">
        <header className="tpl-head">
          <div className="tpl-head-text">
            <h1 className="tpl-title">模板</h1>
            <p className="tpl-subtitle">调用模板,快速生成带公司样式的文档</p>
          </div>
          <div className="tpl-seg" role="tablist">
            {POOLS.map((p) => (
              <button
                key={p.id}
                role="tab"
                aria-selected={pool === p.id}
                className={`tpl-seg-btn${pool === p.id ? ' is-active' : ''}`}
                onClick={() => setPool(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </header>

        {shown.length === 0 ? (
          <div className="tpl-empty">这个分类下还没有模板。</div>
        ) : (
          <div className="tpl-grid">
            {shown.map((t) => (
              <TemplateCard key={t.id} tpl={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
