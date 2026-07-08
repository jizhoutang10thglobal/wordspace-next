import type {
  AgentEvent,
  Doc,
  FileEntry,
  Folder,
  Member,
  MountRoot,
  Template,
  Workspace,
} from '../types'
import { NON_CONFORM_SAMPLES } from '../lib/nonConformSamples'
import { mdToBlocks } from '../lib/markdown'

// 示例 Markdown 文件（Feature: markdown 文件阅读编辑器）。后端是 .md，前端用同一个块编辑器渲染。
// 覆盖「干净映射」（标题/列表/引用/粗斜删码链）+「HTML 岛」（高亮/文字色/下划线/callout）。
const SAMPLE_MD = `# 用 Markdown 写文档

这份文件的**后端是 Markdown**——但你看到的编辑器、样式、交互，和普通 HTML 文档*完全一样*。因为真正的内核是「块模型」，Markdown 和 HTML 只是它的两种序列化。

## 干净映射的部分

Notion 式的块和 Markdown 本来同源，绝大多数结构一一对应：

- 标题、正文、列表、引用、分隔线
- 行内的 **粗体**、*斜体*、~~删除线~~、\`行内代码\`、[链接](https://wordspace.ai)
- 表格（两边都禁合并单元格，正好对齐）

编号列表也照样：

1. 打开一个 \`.md\` 文件
2. 它被解析成块模型
3. 用同一个编辑器渲染 + 编辑

待办列表：

- [x] 块模型 ↔ Markdown 双向转换
- [x] HTML 岛保真表现层
- [ ] 接进真实 app（下一步）

> Markdown 只做语义结构，主动砍掉表现样式——这正是它的哲学。

---

## Markdown 接不了的部分（HTML 岛）

文字色、高亮、下划线、callout：Markdown 没有原生语法。按方案 b，这些退化成内嵌的一小段 HTML，仍是合法 .md、round-trip 全保真。

比如这里有 <mark>高亮</mark>、<span style="color:#b3261e">红色文字</span>、还有 <u>下划线</u>。

<div class="ws-callout">这是一个 callout 块。Markdown 没有它，所以存成 HTML 岛，来回转换还是 callout。</div>
`

const now = Date.now()
const MIN = 60_000
const HR = 60 * MIN

// ---------------------------------------------------------------------------
// people (and a couple of agents, which are first-class members)
// ---------------------------------------------------------------------------
export const ME_ID = 'm-wendi'

export const seedMembers: Member[] = [
  { id: 'm-wendi', name: 'Wendi', initials: 'WD', color: '#1a73e8', email: 'wendi@tenthglobal.com', kind: 'human' },
  { id: 'm-lin', name: '林越', initials: '林', color: '#1e8e3e', email: 'lin@tenthglobal.com', kind: 'human' },
  { id: 'm-zhao', name: '赵敏', initials: '赵', color: '#b8541d', email: 'zhao@tenthglobal.com', kind: 'human' },
  { id: 'm-chen', name: '陈航', initials: '陈', color: '#8a3ffc', email: 'chen@tenthglobal.com', kind: 'human' },
  { id: 'a-market', name: '市场 Agent', initials: 'AI', color: '#0b8793', email: 'market-agent', kind: 'agent' },
  { id: 'a-ops', name: '运营 Agent', initials: 'AI', color: '#5a5f66', email: 'ops-agent', kind: 'agent' },
]

// ---------------------------------------------------------------------------
// folders: team space + personal drafts
// ---------------------------------------------------------------------------
// All seeded folders belong to the Tenth Global cloud space; other cloud spaces
// start with their own (separate) folders.
// 云盘（团队共享 / 我的私有）是「之后上云」的内容，当前 demo 不含——空数组。
// 保留 folders 字段与 Folder 类型，云盘回归时只需重新填充这里 + 恢复侧栏云盘小区。
export const seedFolders: Folder[] = []

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------
export const seedDocs: Doc[] = [
  {
    // Markdown 后端文档（Feature: markdown 文件阅读编辑器）。blocks 由 mdToBlocks 从 .md 解析而来，
    // 渲染进和 html 文档完全一样的块编辑器；format:'markdown' 让「源码」面板显示 blocksToMd 的实时 .md。
    id: 'd-md-guide',
    title: '用 Markdown 写文档',
    emoji: '📝',
    kind: 'doc',
    folderId: 'r-brand', // 连接文件夹里的文档：folderId 记它所属的根（不进云盘小区）
    format: 'markdown',
    visibility: 'private',
    localPath: '~/项目/产品说明.md',
    updatedAt: now - 40 * MIN,
    updatedBy: ME_ID,
    collaborators: [ME_ID],
    blocks: mdToBlocks(SAMPLE_MD),
  },
  {
    id: 'd-handbook',
    title: '员工手册',
    emoji: '📘',
    kind: 'doc',
    folderId: 'r-drive', // 连接文件夹里的文档（云盘概念已移除）
    visibility: 'internal',
    publishedUrl: 'https://team.tenthglobal.com/handbook',
    localPath: '~/Wordspace/团队/人事/员工手册.html',
    updatedAt: now - 3 * HR,
    updatedBy: 'm-lin',
    collaborators: ['m-wendi', 'm-lin', 'm-zhao'],
    deployedAt: now - 3 * HR,
    blocks: [
      { id: 'b1', type: 'heading', level: 1, html: '员工手册' },
      { id: 'b2', type: 'text', html: '欢迎加入 Tenth Global。这份手册说明我们怎么一起工作,以及你应当了解的制度与资源。它和公司里其他文档一样,是一份你能随时打开、归你所有的文件。' },
      { id: 'b3', type: 'heading', level: 2, html: '我们怎么工作' },
      { id: 'b4', type: 'text', html: '我们以结果为准,不以工时论高下。你对自己的时间和节奏有充分自主,前提是把事情交付到位、让协作的人能依赖你。' },
      { id: 'b5', type: 'list', html: '<li>弹性办公,时间地点由你安排</li><li>第一天就接触真实业务</li><li>信息默认公开,文档优先于会议</li>' },
      { id: 'b6', type: 'callout', html: '有疑问先查这份手册,查不到再找你的负责人。手册由人事维护,每季度复核一次。' },
      { id: 'b7', type: 'heading', level: 2, html: '休假与考勤' },
      { id: 'b8', type: 'text', html: '带薪年假每年 15 天,病假据实申请。请提前在团队日历登记,方便其他人安排。' },
      { id: 'b9', type: 'heading', level: 2, html: '设备与报销' },
      { id: 'b10', type: 'text', html: '入职配备办公设备一套。与工作直接相关的支出可凭票报销,月底前提交。' },
    ],
  },
  {
    id: 'd-recruit',
    title: '招聘 · 加入我们',
    emoji: '🧭',
    kind: 'page',
    folderId: 'r-drive', // 连接文件夹里的文档（云盘概念已移除）
    visibility: 'public',
    publishedUrl: 'https://tenthglobal.com/careers',
    localPath: '~/Wordspace/团队/人事/招聘.html',
    updatedAt: now - 26 * HR,
    updatedBy: 'm-wendi',
    collaborators: ['m-wendi', 'm-zhao'],
    deployedAt: now - 26 * HR,
    blocks: [
      {
        id: 'r1',
        type: 'embed',
        designed: true,
        html: `<div style="background:linear-gradient(135deg,#16307a,#2f6fe0 60%,#5b93f2);color:#fff;border-radius:12px;padding:52px 44px;">
          <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;opacity:.85;">Careers · Tenth Global</div>
          <div style="font-size:38px;font-weight:800;letter-spacing:-.01em;margin:14px 0 12px;">我们在招聘</div>
          <div style="font-size:16px;opacity:.92;max-width:440px;line-height:1.6;">在找懂业务、能动手、愿意和公司一起往上走的人。这一页本身就是用 Wordspace 写的,一键发布成了网站。</div>
          <div style="margin-top:24px;"><span style="display:inline-block;background:#fff;color:#16307a;font-weight:700;font-size:14px;padding:11px 22px;border-radius:8px;">投递简历 →</span></div>
        </div>`,
      },
      { id: 'r2', type: 'heading', level: 2, html: '为什么加入' },
      {
        id: 'r3',
        type: 'embed',
        designed: true,
        html: `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;">
          <div style="border:1px solid #e4e6e9;border-radius:10px;padding:18px;"><div style="font-weight:700;font-size:15px;margin-bottom:6px;">真实的项目</div><div style="color:#5a5f66;font-size:13px;line-height:1.6;">第一天就上手真的业务,不做演练。</div></div>
          <div style="border:1px solid #e4e6e9;border-radius:10px;padding:18px;"><div style="font-weight:700;font-size:15px;margin-bottom:6px;">弹性与自主</div><div style="color:#5a5f66;font-size:13px;line-height:1.6;">以结果为准,时间地点你自己定。</div></div>
          <div style="border:1px solid #e4e6e9;border-radius:10px;padding:18px;"><div style="font-weight:700;font-size:15px;margin-bottom:6px;">一起成长</div><div style="color:#5a5f66;font-size:13px;line-height:1.6;">跟着公司一起往上走。</div></div>
        </div>`,
      },
      { id: 'r4', type: 'heading', level: 2, html: '正在招的岗位' },
      { id: 'r5', type: 'list', html: '<li>项目经理(PM)</li><li>项目助理(PA)</li><li>财务运营(FO)</li>' },
    ],
  },
  // Schema 演示页内嵌真编辑器用的「符合 Schema」示例文档（块模型，跑完整块编辑 UX）。
  {
    id: 'd-schema-sample',
    title: '产品周报 · 第 24 周',
    kind: 'doc',
    folderId: 'r-brand',
    visibility: 'private',
    localPath: '~/Projects/品牌升级/产品周报.html',
    updatedAt: now - 2 * HR,
    updatedBy: ME_ID,
    collaborators: [ME_ID],
    blocks: [
      { id: 'ss1', type: 'heading', level: 1, html: '产品周报 · 第 24 周' },
      {
        id: 'ss2',
        type: 'text',
        html: '本周把<b>编辑器内核</b>切到了 <code>schema-first</code> 架构，<i>结构 bug 明显减少</i>。详情见 <a href="#">技术评审记录</a>，重点结论已<mark>高亮</mark>。',
      },
      { id: 'ss3', type: 'heading', level: 2, html: '本周进展' },
      {
        id: 'ss4',
        type: 'list',
        listStyle: 'bulleted',
        html: '<li>编辑器对 Schema #1 闭合：合法进 → 合法出</li><li>非合规文件降级为基础编辑</li><li>导出 PDF 版式对齐</li>',
      },
      { id: 'ss5', type: 'heading', level: 3, html: '下周待办' },
      {
        id: 'ss6',
        type: 'list',
        listStyle: 'todo',
        html: '<li data-checked="true">冻结 Schema #1 块集合</li><li data-checked="true">校验器接入打开流程</li><li data-checked="false">Toggle / 表格块落地</li><li data-checked="false">富粘贴净化</li>',
      },
      {
        id: 'ss7',
        type: 'callout',
        html: '提示：Schema 只管「能放什么结构、怎么编辑」，不管「好不好看」——好看是 Template 的事。',
      },
      { id: 'ss8', type: 'quote', html: '「受限不是少了自由，而是换来了永不崩坏的结构。」' },
      { id: 'ss9', type: 'divider', html: '' },
      { id: 'ss10', type: 'text', html: '试试看：把光标放进任意一段就能改；左侧 ⋮⋮ 拖动重排，行首打 <code>/</code> 调出块菜单，选中文字弹出格式条。' },
    ],
  },
  // 「产品资料」根（多文件夹空间的第二个根）里的两篇本地文档。
  {
    id: 'd-r2-manual',
    title: '产品手册',
    kind: 'doc',
    folderId: 'r-docs',
    visibility: 'private',
    localPath: '~/Documents/产品资料/产品手册.html',
    updatedAt: now - 5 * HR,
    updatedBy: ME_ID,
    collaborators: [ME_ID],
    blocks: [
      { id: 'r2m1', type: 'heading', level: 1, html: '产品手册' },
      { id: 'r2m2', type: 'text', html: '这份文档来自<b>第二个打开的文件夹</b>「产品资料」——左侧栏可以同时打开多个文件夹，每个文件夹是一棵独立的树。' },
      { id: 'r2m3', type: 'list', listStyle: 'bulleted', html: '<li>侧栏底部「＋ 添加文件夹」可以再打开新的文件夹</li><li>拖动根标题可以调整文件夹的上下顺序，顺序会记住</li><li>根标题右键可以把它移除（只是不再显示，磁盘文件不动）</li>' },
    ],
  },
  {
    id: 'd-r2-interview',
    title: '访谈纪要',
    kind: 'doc',
    folderId: 'r-docs',
    visibility: 'private',
    localPath: '~/Documents/产品资料/用户调研/访谈纪要.html',
    updatedAt: now - 26 * HR,
    updatedBy: ME_ID,
    collaborators: [ME_ID],
    blocks: [
      { id: 'r2i1', type: 'heading', level: 1, html: '用户访谈纪要' },
      { id: 'r2i2', type: 'callout', html: '受访者：______ · 日期：2026-00-00 · 记录：______' },
      { id: 'r2i3', type: 'list', listStyle: 'todo', html: '<li data-checked="true">整理录音</li><li data-checked="false">提炼关键引语</li><li data-checked="false">同步给产品组</li>' },
      // 互链演示：反向链接回 产品规划（磁盘形态 = 纯净相对路径 <a>，浏览器裸开也能跳）
      { id: 'r2i4', type: 'text', html: '整理后的需求已并入 <a class="ws-doclink" href="../产品规划.html" contenteditable="false">产品规划</a>，两边同步维护。' },
    ],
  },
  // 互链演示文档：出链（同目录 + 子目录）、断链（指向不存在的文件）都有——@ 打出来的链接就长这样。
  {
    id: 'd-r2-plan',
    title: '产品规划',
    kind: 'doc',
    folderId: 'r-docs',
    visibility: 'private',
    localPath: '~/Documents/产品资料/产品规划.html',
    updatedAt: now - 2 * HR,
    updatedBy: ME_ID,
    collaborators: [ME_ID],
    blocks: [
      { id: 'r2p1', type: 'heading', level: 1, html: '产品规划' },
      { id: 'r2p2', type: 'text', html: '本季度重点来自用户反馈——详见 <a class="ws-doclink" href="用户调研/访谈纪要.html" contenteditable="false">访谈纪要</a>，配套的手册在 <a class="ws-doclink" href="产品手册.html" contenteditable="false">产品手册</a>。' },
      { id: 'r2p3', type: 'text', html: '硬件参数还没定稿：<a class="ws-doclink" href="规格/参数表.html" contenteditable="false">参数表</a>（这条是<b>断链演示</b>——目标不存在，悬停可修复）。' },
      { id: 'r2p4', type: 'text', html: '在任意段落输入 <code>@</code>、<code>[[</code> 或中文输入法的 <code>【【</code>，即可链接到其他文档。' },
    ],
  },
  // 非合规样例（野生 HTML）：blocks 留空、带 rawHtml；打开后由校验器判定不符合 → BasicEditor 基础编辑。
  ...NON_CONFORM_SAMPLES.map(
    (s): Doc => ({
      id: s.id,
      title: s.fileName.replace(/\.html$/, ''),
      kind: 'doc',
      folderId: 'r-brand', // 连接文件夹里的非合规样例，归属「品牌升级」根
      blocks: [],
      rawHtml: s.html,
      visibility: 'private',
      localPath: '~/Projects/品牌升级/' + s.fileName,
      updatedAt: now - 3 * HR,
      updatedBy: ME_ID,
      collaborators: [ME_ID],
    }),
  ),
]

// ---------------------------------------------------------------------------
// templates: private (company) pool + public pool
// ---------------------------------------------------------------------------
// 公司模板（private）= 我们自己写的、对编辑器适配最好的模板。用原生 block 编排
// （heading/text/list/todo/callout/divider），块类型本身承载“功能性样式”——这样
// 拖拽/转换/格式工具栏/斜杠菜单等编辑功能在模板上全程可用、无 bug。
export const seedTemplates: Template[] = [
  // —— 公司文档模板 ——
  {
    id: 't-minutes', name: '会议纪要', kind: 'doc', category: '纪要', pool: 'private',
    description: '主题 / 参会 / 议题 / 决议 / 待办,五段式,开会即用。', accent: '#1a73e8',
    blocks: [
      { id: 'mn1', type: 'heading', level: 1, html: '会议纪要' },
      { id: 'mn2', type: 'callout', html: '主题：______　·　日期：2026-00-00　·　主持：______　·　记录：______' },
      { id: 'mn3', type: 'heading', level: 2, html: '参会人' },
      { id: 'mn4', type: 'list', listStyle: 'bulleted', html: '<li>______</li><li>______</li>' },
      { id: 'mn5', type: 'heading', level: 2, html: '议题与讨论' },
      { id: 'mn6', type: 'list', listStyle: 'numbered', html: '<li><b>议题一</b>：______</li><li><b>议题二</b>：______</li>' },
      { id: 'mn7', type: 'heading', level: 2, html: '决议' },
      { id: 'mn8', type: 'callout', html: '✅ ______' },
      { id: 'mn9', type: 'heading', level: 2, html: '待办事项' },
      { id: 'mn10', type: 'list', listStyle: 'todo', html: '<li>______（负责人 __,截止 00-00）</li><li>______</li>' },
    ],
  },
  {
    id: 't-proposal', name: '项目方案', kind: 'doc', category: '方案', pool: 'private',
    description: '背景 / 目标 / 方案 / 里程碑 / 风险,立项与评审通用。', accent: '#e8710a',
    blocks: [
      { id: 'pr1', type: 'heading', level: 1, html: '项目方案：______' },
      { id: 'pr2', type: 'callout', html: '一句话目标：______' },
      { id: 'pr3', type: 'heading', level: 2, html: '背景' },
      { id: 'pr4', type: 'text', html: '当前 ______ 存在 ______ 问题,需要 ______。' },
      { id: 'pr5', type: 'heading', level: 2, html: '目标' },
      { id: 'pr6', type: 'list', listStyle: 'bulleted', html: '<li>______</li><li>______</li>' },
      { id: 'pr7', type: 'heading', level: 2, html: '方案概述' },
      { id: 'pr8', type: 'text', html: '______' },
      { id: 'pr9', type: 'heading', level: 2, html: '里程碑' },
      { id: 'pr10', type: 'list', listStyle: 'numbered', html: '<li>第一阶段（00-00）：______</li><li>第二阶段（00-00）：______</li>' },
      { id: 'pr11', type: 'heading', level: 2, html: '风险与对策' },
      { id: 'pr12', type: 'callout', html: '⚠ ______' },
    ],
  },
  {
    id: 't-weekly-plan', name: '周计划', kind: 'doc', category: '周计划', pool: 'private',
    description: 'Weekly Plan / 例会节奏 / End of Week Update,团队周节奏标准格式（Wendi）。', accent: '#d4356b',
    blocks: [
      { id: 'wp1', type: 'heading', level: 1, html: 'Weekly Plan　MM/DD – MM/DD' },
      { id: 'wp2', type: 'callout', html: '注：Deliverable 需是明确、可衡量、可验证的「结果」,不是推进的「动作」。' },
      { id: 'wp3', type: 'heading', level: 2, html: 'A. Deliverable' },
      { id: 'wp4', type: 'list', listStyle: 'todo', html: '<li>Deliverable 1</li><li>Deliverable 2</li><li>Deliverable 3</li>' },
      { id: 'wp5', type: 'heading', level: 2, html: 'B. Need Support / Review' },
      { id: 'wp6', type: 'list', listStyle: 'todo', html: '<li>Item 1</li><li>Item 2</li><li>Item 3</li>' },
      { id: 'wp7', type: 'heading', level: 2, html: 'C. Risks / Uncertainties' },
      { id: 'wp8', type: 'list', listStyle: 'bulleted', html: '<li>Item 1</li><li>Item 2</li><li>Item 3</li>' },
      { id: 'wp9', type: 'heading', level: 2, html: 'End of Week Update　MM/DD – MM/DD' },
      { id: 'wp10', type: 'heading', level: 3, html: 'A. Deliverable Update' },
      { id: 'wp11', type: 'list', listStyle: 'bulleted', html: '<li>Deliverable 1 — ______</li><li>Deliverable 2 — ______</li><li>Deliverable 3 — ______</li>' },
      { id: 'wp12', type: 'heading', level: 3, html: 'B. Items to note' },
      { id: 'wp13', type: 'list', listStyle: 'bulleted', html: '<li>______</li><li>______</li>' },
      { id: 'wp14', type: 'heading', level: 2, html: '例会节奏' },
      { id: 'wp15', type: 'text', html: '<b>周一例会（20 分钟）</b>　对进度 → 过 Weekly Plan、对齐 Deliverable 与项目推进、同步支持事项与风险 → 确认本周需讨论内容的时间。产出：Refined Weekly Plan + 讨论日程。' },
      { id: 'wp16', type: 'text', html: '<b>周四例会（20 分钟）</b>　逐条同步进度（预期已完成 80–90%）→ 同步收尾 Deliverable 所需支持与风险。产出：收尾 action plan。' },
      { id: 'wp17', type: 'callout', html: '⏱ 例会严格 20 分钟,只聊推进不聊内容；单议题讨论超 2 分钟另约时间。' },
    ],
  },
  // —— 公开池（联网内容,不归我们维护）——
  { id: 't-blog', name: '博客文章', kind: 'page', category: '网页', pool: 'public', description: '通用图文排版,适合对外发布。', accent: '#0b8793', blocks: [{ id: 'tg1', type: 'heading', level: 1, html: '文章标题' }] },
  { id: 't-readme', name: '产品说明', kind: 'doc', category: '文档', pool: 'public', description: '简洁的产品说明文档结构。', accent: '#5a5f66', blocks: [{ id: 'tr1', type: 'heading', level: 1, html: '产品说明' }] },
]

// ---------------------------------------------------------------------------
// agent activity feed
// ---------------------------------------------------------------------------
export const seedAgentEvents: AgentEvent[] = [
  { id: 'e1', agentName: '市场 Agent', agentColor: '#0b8793', action: 'create', docTitle: '周报 · 第 24 周', at: now - 35 * MIN },
  { id: 'e2', agentName: '市场 Agent', agentColor: '#0b8793', action: 'publish', docTitle: '周报 · 第 24 周', at: now - 34 * MIN },
  { id: 'e3', agentName: '运营 Agent', agentColor: '#5a5f66', action: 'read', docTitle: '员工手册', at: now - 2 * HR },
  { id: 'e4', agentName: '运营 Agent', agentColor: '#5a5f66', action: 'update', docTitle: '产品定价说明', at: now - 6 * HR },
]

// ---------------------------------------------------------------------------
// workspace
// ---------------------------------------------------------------------------
export const seedWorkspace: Workspace = {
  id: 'w-tg',
  name: 'Tenth Global',
  plan: '团队版',
  storagePath: '~/Wordspace',
  deployTarget: 'cloud.tenthglobal.com(自托管)',
  syncedAt: now - 4 * MIN,
}

// ---------------------------------------------------------------------------
// 打开的文件夹（多文件夹：侧栏顶层一列根，全部常显、拖动排序、持久化）
// ---------------------------------------------------------------------------
// 没有「工作区 / Space」外壳——开局就同时打开三个文件夹（两个本地 + 一个 Google Drive），
// 让「多根侧栏」一进 demo 就看得见。数组顺序 = 侧栏显示顺序。
// r-missing 演示「失联根」：底层文件夹不可达（外置盘拔出），灰显、可重新定位 / 移除。
export const seedRoots: MountRoot[] = [
  { id: 'r-brand', name: '品牌升级', path: '~/Projects/品牌升级', origin: 'local' },
  { id: 'r-docs', name: '产品资料', path: '~/Documents/产品资料', origin: 'local' },
  { id: 'r-drive', name: 'Tenth Global', path: 'Google Drive/Tenth Global', origin: 'gdrive' },
  { id: 'r-missing', name: '2024 归档', path: '/Volumes/外置硬盘/2024 归档', origin: 'local', missing: true },
]

// Connected folders show every file, not just Wordspace docs. HTML opens in the
// editor (docId set); the rest hand off to the OS default app.
export const seedFiles: FileEntry[] = [
  // 公司网盘 (Google Drive)
  { rootId: 'r-drive', path: '人事/员工手册.html', kind: 'html', docId: 'd-handbook' },
  { rootId: 'r-drive', path: '人事/入职流程.docx', kind: 'word' },
  { rootId: 'r-drive', path: '战略/2026 战略规划.docx', kind: 'word' },
  { rootId: 'r-drive', path: '战略/市场分析.pdf', kind: 'pdf' },
  { rootId: 'r-drive', path: '品牌/官网首页.html', kind: 'html', docId: 'd-recruit' },
  { rootId: 'r-drive', path: '品牌/Logo.png', kind: 'image' },
  { rootId: 'r-drive', path: '财务/Q2 预算.xlsx', kind: 'sheet' },
  { rootId: 'r-drive', path: '产品/发布会.pptx', kind: 'slides' },
  // 品牌升级
  { rootId: 'r-brand', path: '提案.docx', kind: 'word' },
  { rootId: 'r-brand', path: '产品说明.md', kind: 'md', docId: 'd-md-guide' },
  { rootId: 'r-brand', path: '落地页.html', kind: 'html', docId: 'd-recruit' },
  { rootId: 'r-brand', path: '素材/封面.png', kind: 'image' },
  { rootId: 'r-brand', path: '数据/转化分析.xlsx', kind: 'sheet' },
  { rootId: 'r-brand', path: '说明.html', kind: 'html', docId: 'd-handbook' },
  // 非合规样例（野生 HTML）：HTML 文件 + docId 指向带 rawHtml 的样例文档 → 打开走 BasicEditor 降级编辑
  { rootId: 'r-brand', path: '外部导入/新品落地页.html', kind: 'html', docId: 'd-nc-landing' },
  { rootId: 'r-brand', path: '外部导入/季度数据表.html', kind: 'html', docId: 'd-nc-table' },
  { rootId: 'r-brand', path: '外部导入/活动报名页.html', kind: 'html', docId: 'd-nc-signup' },
  { rootId: 'r-brand', path: '外部导入/产品页.html', kind: 'html', docId: 'd-nc-interactive' },
  // 产品资料——注意「素材/」在两个根里都有：多根身份 (rootId, path) 保证互不相撞
  { rootId: 'r-docs', path: '产品手册.html', kind: 'html', docId: 'd-r2-manual' },
  { rootId: 'r-docs', path: '产品规划.html', kind: 'html', docId: 'd-r2-plan' },
  { rootId: 'r-docs', path: '用户调研/访谈纪要.html', kind: 'html', docId: 'd-r2-interview' },
  { rootId: 'r-docs', path: '用户调研/问卷数据.xlsx', kind: 'sheet' },
  { rootId: 'r-docs', path: '路线图.pdf', kind: 'pdf' },
  { rootId: 'r-docs', path: '素材/产品截图.png', kind: 'image' },
  // 深层嵌套样例：演示 compact folders（单子文件夹长链「归档/…/复盘」压成一行）+ 缩进导引线。
  // 「复盘」下分华东/华南两区（分支点，不压缩）；华东区再有「明细」子层 → 导引线读多级层级。
  { rootId: 'r-docs', path: '归档/2025/Q4/市场活动/双十一/复盘/华东区/门店复盘.html', kind: 'html', docId: 'd-r2-manual' },
  { rootId: 'r-docs', path: '归档/2025/Q4/市场活动/双十一/复盘/华东区/明细/1月.html', kind: 'html', docId: 'd-r2-interview' },
  { rootId: 'r-docs', path: '归档/2025/Q4/市场活动/双十一/复盘/华东区/明细/2月.html', kind: 'html', docId: 'd-r2-interview' },
  { rootId: 'r-docs', path: '归档/2025/Q4/市场活动/双十一/复盘/华南区/门店复盘.html', kind: 'html', docId: 'd-r2-manual' },
]
