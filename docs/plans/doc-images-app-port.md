# 文档图片（Image 块）→ 真 app 移植 plan

2026-07-15。ui-demo 定稿已合 main（PR #204，Colin 实测过）+ live。本 plan 给执行 AI：
把图片块按 spec 移植进真 app（`src/**`）。**执行前必读**（按序）：

1. `docs/features/doc-images.md` —— 行为契约 + 三项已拍板决策（文本优先/空段落原地替换/Phase 2 不做），是验收基准。
2. `ui-demo/src/lib/image.ts` + `ui-demo/src/components/Canvas.tsx`（搜 `ImageBlockView`、`insertImages`、`onBlocksPaste`）—— 参考实现。**抄行为不抄代码**（两侧技术栈不同）。
3. 仓根 `CLAUDE.md` 的「开发时的测试纪律」和「变异自检两条铁律」。
4. `docs/schema-1-draft-v0.md` §5 —— 护栏数字的出处。

## 0. 已核实事实（别再调研，直接信）

- **渲染/校验层零改动**。`src/lib/schema-validate.js`：`IMG` ∈ TOP_BLOCKS；`validateFigure` = 恰一 `<img>` + 可选 `<figcaption>`（phrasing-only、禁 style）；`src` 禁 `javascript:/vbscript:/file:/blob:`，`data:` 只放 `image/*` 非 SVG。CSP `img-src 'self' file: data:`；file:// 直载与 srcdoc 两路都能渲 data: 图。
- **原子块交互地基已存在**。`src/editor/blockedit.js`：`classify(IMG)` → `'image'`，`isEditableEl` 把它归「不可编辑、整块灰选中」（与 hr/designed 同路径：`selectedEl` + `data-ws2-selected` 属性，serialize 白名单剥除）。选中/删除/手柄大概率免费，**先写 e2e 验证现状再决定补多少**（ui-demo 侧实测教训：机制类型无关，新原子块近乎免费）。
- **粘贴现状**：blockedit `onPaste` 是纯文本地板；**外部拖放现状被 ED-A5 一律吞掉**（注释在 grip/dragend 附近）——图片入口都是在这两个守卫上开 `image/*` 白名单分支，别推倒重做。
- **SLASH_ITEMS 有下标引用约束**：blockedit 里块菜单按下标引用 `SLASH_ITEMS[0/2/5]`（注释在数组处）。新「图片」项**只能 append 在 divider 之后、ai 之前**，或先核实引用改为按 key。
- **编辑器跑在父层**（shell.js「块编辑内核跑在父层、操作 iframe 的 contentDocument」）：canvas 降采样、`createImageBitmap`、文件选择都在父 renderer 做，产物（`<img>` 元素）插进 iframe DOM。**renderer 无 node**：读磁盘文件必须走 main（IPC）。
- **IPC dialog 模式现成**：`src/main/ipc.js` 已有多处 `dialog.showOpenDialog`（如 `:286`、`:543`），照抄模式加一个图片选择 handler。
- **undo = WS2Undo 的 body 快照**；插入后走 `markDirty` + `undoMgr.checkpoint()`（blockedit 内已有模式，搜 `undoMgr.checkpoint`）。

## 1. 执行切片（建议顺序，每片一个 commit 起）

### U1 · `src/lib/image-ingest.js` 纯逻辑 + vitest
不带 `require('electron')` 的普通 CJS 模块（S1 教训，vitest node 环境直测）：
`planResize(w,h,maxEdge=1600)`、`fitsBudget(dataUrl, max=1.5MB)`、`acceptsImageType(mime)`（白名单 png/jpeg/webp/gif/avif，显式拒 svg）、`imageBlockHtml(src,alt,caption?)`（canonical 两形态：裸 `<img>` / `<figure><img><figcaption>`，caption/alt 要 escape）、`parseImageBlockHtml(html, doc)`（DOM 依赖通过参数注入 document，测试传 linkedom/正则版）。
**验收**：vitest 单测覆盖缩放数学、预算边界（恰好 1.5MB）、escape、canonical 双向（parse∘build = id）。

### U2 · 摄入管线（父层 renderer）
`src/renderer/`（或 blockedit 依赖注入）：`ingestImage(fileOrBlob)` = `createImageBitmap`（EXIF 归正）→ 超 1600 canvas 等比缩 → `toDataURL('image/webp', .8)`（webp 不支持退 jpeg）→ `fitsBudget` 超限拒。gif 不重编码（会杀动图），原尺寸+预算内直接 FileReader 内联，超限拒。拒因分三类 type/budget/decode，提示语抄 ui-demo。
**验收**：并入 U4 的 e2e（管线无独立门，纯逻辑部分已在 U1）。

### U3 · IPC 文件选择器
`ipc.js` 加 handler（如 `ws-pick-images`）：`dialog.showOpenDialog({ properties:['openFiles','multiSelections'], filters:[{name:'图片', extensions:['png','jpg','jpeg','webp','gif','avif']}] })` → `fs.readFile` → 返 `[{ name, mime, base64 }]`。preload 暴露到 `window.ws2`（S3 教训：preload require + contextBridge，`sandbox:false` 已是现状）。
**验收**：e2e 里通过 seam mock（返回 fixture 图）驱动斜杠入口。

### U4 · 三入口 + 已拍板行为（blockedit）
- **斜杠「图片」**：菜单项 append（注意 §0 下标约束）→ `window.ws2` 选图 → U2 管线 → 插 `<img>` 顶层块。**空段落原地替换**（已拍板②）：锚块 textContent 为空 → 替换之，否则插其后。取消选择不留空 undo 步（checkpoint 延到真插入）。
- **粘贴**：onPaste 开头加分支——`clipboardData` 有非空 `text/plain` → 走现有路径（**文本优先**，已拍板①）；纯图 → ingest → 插入（锚=光标块，空段落替换同上）。
- **拖放**：ED-A5 吞外部拖放的守卫里放行 `image/*` 文件（非图维持拒 + 给用户可见反馈）；落点=Y 最近块，上半且非首块插前、否则插后（对齐 ui-demo）。
- 插入后：新块置为灰选中（`selectBlock` 同款路径）、`markDirty`、`undoMgr.checkpoint()`。
**验收**：e2e——三入口各至少 1 条 + 两项拍板行为断言（见 U6 强度要求）。

### U5 · figcaption 说明
选中态给「加说明」入口（浮动手柄/菜单风格跟现有一致）；figcaption 是块内唯一可编辑区：`contenteditable` 只开在 figcaption 上、keydown 拦 Enter/Escape=失焦、**阻断冒泡防文档级快捷键把整块删了**（ui-demo 踩过：Backspace 在说明里删了整图）；失焦 persist：非空→figure 形态、空→降回裸 img（用 U1 的 canonical 构造，别手拼）。
**验收**：e2e——加说明→入盘字节含 figcaption；清空→降回裸 img；说明内 Backspace 不删块。

### U6 · 验证门 + spec 收尾（与 U4/U5 同 PR）
- `e2e/images.spec.js`：**强断言口径**（S4：能想出「图挂了断言还过」就是弱门）= `naturalWidth>0` + boundingBox 宽高非零 + `src` 以 `data:image/` 开头，不查 DOM 存在性。覆盖：三入口、文本优先、空段落替换、降采样（喂 2400×1500 fixture 断言存盘 ≤1600）、**入盘字节过 schema-validate**（图片文档必须判合规）、重启后仍渲染、**变异自检**（src 打坏同一谓词必翻红，坏了还绿=哑门=fail）。参考 `ui-demo/scripts/verify-images.mjs` 的断言清单。
- **铁律**：同 PR 更新 `docs/features/doc-images.md`——文件映射填真路径、对齐锚点填两侧 sha（ui-demo 侧 = PR #204 merge commit）、欠账清掉已还项。
- 变异自检两条铁律：**先 commit 再变异**；fixture 字符串长度是测试变量。

## 2. 完成定义（全部满足才算 done）

vitest 全绿；`npx playwright test e2e/images.spec.js` 绿；**动了 blockedit/shell 核心 → 推 PR 前本地 `npm run test:e2e:dot` 全量兜底**（本 feature 必动 blockedit，别省）；PR CI（required test+e2e）绿——**CI 跑 merge commit，本地绿≠CI 绿，先 rebase main**；spec 同 PR 更新。宿主视觉验收（真开 app 插图截图）留给 Colin 或 host-verify 流程。

## 3. 红线与坑（血泪库存，违反=返工）

- iframe sandbox 不跑脚本，一切编辑器逻辑在父层；**别削弱任何 CSP**（S4 红线）；srcdoc 的 style 镜像机制（shell.js:490 一带）别碰。
- 图片块**不进** basic-edit（非合规文档的兜底编辑器）——本 feature 只做块编辑（合规）路径。
- undo body 快照随内联 base64 放大：降采样上限是唯一防线，**别加大 1.5MB 预算**；如实测卡顿，收 undo 栈深，不动预算。
- 开发环境：容器 `npm install` 要 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`；e2e 真跑在 CI/宿主。
- 流程：独立 worktree 干活（并行 session 多）；勤 commit；push 用 `jizhoutang10thglobal` token（默认凭证 403，见 CLAUDE.md/skill 文档）；先 `/sync-main`。

## 4. 明确不做（Phase 2 / 另立）

sidecar `<文档名>.assets/` 外置存储（等需求信号，已拍板③）；远程 https 图「下载转内联」（归富粘贴 feature）；Video/Audio/File（Tier 2，阻塞于 sidecar 约定）；图片缩放手柄/对齐/裁剪（spec 外，别顺手加）。
