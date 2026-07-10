# docs/features/ — ui-demo ↔ 真 app 的 feature 对齐 spec

ui-demo（`ui-demo/**`）和真 app（`src/**`）要保持 UI/UX/交互一致：feature 先在 ui-demo 定稿、
再移植进真 app（Colin 拍板的开发流程）；app 上实测反馈的修改也要能回流 ui-demo。
对齐不靠「去看两边界面长什么样」，靠这里的 spec——它承载代码表达不了的两样东西：
**交互意图**（为什么这么设计、状态与边界情况）和**有意分歧清单**（哪些差异是拍过板的，不算漂移）。

配套 skill：`/align-feature`——audit 模式出漂移报告，port 模式按方向移植，没有 spec 时先生成。
先例：[`../browser-feature-spec.md`](../browser-feature-spec.md)（浏览器 feature，这套模式的原型，留在原位）。

## 什么时候建 spec

- 新 feature 在 ui-demo 定稿、准备移植进真 app 时（port 的第一步就是写 spec）。
- 老 feature 下次被碰到（改动/对齐）时按需补，不搞一次性回填。
- 直改了真 app 的 UI/交互但对应 spec 还不存在：至少建一个只有「欠账」一行的占位 spec。

## 模板

每份 `docs/features/<slug>.md` 必含以下四段（可按 feature 增段，不可少段）：

```markdown
# <Feature 名> —— 对齐 spec

## 行为契约
用户可感知的一切：布局、文案、交互时序、快捷键、状态、边界情况。
写「行为」不写「实现」——两侧技术栈不同（React/Vite vs Electron 原生 DOM），抄行为不抄代码。

## 文件映射
| 维度 | ui-demo | 真 app |
|---|---|---|
| <子模块> | `ui-demo/src/...` | `src/renderer/...` |

## 有意分歧
两边故意不同的地方。每条：差异内容 + 谁拍的板 + 日期。
**不在这个清单里的行为差异都算漂移。**

## 对齐锚点
- ui-demo 侧：commit `<sha>`（YYYY-MM-DD）
- app 侧：commit `<sha>`（YYYY-MM-DD）
锚点 = 上次两侧确认对齐时各自的 commit，只在一次对齐（port 合并）完成时更新。

## 欠账
（可选段）已知未对齐、待 port 的项。谁产生的漂移谁记账，port 完成后清掉。
```
