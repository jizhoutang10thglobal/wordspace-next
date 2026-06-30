import { useMemo, useState } from 'react'
import { ShieldCheck, ShieldX, Ban, Sparkles } from 'lucide-react'
import { checkSchema } from '../lib/schemaCheck'
import './SchemaPage.css'

// Schema #1 可视化页：把 docs/schema-1-draft-v0.md 的定义/限制可视化（块表 §2 / 行内 §3 /
// 6 决策 §0 / 不变式 + 禁止项），外加一个实时校验 widget——复用同一个确定性校验器 checkSchema
// （跟非合规基础编辑演示同源，体现「校验器=脊梁」）。内容是给 Wendi/Colin 看的静态速查 + 可玩 demo。

type Status = 'ok' | 'wip' | 'planned'
const STATUS_META: Record<Status, { label: string; cls: string }> = {
  ok: { label: '可用', cls: 'st-ok' },
  wip: { label: '完善中', cls: 'st-wip' },
  planned: { label: '规划中', cls: 'st-planned' },
}

interface BlockRow {
  name: string
  html: string
  children: string
  inline: string
  nesting: string
  status: Status
}

const BLOCKS: BlockRow[] = [
  { name: '正文', html: '<p>', children: '文字 + 行内标记', inline: '全部', nesting: '顶层块，不互嵌', status: 'ok' },
  { name: '标题 1–3', html: '<h1> <h2> <h3>', children: '文字 + 行内标记', inline: '全部', nesting: '顶层块', status: 'ok' },
  { name: '标题 4', html: '<h4>', children: '文字 + 行内标记', inline: '全部', nesting: '顶层块（封顶 h4）', status: 'wip' },
  { name: '无序列表', html: '<ul><li>', children: 'li = 文字 + 可选子列表', inline: '全部', nesting: '可嵌同构子列表', status: 'ok' },
  { name: '有序列表', html: '<ol><li>', children: 'li = 文字 + 可选子列表', inline: '全部', nesting: '可嵌子列表（可选 start）', status: 'ok' },
  { name: '待办', html: '<ul class="ws-todo"><li data-checked>', children: 'li = 文字', inline: '全部', nesting: '子列表抄 ws-todo', status: 'ok' },
  { name: '引用', html: '<blockquote>', children: '多段文字（多个 <p>）', inline: '全部', nesting: '顶层块，内不嵌块', status: 'ok' },
  { name: '提示框', html: '<div class="ws-callout">', children: '多段文字', inline: '全部', nesting: '顶层块，内不嵌块', status: 'wip' },
  { name: '分隔线', html: '<hr>', children: '无', inline: '无', nesting: '顶层块', status: 'ok' },
  { name: '折叠', html: '<details><summary>', children: 'summary + flow', inline: 'summary 内全部', nesting: 'body 可嵌块', status: 'planned' },
  { name: '表格', html: '<table class="ws-table">', children: 'cell = 纯文字', inline: 'cell 内全部', nesting: '禁合并格 · 不嵌块', status: 'planned' },
  { name: '图片', html: '<img>（<figure>+<figcaption>）', children: '—', inline: '—', nesting: '原子叶子块', status: 'planned' },
  { name: '代码', html: '<pre><code>', children: '纯文本', inline: '—', nesting: '顶层块', status: 'planned' },
]

interface InlineRow {
  name: string
  tag: string
}
const INLINES: InlineRow[] = [
  { name: '加粗', tag: '<b>' },
  { name: '斜体', tag: '<i>' },
  { name: '下划线', tag: '<u>' },
  { name: '删除线', tag: '<s>' },
  { name: '行内代码', tag: '<code>' },
  { name: '链接', tag: '<a href>' },
  { name: '文字色', tag: 'class ws-color-*' },
  { name: '高亮', tag: '<mark>' },
  { name: '软换行', tag: '<br>' },
]

interface Decision {
  n: number
  title: string
  body: string
}
const DECISIONS: Decision[] = [
  { n: 1, title: '颜色 / 高亮', body: '固定调色板（≈Notion 十来色）= 编辑器能用的色，走 class + 入盘 CSS；高亮用 <mark>。文件本有的颜色照常原生显示。' },
  { n: 2, title: '样式 / 保真', body: '编辑器不主动套装饰；存盘 = 干净内容 + 让块渲染正确的最小语义 CSS（+ 用户选的 Template）。' },
  { n: 3, title: 'Toggle 持久态', body: '<details open> 的展开 / 收起状态入盘、跨会话记住，零文档 JS。' },
  { n: 4, title: '容器内部模型', body: 'callout / quote 内 = 多段文字（不嵌列表 / 别的块）；表格单元格 = 纯文字 + 行内标记。' },
  { n: 5, title: 'Heading 封顶 h4', body: 'h5 / h6 = 不符合 Schema → 走基础编辑，不静默压成 h4。' },
  { n: 6, title: 'Table 禁合并格', body: '不允许 colspan / rowspan，像 Notion 保持矩形表。' },
]

const FORBIDDEN = [
  '不跑文档 JS：无 <script> / on* 事件 / iframe 等活嵌入',
  '绝不绝对定位：所有块留在文档流、能 reflow、可发布',
  '块上不写 style：颜色等走固定 class，不写内联样式',
  '表格无合并格（colspan / rowspan）',
  'Heading 封顶 h4（h5 / h6 不符合）',
  'ul / ol 的直接子只能是 <li>',
  'body 扁平挂块：无多层布局容器嵌套',
  '干净存盘：不夹带编辑器交互标记',
]

const SAMPLE_CONFORM = `<h2>季度复盘</h2>
<p>切到 <code>iframe</code> 直载，<a href="https://x.com">见调研</a>。</p>
<ul class="ws-todo"><li data-checked="true">写草案</li><li data-checked="false">评审</li></ul>
<blockquote>引用，可带<b>加粗</b>。</blockquote>`

const SAMPLE_BAD = `<div style="position:absolute;top:0">
  <h5>小标题</h5>
  <table><tr><td colspan="2">合并格</td></tr></table>
  <script>alert(1)</script>
</div>`

export default function SchemaPage() {
  const [src, setSrc] = useState(SAMPLE_CONFORM)
  const result = useMemo(() => checkSchema(src), [src])

  return (
    <div className="sp">
      <div className="sp-inner">
        <header className="sp-head">
          <div className="sp-eyebrow">Wordspace Schema #1 · 草案 v0</div>
          <h1 className="sp-title">受限 HTML，编辑器对它闭合</h1>
          <p className="sp-lede">
            Schema = 一套受限 HTML（reduced HTML）+ 编辑方式 + 结构规则。编辑器与它 co-design、对它「操作闭合」——
            任何编辑动作把合法文档变成合法文档，从构造上消灭结构 bug。装饰好不好看归 Template，显示永远按 .html 原生。
          </p>
        </header>

        {/* 块表 */}
        <section className="sp-sec">
          <h2 className="sp-h2">块（Blocks）</h2>
          <p className="sp-sub">每个块的 canonical reduced-HTML 表示与约束。状态：可用 / 完善中 / 规划中。</p>
          <div className="sp-blocks">
            {BLOCKS.map((b) => (
              <div className="sp-bcard" key={b.name}>
                <div className="sp-bcard-top">
                  <span className="sp-bname">{b.name}</span>
                  <span className={`sp-badge ${STATUS_META[b.status].cls}`}>{STATUS_META[b.status].label}</span>
                </div>
                <code className="sp-bhtml">{b.html}</code>
                <dl className="sp-bmeta">
                  <div><dt>子内容</dt><dd>{b.children}</dd></div>
                  <div><dt>行内</dt><dd>{b.inline}</dd></div>
                  <div><dt>嵌套</dt><dd>{b.nesting}</dd></div>
                </dl>
              </div>
            ))}
          </div>
        </section>

        {/* 行内标记 */}
        <section className="sp-sec">
          <h2 className="sp-h2">行内标记（Inline）</h2>
          <div className="sp-chips">
            {INLINES.map((i) => (
              <span className="sp-chip" key={i.name}>
                {i.name}
                <code>{i.tag}</code>
              </span>
            ))}
          </div>
          <p className="sp-note">硬约束：&lt;a&gt; 不嵌 &lt;a&gt;；行内里不放块级；&lt;code&gt; 内只放文本。链接经 safeHref 过滤（禁 javascript:/data:）。</p>
        </section>

        {/* 6 决策 */}
        <section className="sp-sec">
          <h2 className="sp-h2">六个冻结决策（§0 · Colin 拍板）</h2>
          <div className="sp-dec">
            {DECISIONS.map((d) => (
              <div className="sp-deccard" key={d.n}>
                <div className="sp-decn">{d.n}</div>
                <div>
                  <div className="sp-dectitle">{d.title}</div>
                  <div className="sp-decbody">{d.body}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 禁止项 */}
        <section className="sp-sec">
          <h2 className="sp-h2">物理约束 / 禁止项</h2>
          <ul className="sp-forbid">
            {FORBIDDEN.map((f) => (
              <li key={f}>
                <Ban size={14} />
                {f}
              </li>
            ))}
          </ul>
        </section>

        {/* 实时校验 widget */}
        <section className="sp-sec">
          <h2 className="sp-h2">
            <Sparkles size={17} className="sp-h2-ico" />
            实时校验
          </h2>
          <p className="sp-sub">
            粘一段 HTML，确定性校验器即时判定是否符合 Schema #1——这正是「文件进来即校验、不合规走基础编辑」用的同一个校验器。
          </p>
          <div className="sp-try">
            <div className="sp-try-left">
              <textarea
                className="sp-textarea"
                value={src}
                onChange={(e) => setSrc(e.target.value)}
                spellCheck={false}
                placeholder="<p>粘 HTML 试试…</p>"
              />
              <div className="sp-presets">
                <button onClick={() => setSrc(SAMPLE_CONFORM)}>载入合规样例</button>
                <button onClick={() => setSrc(SAMPLE_BAD)}>载入违规样例</button>
              </div>
            </div>
            <div className="sp-try-right">
              <div className={`sp-verdict ${result.conform ? 'is-ok' : 'is-bad'}`}>
                {result.conform ? <ShieldCheck size={18} /> : <ShieldX size={18} />}
                {result.conform ? '符合 Schema #1' : `不符合 · ${result.violations.filter((v) => v.severity === 'block').length} 处阻断`}
              </div>
              {result.violations.length === 0 ? (
                <div className="sp-clean">没有发现违规。</div>
              ) : (
                <ul className="sp-vlist">
                  {result.violations.map((v) => (
                    <li key={v.rule} className={`sp-vrow sev-${v.severity}`}>
                      <span className="sp-vdot" />
                      <div>
                        <div className="sp-vtitle">
                          {v.title}
                          {v.count > 1 && <span className="sp-vcount">×{v.count}</span>}
                        </div>
                        <div className="sp-vdetail">{v.detail}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
