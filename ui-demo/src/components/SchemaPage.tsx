import './SchemaPage.css'

// Schema 可视化页（按 Colin 回炉要求）：不再列规则表 / 不做实时校验。
// 改成「真实渲染的示例 Wordspace 文档 + 侧边讲解」——左边是一份符合 Schema #1 的文档，用跟真编辑器
// 同一套块样式（.ws-doc / .ws-h* / .ws-callout / .ws-todo …）渲染出来，看起来就是真打开的样子；
// 文档里关键处打了 ①②③ 标号，右边侧栏对应每个标号讲「schema 在这儿做了什么限制、样式体现在哪」。
// 给 Wendi 一眼看懂：我们这套受限 HTML 长什么样、限制在哪。

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

const FORBIDDEN = [
  '脚本 / on* 事件（不跑文档 JS）',
  '绝对定位（一切留在文档流）',
  '块上的内联 style',
  '合并单元格',
  'H5 / H6 标题',
  'iframe / object 等活嵌入',
]

function Mark({ n }: { n: number }) {
  return <span className="spx-mark">{n}</span>
}

export default function SchemaPage() {
  return (
    <div className="spx">
      <div className="spx-head">
        <div className="spx-eyebrow">Wordspace Schema #1</div>
        <h1 className="spx-title">我们的 .html 长这样</h1>
        <p className="spx-lede">
          Schema = 一套受限 HTML。编辑器只产出这套结构、对它闭合，所以不出结构 bug。下面是一份符合 Schema
          的文档真实渲染的样子——标了号的地方，右边讲它做了哪些限制、样式体现在哪。
        </p>
      </div>

      <div className="spx-cols">
        {/* 左：真实渲染的示例文档 */}
        <div className="spx-paper">
          <div className="ws-doc spx-doc">
            <h1 className="ws-h ws-h1">
              产品周报 · 第 24 周
              <Mark n={1} />
            </h1>
            <p className="ws-p">
              本周把<b>编辑器内核</b>切到了 <code>schema-first</code> 架构，<i>结构 bug 明显减少</i>。详情见{' '}
              <a href="#">技术评审记录</a>，重点结论已<mark>高亮</mark>。
              <Mark n={2} />
            </p>

            <h2 className="ws-h ws-h2">本周进展</h2>
            <ul className="ws-ul">
              <li>编辑器对 Schema #1 闭合：合法进 → 合法出</li>
              <li>非合规文件降级为基础编辑</li>
              <li>导出 PDF 版式对齐</li>
            </ul>
            <Mark n={3} />

            <h3 className="ws-h ws-h3">下周待办</h3>
            <ul className="ws-ul ws-todo">
              <li data-checked="true">冻结 Schema #1 块集合</li>
              <li data-checked="true">校验器接入打开流程</li>
              <li data-checked="false">Toggle / 表格块落地</li>
              <li data-checked="false">富粘贴净化</li>
            </ul>
            <Mark n={4} />

            <div className="ws-callout">
              提示：Schema 只管「能放什么结构、怎么编辑」，不管「好不好看」——好看是 Template 的事。
              <Mark n={5} />
            </div>

            <blockquote className="ws-quote">
              「受限不是少了自由，而是换来了永不崩坏的结构。」
              <Mark n={6} />
            </blockquote>

            <h2 className="ws-h ws-h2">区域数据</h2>
            <table className="spx-table">
              <thead>
                <tr>
                  <th>区域</th>
                  <th>本周营收</th>
                  <th>环比</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>华东</td>
                  <td>¥1.5M</td>
                  <td>+25%</td>
                </tr>
                <tr>
                  <td>华南</td>
                  <td>¥1.1M</td>
                  <td>+9%</td>
                </tr>
              </tbody>
            </table>
            <Mark n={7} />

            <hr className="ws-hr" />

            <pre className="spx-code">
              <code>{`function isLeafTextBlock(el) {
  return BLOCK_TAGS.every(t => !el.querySelector(t))
}`}</code>
            </pre>
            <Mark n={8} />
          </div>
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

          <div className="spx-forbid">
            <div className="spx-forbid-title">这些不允许（所以野 HTML 会被判不符合）</div>
            <ul>
              {FORBIDDEN.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  )
}
