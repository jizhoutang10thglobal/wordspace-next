import type {
  AgentEvent,
  Doc,
  FileEntry,
  Folder,
  Member,
  Space,
  Template,
  Workspace,
} from '../types'

const now = Date.now()
const MIN = 60_000
const HR = 60 * MIN
const DAY = 24 * HR

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
export const seedFolders: Folder[] = [
  { id: 'f-strategy', name: '战略', scope: 'team', spaceId: 'sp-tg', order: 0 },
  { id: 'f-people', name: '人事', scope: 'team', spaceId: 'sp-tg', order: 1 },
  { id: 'f-product', name: '产品', scope: 'team', spaceId: 'sp-tg', order: 2 },
  { id: 'f-drafts', name: '我的草稿', scope: 'personal', spaceId: 'sp-tg', order: 0 },
]

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------
export const seedDocs: Doc[] = [
  {
    id: 'd-handbook',
    title: '员工手册',
    emoji: '📘',
    kind: 'doc',
    folderId: 'f-people',
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
    folderId: 'f-people',
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
  {
    id: 'd-strategy',
    title: '2026 公司战略',
    emoji: '🎯',
    kind: 'doc',
    folderId: 'f-strategy',
    visibility: 'invited',
    localPath: '~/Wordspace/团队/战略/2026战略.html',
    updatedAt: now - 5 * HR,
    updatedBy: 'm-wendi',
    collaborators: ['m-wendi', 'm-lin'],
    blocks: [
      { id: 's1', type: 'heading', level: 1, html: '2026 公司战略' },
      { id: 's2', type: 'text', html: '今年的重点是把核心业务做深,同时为下一阶段的 AI 产品打基础。下面是四条业务线和各自的目标。' },
      { id: 's3', type: 'heading', level: 2, html: '业务线' },
      { id: 's4', type: 'list', html: '<li>咨询交付:稳住现金流,提升复购</li><li>培训与内容:沉淀方法论</li><li>AI 产品:从内部工具孵化</li><li>生态合作:拓展渠道</li>' },
      { id: 's5', type: 'callout', html: '这份文档只对受邀的几个人可见,还在讨论中,定稿后再发到内网。' },
    ],
  },
  {
    id: 'd-deck',
    title: 'Q2 业务汇报',
    emoji: '📊',
    kind: 'slides',
    folderId: 'f-product',
    visibility: 'private',
    localPath: '~/Wordspace/团队/产品/Q2汇报.html',
    updatedAt: now - 1 * DAY,
    updatedBy: 'm-chen',
    collaborators: ['m-chen'],
    blocks: [
      { id: 'k1', type: 'heading', level: 1, html: 'Q2 业务汇报' },
      { id: 'k2', type: 'text', html: '这是一份演示文稿,和普通文档一样是一个 HTML 文件,可以放映,也可以导出成 PPT。' },
      { id: 'k3', type: 'heading', level: 2, html: '关键数字' },
      { id: 'k4', type: 'list', html: '<li>营收同比 +28%</li><li>新签客户 12 家</li><li>毛利率 41%</li>' },
    ],
  },
  {
    id: 'd-minutes',
    title: '周会纪要 06-12',
    emoji: '📝',
    kind: 'doc',
    folderId: 'f-strategy',
    visibility: 'private',
    localPath: '~/Wordspace/团队/战略/周会纪要-0612.html',
    updatedAt: now - 2 * DAY,
    updatedBy: 'm-lin',
    collaborators: ['m-lin'],
    blocks: [
      { id: 'n1', type: 'heading', level: 1, html: '周会纪要 · 06-12' },
      { id: 'n2', type: 'list', html: '<li>招聘页已上线,本周看转化</li><li>员工手册补充报销章节</li><li>下周评审 AI 产品 demo</li>' },
    ],
  },
  {
    id: 'd-offer',
    title: 'Offer 模板(草稿)',
    emoji: '✉️',
    kind: 'doc',
    folderId: 'f-drafts',
    visibility: 'private',
    localPath: '~/Wordspace/我的草稿/offer模板.html',
    updatedAt: now - 40 * MIN,
    updatedBy: 'm-wendi',
    collaborators: ['m-wendi'],
    blocks: [
      { id: 'o1', type: 'heading', level: 1, html: 'Offer 模板' },
      { id: 'o2', type: 'text', html: '尊敬的 {{候选人}},很高兴向你发出录用通知……(草稿,待定稿后存为模板)' },
    ],
  },
  {
    id: 'd-notes',
    title: '读书笔记 · 增长飞轮',
    emoji: '📖',
    kind: 'doc',
    folderId: 'f-drafts',
    visibility: 'private',
    localPath: '~/Wordspace/我的草稿/读书笔记-增长飞轮.html',
    updatedAt: now - 90 * MIN,
    updatedBy: 'm-wendi',
    collaborators: ['m-wendi'],
    blocks: [
      { id: 'rn1', type: 'heading', level: 1, html: '读书笔记 · 增长飞轮' },
      { id: 'rn2', type: 'text', html: '存在本地、只给自己看的随手记。' },
    ],
  },
  {
    id: 'd-todo',
    title: '本周待办',
    emoji: '✅',
    kind: 'doc',
    folderId: 'f-drafts',
    visibility: 'private',
    localPath: '~/Wordspace/我的草稿/本周待办.html',
    updatedAt: now - 20 * MIN,
    updatedBy: 'm-wendi',
    collaborators: ['m-wendi'],
    blocks: [
      { id: 'tw1', type: 'heading', level: 1, html: '本周待办' },
      { id: 'tw2', type: 'list', html: '<li>定稿招聘页</li><li>过一遍 Q2 汇报</li><li>约客户周会</li>' },
    ],
  },
]

// ---------------------------------------------------------------------------
// templates: private (company) pool + public pool
// ---------------------------------------------------------------------------
// 公司模板（private）= 我们自己写的、对编辑器适配最好的模板。用原生 block 编排
// （heading/text/list/todo/callout/divider），块类型本身承载“功能性样式”——这样
// 拖拽/转换/格式工具栏/斜杠菜单等编辑功能在模板上全程可用、无 bug。
// 「格式模板」额外带 pageFormat（A4/A5/书信…），把画布约束到一张实际纸的宽度。
export const seedTemplates: Template[] = [
  // —— 文档类模板（工作中最常见的三种）——
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
    id: 't-weekly', name: '工作周报', kind: 'doc', category: '周报', pool: 'private',
    description: '本周完成 / 进行中 / 下周计划 / 风险,周会汇报标准格式。', accent: '#1e8e3e',
    blocks: [
      { id: 'wk1', type: 'heading', level: 1, html: '工作周报' },
      { id: 'wk2', type: 'text', html: '<b>姓名</b>　______　｜　<b>周期</b>　第 00 周（00-00 ～ 00-00）' },
      { id: 'wk3', type: 'heading', level: 2, html: '本周完成' },
      { id: 'wk4', type: 'list', listStyle: 'bulleted', html: '<li>______</li><li>______</li>' },
      { id: 'wk5', type: 'heading', level: 2, html: '进行中' },
      { id: 'wk6', type: 'list', listStyle: 'bulleted', html: '<li>______（进度 00%）</li>' },
      { id: 'wk7', type: 'heading', level: 2, html: '下周计划' },
      { id: 'wk8', type: 'list', listStyle: 'todo', html: '<li>______</li><li>______</li>' },
      { id: 'wk9', type: 'heading', level: 2, html: '问题 / 需要的支持' },
      { id: 'wk10', type: 'callout', html: '⚠ ______' },
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
  // —— 格式类模板（按纸张版面）——
  {
    id: 't-a4', name: 'A4 文档', kind: 'doc', category: 'A4', pool: 'private', pageFormat: 'A4',
    description: '标准 A4 版面（210×297mm）,正式文档、打印、导出 PDF。', accent: '#5a5f66',
    blocks: [
      { id: 'a4-1', type: 'heading', level: 1, html: '文档标题' },
      { id: 'a4-2', type: 'text', html: '<b>A4 版面</b>　210 × 297 mm。适合正式文档、合同、报告——打印 / 导出 PDF 时版心与纸张一致。' },
      { id: 'a4-3', type: 'text', html: '在此开始写作……' },
    ],
  },
  {
    id: 't-a5', name: 'A5 便签', kind: 'doc', category: 'A5', pool: 'private', pageFormat: 'A5',
    description: '小幅 A5 版面（148×210mm）,便签、备忘、清单。', accent: '#8a3ffc',
    blocks: [
      { id: 'a5-1', type: 'heading', level: 2, html: '便签' },
      { id: 'a5-2', type: 'text', html: 'A5 版面　148 × 210 mm。窄幅,适合便签、备忘、随手清单。' },
      { id: 'a5-3', type: 'list', listStyle: 'todo', html: '<li>______</li><li>______</li>' },
    ],
  },
  {
    id: 't-letter', name: '商务书信', kind: 'doc', category: '书信', pool: 'private', pageFormat: 'letter',
    description: '书信版面,称呼 / 正文 / 敬语 / 署名,对外函件。', accent: '#0b8793',
    blocks: [
      { id: 'lt1', type: 'text', html: '2026 年 00 月 00 日' },
      { id: 'lt2', type: 'text', html: '尊敬的 ______：' },
      { id: 'lt3', type: 'text', html: '　　您好！' },
      { id: 'lt4', type: 'text', html: '　　______（正文）______' },
      { id: 'lt5', type: 'text', html: '　　此致' },
      { id: 'lt6', type: 'text', html: '敬礼！' },
      { id: 'lt7', type: 'text', html: '______（署名）<br>______（单位）' },
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
// spaces (Arc-style, swiped in the sidebar)
// ---------------------------------------------------------------------------
// Two real categories of space: the Wordspace cloud (native, collaborative,
// team/private sections) and connected folders (an external mount you browse —
// local disk or Google Drive, the same kind of thing).
export const seedSpaces: Space[] = [
  { id: 'sp-tg', name: 'Tenth Global', kind: 'team', storage: 'cloud', badge: 'TG', color: '#1a73e8', subtitle: '团队工作区' },
  { id: 'sp-drive', name: '公司网盘', kind: 'project', storage: 'gdrive', badge: 'G', color: '#1e8e3e', subtitle: 'Google Drive', mountPath: 'Google Drive/Tenth Global' },
  { id: 'sp-local', name: '设计项目', kind: 'project', storage: 'local', badge: '设', color: '#b8541d', subtitle: '本地项目', mountPath: '~/Projects/品牌升级' },
]

// Connected folders show every file, not just Wordspace docs. HTML opens in the
// editor (docId set); the rest hand off to the OS default app.
export const seedFiles: FileEntry[] = [
  // 公司网盘 (Google Drive)
  { spaceId: 'sp-drive', path: '人事/员工手册.html', kind: 'html', docId: 'd-handbook' },
  { spaceId: 'sp-drive', path: '人事/入职流程.docx', kind: 'word' },
  { spaceId: 'sp-drive', path: '战略/2026 战略规划.docx', kind: 'word' },
  { spaceId: 'sp-drive', path: '战略/市场分析.pdf', kind: 'pdf' },
  { spaceId: 'sp-drive', path: '品牌/官网首页.html', kind: 'html', docId: 'd-recruit' },
  { spaceId: 'sp-drive', path: '品牌/Logo.png', kind: 'image' },
  { spaceId: 'sp-drive', path: '财务/Q2 预算.xlsx', kind: 'sheet' },
  { spaceId: 'sp-drive', path: '产品/发布会.pptx', kind: 'slides' },
  // 设计项目 (local)
  { spaceId: 'sp-local', path: '提案.docx', kind: 'word' },
  { spaceId: 'sp-local', path: '落地页.html', kind: 'html', docId: 'd-recruit' },
  { spaceId: 'sp-local', path: '素材/封面.png', kind: 'image' },
  { spaceId: 'sp-local', path: '数据/转化分析.xlsx', kind: 'sheet' },
  { spaceId: 'sp-local', path: '说明.html', kind: 'html', docId: 'd-handbook' },
]
