# 视觉 rubric —— 从 `docs/style.md` 提炼的可证伪检查项

视觉判官用这份清单判样式。**每条都是「一个懂行设计师会一眼指出的、且能被机器/截图证伪的具体检查」**,不是泛泛品鉴。出处:`docs/style.md`(Wendi 冻结的官方设计语言「纸方墨圆」)。实证依据:裸 prompt 泛泛品鉴 UX 准确率只有 ~20%;收窄成逐条可证伪检查项才到人类水平(Baymard 方法论)。

## 怎么用

1. **按 component 标签过滤**:只跑跟被审 feature 相关的条目(审新建弹窗 → 跑 `modal`/`全局`/`controls`,不跑 `editor`)。
2. **按物料类型取证**:
   - `computed` = 从 DOM computed-style 快照判(确定性,最硬);
   - `screenshot` = 从截图观感判(judge 看图);
   - `interaction` = 需要 hover / focus / reduced-motion 状态的采集(采证时要专门抓这些态;静态截图验不了)。
3. **pairwise 只做「同界面亮 vs 暗」**——不给单个界面打绝对分(实证:pairwise 远好过绝对打分)。
4. **判到违反** → 交给行为判官同样的 finding 流程(定 P 级、进对抗验证)。

## 收录原则(改这份清单前先读)

- **拿不准可证伪性的不收**——没有明确判据的条目就是误报机器,宁缺毋滥。
- **已有确定性门的不重复收**:暗色**文本对比度**已由 `e2e/appearance.spec.js` + `test/appearance-contrast-pairs.js` 的 WCAG 遍历硬门保住——**rubric 不再判对比度**,重判只在已被保护的地方造误报面。
- 每条必带:判据(具体到值 / 几何 / 可见性)+ 物料类型 + component 标签。

---

## 检查项

### 形(纸方墨圆)

**R1 · 圆角语义** — `computed` · `全局`
- **pill 类控件**(按钮 / 开关 / 分段 / chip / 标签——**小尺寸、行内的可点控件**)`border-radius` 应 ≈ 999px(全圆丸)。
- **容器**(card / menu / modal / 输入框 / **可点的选择卡片**,如模板卡、范式卡)应是小圆角 5–10px(`--r-sm 5` / `--r-md 7` / `--r-lg 10`)。
违反:pill 控件用了小圆角、或容器/卡片用了全圆丸(圆角语义反了)。
⚠ **判据看视觉角色,不看 tag**:别因为一个元素是 `<button>` 就要求它 pill——**卡片形状的可点选项(选择卡)语义上是「纸」,正确用 5–10px**(实测:新建弹窗的模板卡 / 范式卡都是 `<button>` + 7px,是对的,不是违反)。

**R2 · 卡片 / 控件零阴影** — `computed` · `全局`
非浮层元素(card / 标签页 / segmented / 选中态 / 输入框 / 按钮)`box-shadow` 应为 `none`。
违反:任何卡片 / 控件带 `box-shadow`(尤其按钮的 `0 2px 0` 脚投影 / letterpress、inset 纹理阴影)——style.md 明令删除。

**R3 · 浮层有层分离** — `computed` · `modal` `menu`
真浮层(菜单 / 弹窗 / toast / 命令面板)应有一层淡阴影(`--shadow-menu/pop/modal`)+ 1px 细边。
违反:浮层零阴影零边(和底下内容分不清)。注意这条与 R2 是一对:非浮层禁阴影、浮层必须有。

### 色

**R4 · primary 按钮是墨不是蓝** — `computed` · `controls`
主按钮 `background` 应为墨色(亮态 `--c-ink` ≈ `#1C1917`);accent 蓝(`#1D6FBF`)只出现在链接 / 选中 tint / 焦点圈,**不做大面积按钮底**。
违反:主操作按钮是蓝底。

**R5 · 输入框凹进纸里** — `computed` · `input`
输入框应 sunken 底色(`--c-bg-sunken`)、无边框、无 inset 阴影。
违反:输入框带 1px 边框或 inset 阴影(不是「凹进」而是「框起来」)。

**R6 · 暗态投影不发光** — `computed` · `全局(dark)`
暗色主题下,浮层 `box-shadow` 的颜色应是**深黑透明**,绝不是亮色 / 彩色 glow;也不应借暗态给元素加发光。
违反:暗态任何元素的 shadow 是亮色 / 带色相 / 明显 glow。

### 假纸 slop(负向检查)

**R7 · 无露边叠纸 / 假纸装饰** — `screenshot` · `modal` `menu`
弹窗 / 菜单 / toast 背后**不应有**露边的「一沓纸」叠层、垫斜纸、装饰性纹理(`--stack` 已删除,读作廉价 AI slop)。
违反:浮层背后能看到偏移的假纸边 / 斜纸。

### 动(动是反馈不是装饰)

**R8 · 焦点是圈选不是发光** — `interaction` · `全局`
键盘 focus(Tab 到可交互元素)`:focus-visible` 应是 2px 墨青蓝外圈 + 3px offset(输入框例外 = 从左划过的墨线);**不是模糊 glow**。
违反:焦点态是模糊光晕 / 没有可见焦点环 / 焦点环是别的颜色。物料:采证要 Tab 聚焦后截图 + 读 computed `outline`/`box-shadow`。

**R9 · hover 有可见反馈** — `interaction` · `controls` `menu`
可交互元素(按钮 / 菜单项 / 文字钮 / 列表行)hover 时底色 / 颜色应有可见变化(菜单项是墨条从左滑入)。
违反:hover 无任何视觉反馈(用户不知道这里可点)。物料:采证要 hover 后读 computed `background` 前后对比。

**R10 · 动效时长在阶梯内** — `interaction` · `全局`
关键交互元素的 `transition-duration` / `animation-duration` 应落在 token 阶梯:80 / 120 / 200 / 320 / 420ms(`--dur-instant/fast/(base)/slow/page`)。
违反:出现明显阶梯外的时长(如 600ms 拖沓、或 30ms 生硬)。**只查关键交互元素,别全量扫**(全量必噪)。物料:读关键元素 computed transition。

**R11 · 尊重 reduced-motion** — `interaction` · `全局`
`prefers-reduced-motion: reduce` 下,位移 / 缩放动画应关闭(留极短透明度)。
违反:reduced-motion 下仍有明显位移 / 缩放动画。物料:采证用 Playwright `emulateMedia({ reducedMotion: 'reduce' })` 后触发一次动画看有没有位移。

### 编辑感排版(仅内容页)

**R12 · 眉标 / 大标题气质** — `screenshot` · `content-page`
内容页(有大标题的页,如起始页 / 模板库)标题上方的眉标(kicker)应是等宽字体 + 宽字距 + 大写 + 次要色;大标题自信(28px/700)、无衬线;标题区下方一条 hairline。
违反:内容页标题挤成工具感(无眉标 / 无刊头节奏)、或误引了衬线字 / 加了纸纹理。**只在被审 feature 是内容页时跑**。

---

## 不收的(说明,免得后人重加)

- **文本对比度** —— 已有确定性硬门(见「收录原则」),不重判。
- **具体 token 十六进制值是否精确** —— 那是 CSS 正本的事,不是 taste 判断,且易漂移。
- **「整体好不好看」的绝对打分** —— 实证不可靠;只做 pairwise 亮暗对照。
