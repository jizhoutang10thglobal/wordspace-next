# Team Memory — 跨 session 公告板

> **这是什么**：并行 worktree/session 之间唯一的全局知识 channel。Claude Code 的
> auto-memory 按文件夹路径隔离、跨不了 worktree；这份文件走 git，人人可达。
>
> **读**：任何 session 里调 `/sync-main`（冷启动、长 session 隔段时间、动新改动前都值得跑）。
> **写**：调 `/remember-global`——它把条目经「短命分支 + PR + auto-merge」落到 main（发完即走，
> required checks 绿后约 7 分钟自动合上）。不直推——branch protection 对所有人所有文件生效，
> 曾经的直推特权已废除（Colin 拍板 2026-07-11，见下方同日公告）。
>
> **写什么**：会影响其他 session 的东西——全局教训、规则/门变更、拍板决策、流程变化。
> 只对单个 feature 有效的知识别写这。条目要写「是什么 + 怎么 apply + 来源」，别只写「改了 X」。
> **沉淀**：时效已过的条目可清理；升格为硬规则的移进 `CLAUDE.md`。

<!-- 新条目插在这行下面（倒序，最新在最上） -->

## 2026-07-11 — /remember-global 落账方式定案：PR + auto-merge，直推特权废除

**是什么**：Colin 拍板（方案 B）：保留 main 的全部保护门（must-PR + required test/e2e，含管理员），
`/remember-global` 改走「短命分支 + PR + `gh pr merge --auto`」；仓库已开 Allow auto-merge。
skill 文档已同步改写（含标记行前缀匹配、jizhoutang10thglobal 账号 push 等实操坑）。
**怎么 apply**：写 team-memory 一律按新版 skill 步骤走，发完即走不等 CI（约 7 分钟后自动上 main）。
任何「直推 main」的念头都打消——对所有人所有文件都不存在这条路。
**来源**：PR（本条目所在）+ 仓库设置 allow_auto_merge=true（2026-07-11 API 实开）


## 2026-07-10 — 浏览器 feature 规格定稿 + 六项拍板合 main；真 app 移植的唯一契约就位

**是什么**：浏览器 feature（标签上网/地址栏+自动补全/侧栏折叠收藏/历史/右键菜单/快捷键/会话恢复）在
ui-demo 定稿并合 main（PR #150）。完整规格=`docs/browser-feature-spec.md`（正本，~460 行：每功能三层
「交互契约 → ui-demo 参考实现 → 真 app 后端设计(WebContentsView/IPC/存储)」，含安全不变式与验收清单）
+ `docs/features/browser.md`（features 注册表薄指针+欠账）。Colin 六项拍板已落地：真 app 默认引擎=Bing；
删「主页」设置；点收藏=已开则聚焦；收藏折叠态持久化；新标签瓦片=书签栏前 N 个收藏；导入重名文件夹
加后缀不合并+toast 报净新增。同日更早定稿：收藏=左侧栏折叠区（置顶上方、默认收起）、网页态无网页头、
砍剪藏/下载/阅读模式（§12，别加回来）。
**怎么 apply**：做真 app 浏览器移植的 session：唯一契约是 `docs/browser-feature-spec.md`（§14 验收清单
逐项打勾、§11 安全不变式一条不许松）。⚠ worktree `wordspace-next-browser`（feat/browser-tabs，PR #132）
停在多轮 UX 定稿之前——web-tabs.js 地基可复用，但其网页头/旧收藏形态不要照搬。ui-demo 侧改浏览器
行为 → 改正本 + 同 PR 落实进 ui-demo（正本=可执行定义）。
**来源**：PR #150（docs/browser-spec-v2）、docs/browser-feature-spec.md §13/§15、Colin 拍板 2026-07-10


## 2026-07-10 — 分页文档 ui-demo 定型合 main；真 app 移植契约在 docs/features/paged-doc.md，schema2 worktree 旧实现作废

**是什么**：分页文档（Word 式：统一 A4 页高、超高块带留白分页、可编辑表格/代码、编辑稳定）在 ui-demo
定型并合 main（PR #151）。经历多轮翻车后定型的 V4 实现有四条铁则（回车分裂继承推挤样式→清理必须
选择器全量扫荡；灰缝锚定实测推挤位置而非几何网格；同帧扫荡→测量→重推；覆盖层坐标原点=纸 padding 盒），
全部写进 docs/features/paged-doc.md（行为契约+文件映射+欠账）。
**怎么 apply**：要做真 app 分页移植的 session：唯一契约是 docs/features/paged-doc.md。⚠ worktree
`wordspace-next-schema2`（分支 feat/schema-2-paged）里的真 app 实现是旧口径（独立 Schema 2 + 画线、
无留白），已作废——移植前必须按 spec 改造：删 schema-2 descriptor（分页=Schema 1 可选版式设置，
Colin+Wendi 拍板）、分页引擎按 V4 铁则重写。别直接续用旧 worktree 代码。验证抄
ui-demo/scripts/verify-paged-v4.mjs 的断言口径（页界真空带/页高统一/编辑不累积/数据零污染）。
**来源**：PR #151（feat/ui-demo-paged-gaps）、docs/features/paged-doc.md

## 2026-07-10 — ⚠ /remember-global 的「直推 main」路径已被分支保护封死

**是什么**：main 的 branch protection 现在含「Changes must be made through a pull request」，管理员
账号直推也被拒（GH006）。/remember-global skill 文档里「唯一允许直推 main」的特权路径实际不可用。
**怎么 apply**：写 team-memory 暂时走「短命分支 + PR + CI + merge」；skill 文档与保护规则的冲突
待 Colin 拍板（要么给 bypass、要么改 skill 文档）。
**来源**：本条目落账过程实测（2026-07-10）


## 2026-07-10 — 跨 session 对齐体系上线（本文件 + 3 个 skill）

**是什么**：新增 `docs/team-memory.md`（本文件）、`docs/features/` 对齐 spec 体系、三个仓库级
skill：`/sync-main`（拉取并消化 main 增量）、`/remember-global`（写公告到这里）、
`/align-feature`（ui-demo ↔ 真 app 按 feature audit/port）。
**怎么 apply**：各 session 从此用 `/sync-main` 替代「人肉转述 main 有什么新东西」；发现全局教训用
`/remember-global` 落账；直改真 app UI/交互时必须同 PR 更新 `docs/features/` 对应 spec 或记欠账
（规则已进 CLAUDE.md）。存量分支要 rebase 到 main 之后才有这三个 skill。
**来源**：`feat/alignment-skills`，需求文档 `docs/brainstorms/2026-07-10-session-alignment-system-requirements.md`。
