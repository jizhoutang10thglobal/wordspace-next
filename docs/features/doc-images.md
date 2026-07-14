# 文档图片（Image 块）—— 对齐 spec

状态（2026-07-14）：**设计契约，两侧均未实现**。由插图技术研究落账，三项决策已拍
（Colin 2026-07-14，见「已拍板」），按「ui-demo 先定稿 → 移植真 app」流程实施。

Schema 层早已就位、本 spec 零改动消费：`IMG` 是顶层块、`figure`（恰含一个 `<img>` +
可选 `<figcaption>`）是 canonical 配字图，都在 Schema #1 校验器里（`src/lib/schema-validate.js`）；
`docs/schema-1-draft-v0.md` §5 已拍 Image = Tier 1「现在加」+ data: 内联 + 降采样护栏。
本 spec 是那次拍板的执行契约。

## 行为契约

### 插入入口（按使用频率）

1. **粘贴截图/图片**（主路径）：剪贴板含 `image/*` 且**无可用文本**（文本优先，已拍板①）→
   降采样管线 → 插入图片块；光标所在块为空段落则原地替换，否则插在其后（已拍板②）。
2. **拖放图片文件**：外部拖放现状一律拒（ED-A5 防注入，正确、保留）；仅对 `image/*` 文件放行，
   落点 = 拖放位置的块间插入线（复用内部块拖拽的插入线视觉）。非图片文件维持拒绝。
3. **斜杠菜单「图片」**：打开文件选择器（accept 常见位图格式），选中后走同一管线。

### 图片块行为（原子叶子块，§5 拍板）

- 光标不可进入图片内部；点击图片 = 整块选中（灰选，对齐现有块选中态样式）。
- 选中态下 Backspace/Delete 删除整块；Enter 在块后新建空段落；上下方向键从相邻块跨过/选中它。
- 块拖拽排序复用现有 grip，无特殊路径。
- **「加说明」**：裸 `<img>` 升级为 `<figure><img><figcaption>`；说明清空则降回裸 `<img>`
  （两形态都合法，canonical 双向收敛）。
- `alt` 默认 = 原文件名去扩展名（可访问性 + 未来 AI 检索），可编辑。

### 降采样护栏（§5 既定，编辑时强制、非 schema 规则）

- 长边 ≤1600px；重编码 WebP（fallback JPEG）质量 ~0.8；单图 base64 ≤1.5MB
  （data: URI 实测 ~2MB 起卡 DOM，护栏留余量）。
- 降采样后仍超限 → 拒绝插入并提示（Phase 2 sidecar 落地后改为自动外置）。
- EXIF 方向在解码时归正（`createImageBitmap`）。
- **拒 SVG**——与校验器同口径（`data:image/svg` 非法：SVG 能内嵌脚本/外链）。

### 存储（分期）

- **Phase 1（本 spec 范围）：`data:image/*` base64 内联。** 真单文件自包含（愿景明文价值观）、
  发布 = 拷一个文件、文档移动/改名零维护。截图高频场景降采样后普遍 100–500KB，在安全区内。
- **Phase 2（触发后另立 spec）：sidecar `<文档名>.assets/` 同目录相对路径外置。** 触发条件 =
  照片级大图/图文长文需求出现。互链的路径代数 + 改名重写引擎扩展到 `img[src]` 即可；
  同一「文档+资源」约定顺手解锁 Video/Audio/File（Tier 2 全部阻塞于此，见 §5）。
  两种存储可共存：小图内联、大图外置。
- 远程 `https://` 图片：校验器放行（合法），但编辑器不主动产生；富粘贴实现时网页图片
  默认下载转内联（本地优先，离线不断图）。

### 渲染（现状已通，零改动）

- 校验器：`IMG` ∈ TOP_BLOCKS；figure canonical；`src` 禁 `javascript:/vbscript:/file:/blob:`
  绝对地址，`data:` 只放 `image/*` 非 SVG——磁盘引用被强制为相对路径，与互链同口径。
- CSP：外壳 `img-src 'self' file: data:`；文档 file:// 直载 iframe、相对资源天然解析。

### 已拍板（Colin 2026-07-14）

1. 剪贴板同时含文本和图片：**文本优先**——有可用文本走现有纯文本粘贴，纯图片才插图。
   不改变任何现有粘贴行为（Word/Excel 复制不会退化成一张截图）。
2. 光标在空段落上插入图片：**原地替换**该空段落（Notion 同款，不留废空行）。
3. Phase 2 sidecar：**现在不拍**——不阻塞第一期，等「大图被拒」的真实需求信号出现再立
   spec；届时命名倾向 `<文档名>.assets/`（资源随文档走），此句为参考非决策。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 图片块渲染/选中态 | 未实现（Canvas.tsx 块模型新块型） | 未实现（`src/editor/blockedit.js` 原子叶子块） |
| 粘贴/拖放分支 | 未实现 | 未实现（blockedit `onPaste` / ED-A5 白名单分支） |
| 降采样纯逻辑 | 未实现（建议 `ui-demo/src/lib/image.ts`） | 未实现（建议 `src/lib/image-ingest.js`，脱离 Electron、vitest 直测） |
| 文件选择器 | 浏览器 `<input type=file>` | 主进程 dialog（`window.ws2` IPC；编辑内核在父层，接线无障碍） |
| 校验 | —（demo 无校验器） | `src/lib/schema-validate.js`（已就位，零改动） |

## 有意分歧

- 文件选择器：demo 用浏览器 `<input type=file>`，真 app 用原生 dialog——平台能力差异
  （2026-07-14，随本 spec 设立）。

## 对齐锚点

- ui-demo 侧：未实现
- app 侧：未实现

## 欠账

- 全部：两侧均未实现，本 spec 为纯设计契约。实施顺序按惯例 ui-demo 先定稿。
- **验证门（实施 PR 必带）**：图片真渲染的强断言（`naturalWidth > 0` + boundingBox 非零，
  不查 DOM 存在性——S4 纪律：能想出「图挂了断言还过」就是弱门）+ 变异自检（坏 src 必翻红）+
  降采样护栏单测（超限拒绝、EXIF 归正、SVG 拒）。
- **体积放大预案**：undo 是 `body.innerHTML` 全量字符串快照、自动保存 1.2s 全量重写文件——
  多图文档下两者都随内联 base64 放大。Phase 1 靠降采样上限压住 + undo 栈深度设限；
  Phase 2 sidecar 根治。实现 PR 带多图文档的体积/性能压力用例。
