import Canvas from './Canvas'
import './SchemaPage.css'

// Schema 可视化页：左边内嵌**真正的块编辑器**（Canvas）在编辑一篇符合 Schema 的示例文档——
// 那套编辑 UX（左侧 ⋮⋮ 拖拽手柄 / 斜杠菜单 / 块菜单 / 转换块 / 选中浮出格式条）本身就≈Schema #1
// 的编辑方式，所以直接复用、不另造。Wendi 可以左边真上手改、右边对照这套 Schema 的要点。
// 文档 = seed 的 d-schema-sample（块模型）；Canvas 以 docId + embedded 内嵌（去掉文档头/页脚）。

interface Note {
  title: string
  body: string
}
const NOTES: Note[] = [
  { title: '标题：只有 H1–H4', body: '四级标题封顶 H4，H5 / H6 不符合。层级靠标签本身表达，逐级变小、加粗，不靠字号手调。' },
  { title: '行内标记：固定一小套', body: '加粗 / 斜体 / 下划线 / 删除线 / 行内代码 / 链接 / 高亮，文字色走固定调色板。选中文字浮出的格式条就这些，没有「随手改字体字号」。' },
  { title: '块：一段段独立', body: '正文 / 标题 / 列表 / 待办 / 引用 / 提示框 / 分隔线……每段是一个块，左侧 ⋮⋮ 可拖动重排，行首打 / 调出块菜单换类型。结构是真的 HTML 标签，不是排版凑的。' },
  { title: '待办勾选框 = 语义样式', body: '点方框能勾／取消——勾没勾是文件里的 data-checked 属性，配 Schema 自带的勾选框样式一起存进文件、随文件走，零脚本。' },
  { title: '提示框 callout', body: '固定的提示框外观（浅底 + 圆角），里面只放文字，不嵌别的块。样式属于 Schema、不是用户随手画的。' },
  { title: '闭合：怎么改都还是合法的', body: '这个编辑器只会产出这套结构——拖动、换类型、加粗、回车分段，每一步出来的还是合法 Schema 文档。所以「编辑不出结构 bug」。' },
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

export default function SchemaPage() {
  return (
    <div className="spx">
      <div className="spx-head">
        <div className="spx-eyebrow">Wordspace Schema #1</div>
        <h1 className="spx-title">我们的 .html 长这样</h1>
        <p className="spx-lede">
          下面是<strong>真正的编辑器</strong>在编辑一篇符合 Schema 的文档——左边直接上手改（拖块、换类型、加粗都行），
          右边是这套受限 HTML 的要点。这套编辑方式本身，就是 Schema #1 允许的全部。
        </p>
      </div>

      <div className="spx-cols">
        {/* 左：内嵌真编辑器（编辑符合 Schema 的示例文档） */}
        <div className="spx-paper">
          <div className="spx-editor">
            <Canvas docId="d-schema-sample" embedded />
          </div>
        </div>

        {/* 右：这套 Schema 的要点 */}
        <aside className="spx-rail">
          {NOTES.map((note, i) => (
            <div className="spx-note" key={note.title}>
              <span className="spx-note-n">{i + 1}</span>
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
