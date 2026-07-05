# Wordspace 设计基调(canonical)

> 拍板:Colin,2026-07-05。出处:主题方案 A「纸感暖白」v2「纸方墨圆」
> (交互规范页存档于 `docs/design/proposal-a2-bold.html`,可直接浏览器打开摸交互态)。
> **约束:ui-demo 与真 app(`src/**`)的前端样式都依据本文件;要改样式,先改这里。**
> token 的机器可读实现:`ui-demo/src/styles/tokens.css`(真 app 移植时以它为准复制值)。

## 0. 一句话

**纸方墨圆,按了会陷,叠了有边。** 界面是暖白的纸,文字是墨;
承载内容的「纸」(卡片/菜单/弹窗/面板)保持微圆角,所有可交互的「墨」
(按钮/开关/分段控件)一律全圆丸——可点的和可读的,一眼分开。

五条设计观点:

1. **纸方,墨圆**——容器小圆角(5–10px),控件全圆丸(999px)。圆角即语义。
2. **层级靠纸的物理,不靠边框**——菜单/toast 底下露出真实的叠纸边(shadow-stack),
   弹窗背后垫微倾斜的纸;边框大幅退场,留白与层差接管分隔。
3. **按了会陷(letterpress)**——按钮 hover 抬 1px、按下沉 1px,脚下硬投影同步伸缩;
   kbd 键帽同理。位移只有 1–2px,但手指能感觉到。
4. **焦点是圈选,不是发光**——全站 `:focus-visible` = 2px 墨青蓝外圈 + 3px offset,
   像在纸上圈重点;拒绝模糊 glow。输入框例外:焦点表达 = 一根从左划过的墨线。
5. **hover 语汇统一为「墨条滑入」**——菜单项/文字钮的底色从左缘 0%→100% 滑入,
   不是瞬间变色。

## 1. 色 token(stone 暖灰阶 + 墨 + 墨青蓝)

| token | 值 | 用途 |
|---|---|---|
| `--c-bg` | `#FFFFFF` | 文档纸面 |
| `--c-bg-chrome` | `#FAFAF9` | 标题栏/标签条(stone-50) |
| `--c-bg-sunken` | `#F5F5F4` | 侧栏等下沉面板(stone-100) |
| `--c-bg-rail` | `#EDECEB` | 最左图标轨 |
| `--c-surface` | `#FFFFFF` | 卡片/菜单/弹窗 |
| `--c-border` / `-strong` | `#E7E5E4` / `#D6D3D1` | 细边 / 强边 |
| `--c-divider` | `#EFEDEB` | 分隔线 |
| `--c-text` / `-2` / `-3` | `#292524` / `#57534E` / `#A8A29E` | 正文 / 次要 / 占位 |
| `--c-ink` / `-hover` | `#1C1917` / `#292524` | **墨色控件底**(primary 钮/switch on/tooltip) |
| `--c-accent` | `#1D6FBF` | 墨青蓝:链接/选中 tint/焦点圈。**不做大面积底色** |
| `--c-hover` / `--c-active` | `rgba(28,25,23,.05)` / `.09` | hover / 按下底色(墨的透明度,不是灰) |
| `--c-success` / `warn` / `danger` | `#15803D` / `#B45309` / `#B91C1C` | 语义色(饱和度压低的「印章色」) |

原则:**primary 按钮是墨不是蓝**。蓝只出现在"指出去"的东西上(链接/选中/焦点)。
投影一律用暖墨基底 `rgba(28,25,23,·)`,禁止冷黑 `rgba(0,0,0,·)`。

## 2. 字与排版

UI 字体:系统栈(`-apple-system … "PingFang SC"`);等宽(kbd/数字/代码):`--font-mono`。
UI 字号阶梯 11/12/13/14/15/18/22,正文 13px 行高 1.5。
**文档区排版不归本文件管**——那是 Schema baseline v2(`src/editor/blockedit.js` 的
`BASELINE_CSS`,16px/1.75/820px),两者气质对齐但各自为政:UI 是工具,文档是纸。

## 3. 形:圆角 · 投影 · 叠纸边

圆角:`--r-sm 5px`(列表行/菜单项)、`--r-md 7px`(输入框)、`--r-lg 10px`(弹窗/卡片)、
`--r-pill 999px`(一切可点的控件)。
投影四档 `--shadow-xs/sm/menu/modal`,全部暖墨基底。
**叠纸边** `--stack` / `--stack-float`:用多层 0-blur 投影在元素底下画出两张露边的纸,
给菜单/toast「一沓纸」的厚度;浮起时用 `-float` 变体。

## 4. 动效与手感

三档时长 + 四条曲线(token 见 `tokens.css`):

| 档 | 值 | 用在 |
|---|---|---|
| `--dur-fast` | 120ms | 按压/颜色变化/kbd 下沉 |
| `--dur` | 200ms | 墨条滑入/tooltip/switch 滑块/弹窗 pop |
| `--dur-slow` | 320ms | 输入框墨线划过/入场 |

曲线:`--ease`(标准 `cubic-bezier(.2,0,0,1)`)、`--ease-enter`(入场)、
`--ease-exit`(退场)、`--ease-spring`(`(.34,1.56,.64,1)`,只给 switch 滑块、
弹窗 × 旋转这类"小而弹"的瞬间)。
尊重 `prefers-reduced-motion`(移植真 app 时补 media query 兜底)。

## 5. 组件配方(实现以 `ui-demo/src/styles/controls.css` 为准)

- **按钮**:全部 pill。primary = 墨底 + `0 2px 0` 硬脚投影;secondary = 纸底 + 强边 +
  同款脚;hover 抬 1px 脚变 3px,active 沉 1px 脚归零;ghost = 无边无脚,墨条滑入。
- **输入框**:凹进纸里(sunken 底 + inset 投影,无边框),focus 时底变白 + 2px 墨青蓝
  墨线从左划到右(320ms enter),**不加批注圈**。错误态:底变 danger-wash + 墨线变红。
- **弹窗**:白纸 + `--shadow-modal`,10px 圆角,背后垫两张微倾斜的纸(::before/::after 叠纸,「叠了有边」);× 按钮 hover 旋转 90°(spring)。
- **菜单/右键菜单/命令面板**:白纸圆角 + 1px 细边 + `--stack-float` 叠纸边;菜单项 hover 墨条滑入(danger 项同滑入、只换 tint 色)。命令面板归菜单族,不用弹窗投影。
- **toast**:书签纸条——左侧 4px 语义色条 + `--stack` 叠纸边。
- **tooltip**:墨底白字,hover 延迟 400ms 浮现(200ms enter)。
- **kbd**:键帽——`border-bottom-width 2px`,按下变 1px + 沉 1px。
- **switch**:track 圆丸,on = 墨底;滑块 spring 滑动,按住时滑块拉宽(蓄力感)。
- **segmented**:sunken 圆丸槽 + 选中项白纸浮起。
- **焦点**:全站 `:focus-visible` 批注圈(见 §0-4);输入框例外。

## 6. 落地与对齐

- ui-demo:`styles/tokens.css`(token)→ `styles/controls.css`(共享控件,单一来源,
  **别在组件 CSS 里重新声明 `.ws-btn`/`.ws-input`/`.ws-modal`**)→ 组件 CSS 只写布局
  与组件特有样式,颜色/圆角/动效必须走 token,新硬编码色值一律不收。
- 真 app(`src/renderer/**`):按本文件移植(独立 PR);token 值直接复制
  `tokens.css`,类名体系可不同,配方与手感必须一致。
- 改基调 = 改本文件 + `tokens.css`/`controls.css` 同 PR;两边(ui-demo/真 app)
  谁跟进滞后,以本文件为准。
