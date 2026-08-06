# 文档图片（Image 块）—— 对齐 spec

状态（2026-07-15）：**两侧均已实现**。ui-demo 定稿（PR #204，Colin 实测 + live），真 app
移植（本 PR，U1–U6）。三项决策见「已拍板」（Colin 2026-07-14）。

Schema 层早已就位、本 spec 零改动消费：`IMG` 是顶层块、`figure`（恰含一个 `<img>` +
可选 `<figcaption>`）是 canonical 配字图，都在 Schema #1 校验器里（`src/lib/schema-validate.js`）；
`docs/schema-1-draft-v0.md` §5 已拍 Image = Tier 1「现在加」+ data: 内联 + 降采样护栏。
本 spec 是那次拍板的执行契约。

## 行为契约

### 插入入口（按使用频率）

1. **粘贴截图/图片**（主路径）：剪贴板含 `image/*` 且**无可用文本**（文本优先，已拍板①）→
   降采样管线 → 插入图片块；光标所在块为空段落则原地替换，否则插在其后（已拍板②）。
2. **拖放图片文件**：外部拖放现状一律拒（ED-A5 防注入，正确、保留）；仅对 `image/*` 文件放行。
   落点算法 = 指针 Y 最近的顶层块 + 越过该块**垂直中线**才翻到它之后（`dropAnchor` 返回「插在它之后」的块）。
   拖动过程中画**块间插入线**（复用内部块拖拽的 `data-ws2-drop='bottom'` 视觉）；线由 `dropAnchor`
   本人算、不另写一份坐标逻辑——两份必然漂移成「画的≠做的」（I4 的教训）。外部拖放没有 `dragend`，
   拖出窗口（`dragleave` 且 `relatedTarget` 为空）时自行收线；drop / 非图片被拒时同样收。
   ⚠ 沿革：2026-08-04 对拍 I10 实测出「全程零落点反馈」，与本行原文不符——原文描述的是一个从未实现的
   行为。现已补上实现（`onDragOver` 的 Files 分支，门 `e2e/image-drop-indicator.spec.js`），本行回到描述实况。
3. **斜杠菜单「图片」**：打开文件选择器（accept 常见位图格式），选中后走同一管线。

### 图片块行为（原子叶子块，§5 拍板）

- 光标不可进入图片内部；点击图片 = 整块选中（选中范围 = 整个 `figure`，含说明）。
  ⚠ 视觉**不是**通用块灰选样式，而是图片专用的 accent 蓝环：暗色文档的双反色滤镜会把通用黑环
  翻回黑、在暗底隐身（`e2e/images.spec.js` 守着这条）。此前本行写「对齐现有块选中态样式」是
  被后来的修复推翻却没回写的旧描述。
- 选中态下 Backspace/Delete 删除整块；Enter 在块后新建空段落；上下方向键从相邻块跨过/选中它。
- 块拖拽排序复用现有 grip，无特殊路径。
- **顶层图片各占一行**（入盘 baseline `:where(img){display:block}`）：多张顶层图不并排挤成一行——
  编辑器模型里图片是顶层块（选中/拖拽/方向键都按 1 个块处理），inline 渲染与该模型自相矛盾，
  实测后果是第二张图的 ⋮⋮ 手柄画在第一张图的图面上。**行内图片豁免**：`<p>文字 <img> 文字</p>`
  等文字容器里的 img 保持 `display:inline`（IMG 同时是合法 phrasing，见 schema-model 的 PHRASING_TAGS）。
- **「加说明」的可见性契约**：图片已有 `<figcaption>` 时，块菜单里**不再出现**「加说明」项。
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
| 图片块渲染/选中态 | `Canvas.tsx` `ImageBlockView`（原子块） | `src/editor/blockedit.js`：`classify(<figure>含 img)→'image'`，灰选复用 `data-ws2-selected`（无第二层描边） |
| 三入口（斜杠/粘贴/拖放） | `Canvas.tsx` `applySlash`/`onBlocksPaste`/`onBlocksDrop` | `src/editor/blockedit.js` `SLASH_ITEMS`+`applySlash`（image 分支）/`onPaste`（文本优先）/`onDragOver`+`onDrop`（image 白名单） |
| 摄入 + 降采样纯逻辑 | `ui-demo/src/lib/image.ts` | `src/lib/image-ingest.js`（双导出，脱 Electron，`test/image-ingest.test.js` node:test 直测；`ingestImage` 在父层 renderer 跑） |
| 图片说明 figcaption | `ImageBlockView`（图下方内联「加说明」） | `blockedit.js` 块 ⋮⋮ 菜单「加说明」+ `enterCaptionEdit`/`persistCaption`（见有意分歧） |
| 文件选择器 | 浏览器 `<input type=file>` | 主进程 `src/main/ipc.js` `ws-pick-images` + `src/renderer/preload.js` `pickImages`（`window.ws2`；shell.js attach 传 `pickImages` dep） |
| 校验 | —（demo 无校验器） | `src/lib/schema-validate.js`（已就位，零改动） |
| 验证门 | `ui-demo/scripts/verify-images.mjs` | `e2e/images.spec.js`（磁盘字节过 `registry.classify` 判 conform + 变异自检） |

## 有意分歧

- 文件选择器：demo 用浏览器 `<input type=file>`，真 app 用原生 dialog——平台能力差异
  （2026-07-14，随本 spec 设立）。
- **「加说明」入口**：demo 在选中图下方给一个内联按钮；真 app 走块 ⋮⋮ 菜单的「加说明」项
  ——真 app 的块级操作统一收在 ⋮⋮ 菜单（转为/复制/删除/颜色都在那），平台交互惯例差异
  （Colin 待 review 时确认；2026-07-15，随真 app 移植设立）。已有说明的图两侧都是直接点
  figcaption 编辑、清空降回裸 img，一致。

## 对齐锚点

- ui-demo 侧：commit `a454c7d`（2026-07-15，PR #204 merge）
- app 侧：本 PR `feat/app-doc-images`（U1–U6），合并后 = merge sha

### 交互粒度（2026-08-05 图片簇落地，Colin 拍板全按 Notion，对拍 I6/I7/I11/I12/I13/I14）

- **「说明」是常驻开关**：有说明的图点它聚焦既有说明行、无说明的图点它创建并聚焦（I7；此前
  「加说明」只给无说明的图）。**说明已空再按退格 → 当场回收说明行**、降回裸 `<img>`、光标弹上一个
  可编辑位（I6）；图片本体 inert 不变——任何路径都删不掉图。
- **图片本体按住可拖重排**（I11；起拖区不再只有 ⋮⋮ 手柄）；外部文件拖放的 ED-A5 拒收不受影响。
- **内部拖拽落点 = 指针半区**（I12）：线画上缘/下缘由指针在目标块的上半/下半区决定，与 OS 文件
  拖放同一判据；此前是「源块与目标块的文档序」，指针位置不参与、「拖到上半区插上面」做不到。
- **图片不是键盘停靠位**（I13）：裸图被 ↑↓ 直接跳过（0 停靠位）、带说明图停靠在**说明文字**里；
  图片的选中入口只剩鼠标点选（Notion 同款）。
- **跨块选区罩图**（I14）：被罩图降透明度让蓝底透上来、整图呈被蓝罩态（功能层「所见即所删」
  本来就对，差异只在视觉——背景蓝被图片像素盖死）。

## 欠账

- **OS 文件拖放入口**：已实现（落点 = Y 最近块 + 插入线）。~~靠宿主手测~~ —— 2026-08-04 更正：
  `dataTransfer.files` **能在 e2e 合成**（canvas → `File` → `dt.items.add`，`dt.types` 就含 `'Files'`），
  `e2e/image-drop-indicator.spec.js` 已按此把 dragover/drop 全链路纳入门。原判断「难在 e2e 合成」不成立。
  仍存的真风险：真机上 iframe 的 drop 事件若拿不到 files，回退方案 = 把 OS 图片 drop 处理器挂到父层 frame 元素。
- **I1 的图内工具条与左右缩放条**（Notion：悬停出 7 键工具条 + col-resize 药丸）：**押后**。
  缩放牵扯宽度入盘——`img[width]` 在校验器里可行（IMG v1 不深验属性），但「拖拽调宽 + 即时预览 +
  入盘归一」是独立 feature 量级；工具条 7 键里我们有对应物的只有说明（已常驻）。评估结论：不塞进
  对拍批次，独立立项。（`resize.js` 等 746 行死代码正是当年给这个留的，届时一并处置。）
- **EXIF 方向**：沿用 ui-demo 验证过的 `createImageBitmap(file)` 默认行为（未显式传
  `imageOrientation`）。若在更老 Chromium 上遇到方向不归正，显式传 `{ imageOrientation: 'from-image' }`。
- **体积放大预案（未做压力用例）**：undo 是 `body.innerHTML` 全量快照、自动保存全量重写文件——
  多图文档下两者随内联 base64 放大。Phase 1 靠降采样上限（长边 1600 / 单图 1.5MB）压住；
  多图文档的体积/性能压力用例尚未加（本 PR e2e 只验单图管线），出现卡顿信号时补 + 收 undo 栈深；
  Phase 2 sidecar 根治。
