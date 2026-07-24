# 采证 playbook —— 怎么开真 app、批式驱动、取证据(占机最短)

把上一轮 AI 探索测试(`docs/plans/bug-hunt-2026-07-14/`,真 app Playwright 驱动、每 bug 复现 ≥2 次)的方法论沉进 git,免得再散佚在 scratchpad。**目标:占机最短**——只有脚本真跑那几十秒占机,思考全程关 app。

## 占机纪律(硬约束,别破)

- **app 实例 ≤2 个**,各用独立 `WS2_USERDATA`(别碰 Colin 已装的 app 数据)。
- **采证段** app 累计开着 **≤15 分钟**;**对抗验证段 ≤10 分钟**;全程占机 **≤25 分钟**。到点截断,报告标「采证不完整」。
- **批与批之间、段与段之间 app 必关**。LLM 计划下一批 / 判官评审 / 写报告时,**不许挂着实例**。
- CDP 注入不抢真实键鼠焦点(窗口弹在桌面但 Colin 能继续用电脑);验证段要再开 app 时**先告知 Colin**。

## 批式驱动循环(LLM 不进驱动环)

传统 agentic(每步等模型想 30 秒、app 干挂着)会长时间占机。改**批式**:

1. **计划一批**(LLM,app 关着):想好这一批要跑的一串操作 + 要采什么证据,写成一个 Playwright 脚本。
2. **一口气跑**(脚本,app 开着几十秒):脚本自己跑完整批,采证落盘,**结束即 `app.close()`**。
3. **复盘**(LLM,app 关着):读证据产物,决定下一批探什么 / 够了没。
4. 回到 1。默认 **2~3 批**封顶。

## 起 app(照抄 e2e/sidebar.spec.js,别发明)

```js
const { _electron: electron } = require('@playwright/test');
const ROOT = '<仓库根>';
const app = await electron.launch({
  args: ['--no-sandbox', ROOT],
  env: { ...process.env,
    WS2_LANG: 'zh',                 // 或 'en' 试英文态
    WS2_NO_CLOSE_DIALOG: '1',       // 关窗不弹确认
    WS2_USERDATA: '<独立临时目录>',  // 独立 profile
  },
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.setViewportSize({ width: 1280, height: 860 });
await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
// … 跑操作、采证 …
await app.close();   // ← 批结束必关
```

**打开工作区**(seed 一个临时工作区,经 `WS2_FOLDER_IN` seam):见 `e2e/sidebar.spec.js` 的 `seedWorkspace()` + `openWorkspace()`——`page.click('#home-open-folder')` 触发文件夹选择器(seam 返回你 seed 的目录)。
**冷启动直接开某文件**:`WS2_OPEN_FILE=<path>` 环境变量(`src/main/main.js:524`),或运行时 `webContents.send('open-file', path)`。
**触发菜单动作**(新建 / 关标签 / 查找 / 切主题…):
```js
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'new-tab'));
```
这走**直接 IPC,不需要 OS 窗口焦点**——是驱动加速器类操作的**唯一可靠路径**(见下伪影清单)。

## ⚠ 驱动器伪影清单(会造假 finding,血教训)

自动化驱动有已知盲区。**不认得它们 = 报一堆「app 坏了」其实是工具坏了,而且稳定复现、对抗验证还会盖章**——第一份报告混进这种假 P1,整个 skill 的信任就塌了。

1. **CDP 合成键盘不触发菜单加速器**(仓内实证:`e2e/todo-undo.spec.js` `todo-enter-split.spec.js` 顶部注释「keyboard Meta+z 不触发菜单加速器 = 假 FAIL」)。
   - `page.keyboard.press('Meta+z')` → 得到「⌘Z 不撤销」的**假 finding**。
   - **正确做法**:所有加速器类操作(撤销 / 重做 / 新建 / 关闭 / 查找 / 全选 …)走 `webContents.send('menu', '<action>')` seam,**不用 `keyboard.press` 打快捷键**。
2. **IME / 中文输入自动化驱动不了**(`docs/features/editor-cross-block-selection.md:42`「真 IME 只能真机验」)。
   - 涉及中文输入的预期 → 标「需真机手测」,**不下自动化结论**。`page.keyboard.type('中文')` 绕过 IME、不等于真实中文输入路径。
3. **OS 焦点依赖的行为在合成驱动下不可信**:blur 触发的保存 / 失焦关闭 / 系统级焦点切换——CDP 不抢真实焦点,这些态可能采不到或采错。存疑就标「需真机手测」。

**对抗验证第一步 = 排伪影**:任何涉及快捷键 / 焦点 / 中文输入的 finding,先换 menu seam 路径(或真机手测标记)重放一次;seam 路径下正常 = 伪影,杀。

## 采什么证据(落 scratchpad 证据目录)

证据目录结构(session 隔离,报告不引用它——只把 verified 的关键截图复制进 `docs/qa/assets/`):

```
<scratchpad>/audit-<slug>/
  shots/   截图:<状态>-light.png / <状态>-dark.png
  dom/     DOM + computed-style 快照:<状态>.json
  disk/    落盘字节:编辑动作后读的磁盘文件副本
  logs/    主进程 stdout、renderer console
```

- **双主题截图**:切主题走真实入口 `page.evaluate((p) => window.ws2.setAppearance(p), 'dark')`,等 `documentElement[data-theme]` 落定再截(见 `e2e/appearance.spec.js:33` `setTheme`)。每个关键状态**亮 / 暗各一张**(rubric R6 / pairwise 要)。
- **DOM / computed-style 快照**(rubric `computed` 类检查的物料):
  ```js
  await page.evaluate((sel) => {
    const el = document.querySelector(sel); if (!el) return null;
    const cs = getComputedStyle(el);
    return { borderRadius: cs.borderRadius, boxShadow: cs.boxShadow, background: cs.backgroundColor,
             border: cs.border, outline: cs.outline, transition: cs.transition };
  }, '<选择器>');
  ```
- **落盘字节**(后端判官的核心):编辑动作后读磁盘上的真实文件(`fs.readFile`),存进 `disk/`,交后端判官过 `node scripts/validate-schema.js <file>`。核对**写对了文件**(历史 P0:自动保存写进别的文件)。
- **console / 主进程报错**:`page.on('console', …)` 收 renderer 报错;`app` 的 stdout 收主进程报错。
- **rubric `interaction` 类物料**(hover / focus / reduced-motion,只在跑到相关 rubric 条目时采):
  - hover:`await page.hover('<sel>')` 后再读 computed background(前后对比 R9)。
  - focus:`await page.keyboard.press('Tab')` 聚焦后截图 + 读 computed outline(R8)。
  - reduced-motion:launch 时 `await page.emulateMedia({ reducedMotion: 'reduce' })`,触发一次动画看有没有位移(R11)。

## 探索剧本(行为判官的预期清单驱动)

采证不是乱点——**拿 Phase 1 的行为预期清单当剧本**:每条预期对应一个要跑的操作序列去验证它。外加通用探索:空态 / 满态 / 连续快速操作 / undo-redo 往返 / 键盘流 / 与相邻 feature 交界。每个要点采齐证据(截图 + 必要的 DOM / 落盘)。
