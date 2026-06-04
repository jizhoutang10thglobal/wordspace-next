<!--
  wordspace-next-demo · 意图卡片模板（gate ①）
  ──────────────────────────────────────────────
  源：projectx-board/pm/templates/spec-intent-template.md。
  人类版的意图卡只装"AI 猜不出、只有人能定的产品意图"，是 spec 起草前的锁。
  demo 版把它**升格成 gate ①**：run-spec.sh 开跑前 `cat` 这张卡片、等人按 y 确认，
  确认后人就走开。所以它既是"产品意图锁"，也是"无人值守前的最后一个人类确认点"。

  相对人类版的调整：
    - 把"核心用户时刻"换成"要 AI 自动做什么（一句话）"——读者从"起草 spec 的 PM"变成"现场按 y 的人"。
    - "成功长什么样"换成三件可见实物（PR / 绿门 / macOS 能用）+ compound 实物。
    - 加一行"运行方式"，并以"确认意图？继续请按 y。"收尾。

  存 specs/<slug>.intent.md。一屏封顶。实例 commit 前删本 HTML 注释。
-->
---
spec: <slug>.md
role: 意图卡片（demo gate ① · 现场给人确认用）
---

# 意图卡片 · Spec N：<标题>

**要 AI 自动做什么（一句话）**
[这个 run 让 AI 建出 / 改出什么。用户视角，一句话说清。]

**为什么先做这个 / 它长在哪**
[一句话：它在产品里的价值，或它依赖哪条已建好的 spec 骨架。]

**边界（做 / 不做）**
- ✅ 做：[必做项，具体到用户能看见 / 能操作什么；含"教训写进 CLAUDE.md"这条 compound 交付物]
- 🚫 不做：[砍掉的项 —— 若是某 projectx feature 的收窄版，把砍掉的大维度列全]

**"做完"长什么样（三件可见实物）**
1. PR 开好（容器内自动 push + `gh pr create`）。
2. 权威门绿：容器内 `npm test`（Vitest 快门）退出码 0[，含某条核心断言]；CI 上 e2e job（xvfb 真跑）也绿，确认 app 真能打开。
3. feature 真能用：你在 Mac 上 `npm start`，[看到 / 能做什么]。
4. 学到东西：`CLAUDE.md` 多出一段本 run 的环境教训（git diff 可见）——下一条 spec 自动吃到，这是 compound 实物。

**运行方式**
隔离 dev container 内、`claude -p /lfg` 无人值守跑；确认意图后你走开，AI 自己 plan → work → 测试 → 开 PR。

---

确认意图？继续请按 **y**。

<!-- 如有"真窗口视觉验证只能在 macOS 现场做、容器无屏幕"这类提醒，可在此加一行括注。
     注：app 能否打开由 CI 上 xvfb 跑的 e2e 真门把关，不靠人肉眼。 -->
