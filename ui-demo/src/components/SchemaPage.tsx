import { useEffect, useRef, useState } from 'react'
import { Bold, Italic, Underline, Strikethrough } from 'lucide-react'
import './SchemaPage.css'

// Schema 可视化页：「真实渲染的示例 Wordspace 文档（可编辑）+ 侧边讲解」。
// 左边一份符合 Schema 的文档，用真编辑器同套块样式渲染、且**可直接编辑**——Wendi 能一边看右边规则
// 一边自己改文字、选中还能加粗（同款浮动气泡）。文档里 ①-⑧ 标号，右边逐条讲限制 + 样式体现在哪；
// 底部 6 条「不允许」用通俗 + use case 解释。
//
// 文档用 DOC_HTML 常量字符串 + dangerouslySetInnerHTML 渲染：这样气泡 state 变化导致 SchemaPage
// 重渲染时，React 不会重置 contentEditable 里用户改过的内容（innerHTML 字符串不变 → 不重写）。
// 标号 <span contenteditable="false"> 受保护、不会被编辑误删。

const MK = (n: number) => `<span class="spx-mark" contenteditable="false">${n}</span>`

const DOC_HTML = `
  <h1 class="ws-h ws-h1">产品周报 · 第 24 周${MK(1)}</h1>
  <p class="ws-p">本周把<b>编辑器内核</b>切到了 <code>schema-first</code> 架构，<i>结构 bug 明显减少</i>。详情见 <a href="#">技术评审记录</a>，重点结论已<mark>高亮</mark>。${MK(2)}</p>

  <h2 class="ws-h ws-h2">本周进展</h2>
  <ul class="ws-ul">
    <li>编辑器对 Schema #1 闭合：合法进 → 合法出</li>
    <li>非合规文件降级为基础编辑</li>
    <li>导出 PDF 版式对齐</li>
  </ul>${MK(3)}

  <h3 class="ws-h ws-h3">下周待办</h3>
  <ul class="ws-ul ws-todo">
    <li data-checked="true">冻结 Schema #1 块集合</li>
    <li data-checked="true">校验器接入打开流程</li>
    <li data-checked="false">Toggle / 表格块落地</li>
    <li data-checked="false">富粘贴净化</li>
  </ul>${MK(4)}

  <div class="ws-callout">提示：Schema 只管「能放什么结构、怎么编辑」，不管「好不好看」——好看是 Template 的事。${MK(5)}</div>

  <blockquote class="ws-quote">「受限不是少了自由，而是换来了永不崩坏的结构。」${MK(6)}</blockquote>

  <h2 class="ws-h ws-h2">区域数据</h2>
  <table class="spx-table"><thead><tr><th>区域</th><th>本周营收</th><th>环比</th></tr></thead>
  <tbody><tr><td>华东</td><td>¥1.5M</td><td>+25%</td></tr><tr><td>华南</td><td>¥1.1M</td><td>+9%</td></tr></tbody></table>${MK(7)}

  <hr class="ws-hr" />

  <pre class="spx-code"><code>function isLeafTextBlock(el) {
  return BLOCK_TAGS.every(t =&gt; !el.querySelector(t))
}</code></pre>${MK(8)}
`

interface Note {
  n: number
  title: string
  body: string
}
const NOTES: Note[] = [
  { n: 1, title: '标题：只有 H1–H4', body: '四级标题封顶 H4，H5 / H6 不符合 Schema。样式上逐级变小、加粗——层级靠标签本身表达，不靠字号手调。' },
  { n: 2, title: '行内标记：固定一小套', body: '加粗 / 斜体 / 下划线 / 删除线 / 行内代码 / 链接 / 高亮，文字色走固定调色板。任意内联 style（随手改字体字号颜色）不允许。' },
  { n: 3, title: '列表：无序 / 有序 / 待办', body: '三种列表，可缩进出子列表。结构是真的 <ul>/<ol><li>，不是排版凑出来的。' },
  { n: 4, title: '待办勾选框 = 语义样式', body: '勾没勾是文件里的 data-checked 属性，配 Schema 自带的勾选框 CSS 一起存进文件、随文件走。零脚本，换任何浏览器双击打开都是这个样子。' },
  { n: 5, title: '提示框 callout', body: '固定的提示框外观（浅底 + 圆角边框），里面只放文字，不嵌别的块。样式属于 Schema、不是用户随手画的。' },
  { n: 6, title: '引用 quote', body: '左侧一条竖线的引用块，承载多段文字。' },
  { n: 7, title: '表格：矩形、不能合并', body: '每行格子数一样、禁止合并单元格（no colspan / rowspan），单元格里只放文字。复杂的合并表 / 单元格塞图塞块 → 不符合。' },
  { n: 8, title: '代码块', body: '等宽字体的 <pre><code>，原样保留缩进与符号。' },
]

interface Dont {
  title: string
  body: string
}
const DONTS: Dont[] = [
  {
    title: '脚本 / on* 事件',
    body: '网页里会自己跑的 JavaScript（<script>、按钮 onclick）。比如「点一下弹窗、自动轮播」。文档是给人读的内容，不该藏会自己跑的程序——也更安全，换任何浏览器打开行为都一致。',
  },
  {
    title: '绝对定位',
    body: '用 position:absolute 把元素钉死在固定坐标。比如「把图压在右上角某个像素点」。这样换个屏幕 / 字号就错位、也没法干净导出 PDF。Schema 要求一切顺着文档流自然排。',
  },
  {
    title: '块上的内联 style',
    body: '直接在标题 / 段落上写 style="color:red;font-size:30px"。比如「随手把这段调大调红」。这样每份文档样式各写各的、没法统一管；颜色改走固定调色板。',
  },
  {
    title: '合并单元格',
    body: '表格用 colspan / rowspan 把几个格子并成一个。比如「表头跨两列」。合并表结构乱、容易错位也难编辑——只要规整矩形表（像 Notion）。',
  },
  {
    title: 'H5 / H6 标题',
    body: '第五、六级小标题。正常文档极少用到这么深，留 H1–H4 四级够用，也逼着结构别套太深。',
  },
  {
    title: 'iframe / object 等活嵌入',
    body: '把别的网页 / 视频 / 地图整个嵌进来。比如「插个在线地图、嵌段 YouTube」。这些是靠网络和脚本的外部活内容，不是你这份文件自己的东西，本地单文件也带不走。',
  },
]

interface Bubble {
  top: number
  left: number
}
const TOOLS: { cmd: string; icon: typeof Bold; label: string }[] = [
  { cmd: 'bold', icon: Bold, label: '加粗' },
  { cmd: 'italic', icon: Italic, label: '斜体' },
  { cmd: 'underline', icon: Underline, label: '下划线' },
  { cmd: 'strikeThrough', icon: Strikethrough, label: '删除线' },
]

export default function SchemaPage() {
  const paperRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<HTMLDivElement>(null)
  const [bubble, setBubble] = useState<Bubble | null>(null)

  // 选中文档里的文字 → 浮出格式气泡（跟非合规编辑器 / 真编辑器同款）。
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection()
      const paper = paperRef.current
      const doc = docRef.current
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !paper || !doc) {
        setBubble(null)
        return
      }
      const range = sel.getRangeAt(0)
      if (!doc.contains(range.commonAncestorContainer)) {
        setBubble(null)
        return
      }
      const r = range.getBoundingClientRect()
      if (!r || (r.width === 0 && r.height === 0)) {
        setBubble(null)
        return
      }
      const pr = paper.getBoundingClientRect()
      setBubble({ top: Math.max(6, r.top - pr.top - 42), left: r.left - pr.left + r.width / 2 })
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])

  const exec = (cmd: string) => {
    try {
      document.execCommand(cmd, false)
    } catch {
      /* execCommand 已废弃但浏览器仍支持 */
    }
  }

  return (
    <div className="spx">
      <div className="spx-head">
        <div className="spx-eyebrow">Wordspace Schema #1</div>
        <h1 className="spx-title">我们的 .html 长这样</h1>
        <p className="spx-lede">
          Schema = 一套受限 HTML。编辑器只产出这套结构、对它闭合，所以不出结构 bug。下面这份示例文档可以
          <strong>直接编辑</strong>——改文字、选中加粗都行，一边对照右边的规则一边自己试。
        </p>
      </div>

      <div className="spx-cols">
        {/* 左：真实渲染 + 可编辑的示例文档 */}
        <div className="spx-paper" ref={paperRef}>
          <div
            className="ws-doc spx-doc"
            ref={docRef}
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            dangerouslySetInnerHTML={{ __html: DOC_HTML }}
          />
          {bubble && (
            <div
              className="ws-fmtbar spx-bubble"
              style={{ top: bubble.top, left: bubble.left }}
              onMouseDown={(e) => e.preventDefault()}
              role="toolbar"
            >
              {TOOLS.map((t) => (
                <button
                  key={t.cmd}
                  className="ws-fmtbar-btn"
                  title={t.label}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => exec(t.cmd)}
                >
                  <t.icon size={15} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 右：侧边讲解 */}
        <aside className="spx-rail">
          {NOTES.map((note) => (
            <div className="spx-note" key={note.n}>
              <span className="spx-note-n">{note.n}</span>
              <div>
                <div className="spx-note-title">{note.title}</div>
                <div className="spx-note-body">{note.body}</div>
              </div>
            </div>
          ))}
        </aside>
      </div>

      {/* 底部：这些写法不允许（通俗 + use case） */}
      <div className="spx-dont-wrap">
        <h2 className="spx-dont-h">这些写法不允许</h2>
        <p className="spx-dont-sub">野生 HTML 里常见、但超出受限范式的东西——含这些就会被判不符合，走基础编辑。</p>
        <div className="spx-dont-grid">
          {DONTS.map((d) => (
            <div className="spx-dont-card" key={d.title}>
              <div className="spx-dont-title">{d.title}</div>
              <div className="spx-dont-body">{d.body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
