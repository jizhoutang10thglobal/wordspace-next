# Wordspace 设计基调(canonical · 官方设计标准)

> **拍板:Wendi,2026-07-06 冻结为 Wordspace 正式设计语言。** 出处:主题方案 A
> 「纸感暖白」v2「纸方墨圆」(草案存档 `docs/design/proposal-a2-bold.html`)。
> Wendi 反馈落实:**删除「模拟纸张堆叠」**(弹窗背后微倾斜假纸 + 菜单/toast 露边叠纸——
> 读作 AI slop),层级改由干净的 elevation 阴影表达;并**把动效提为一等公民**(§4 扩写)。
> **约束:ui-demo 与真 app(`src/**`)的前端样式都依据本文件;要改样式,先改这里。**
> token 的机器可读实现:`ui-demo/src/styles/tokens.css`(真 app 移植时以它为准复制值)。

## 0. 一句话

**纸方墨圆,按了会陷,动有物理。** 界面是暖白的纸,文字是墨;
承载内容的「纸」(卡片/菜单/弹窗/面板)保持微圆角,所有可交互的「墨」
(按钮/开关/分段控件)一律全圆丸——可点的和可读的,一眼分开。

五条设计观点:

1. **纸方,墨圆**——容器小圆角(5–10px),控件全圆丸(999px)。圆角即语义。
2. **层级靠干净的 elevation,不靠边框、不靠假纸**——浮起的东西(菜单/弹窗/toast)
   用两层暖墨阴影(近处硬边 + 远处软晕)表达高度;边框大幅退场,留白与层差接管分隔。
   ⚠ **禁止**用露边叠纸(`--stack`)或背后垫微倾斜的纸模拟"一沓"——那读作廉价 AI slop
   (Wendi 2026-07-06 明令删除)。要"厚"用阴影,不用假纸。
3. **按了会陷(letterpress)**——按钮 hover 抬 1px、按下沉 1px,脚下硬投影同步伸缩;
   kbd 键帽同理。位移只有 1–2px,但手指能感觉到。
4. **焦点是圈选,不是发光**——全站 `:focus-visible` = 2px 墨青蓝外圈 + 3px offset,
   像在纸上圈重点;拒绝模糊 glow。输入框例外:焦点表达 = 一根从左划过的墨线。
5. **hover 语汇统一为「墨条滑入」**——菜单项/文字钮的底色从左缘 0%→100% 滑入,
   不是瞬间变色。

外加一条贯穿全局的原则:**动是反馈,不是装饰**(见 §4)。每一次状态变化都该被一个
有物理感的动画交代清楚——东西从哪来、到哪去、是"落定"还是"撤走"。绝不为炫技加动;
但该有的反馈一个都不能少,这是"高级感"与"AI slop"的分水岭。

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

## 3. 形:圆角 · 投影(elevation)

圆角:`--r-sm 5px`(列表行/菜单项)、`--r-md 7px`(输入框)、`--r-lg 10px`(弹窗/卡片)、
`--r-pill 999px`(一切可点的控件)。

投影是**唯一**的层级语言(不用假纸)。五档,全部暖墨基底、都是"近处硬边 + 远处软晕"两层:

| token | 用途 |
|---|---|
| `--shadow-xs` | 卡片静置(桌上的纸) |
| `--shadow-sm` | 卡片 hover 抬起 |
| `--shadow-menu` | 下拉/右键菜单浮起 |
| `--shadow-pop` | 命令面板 / toast(更高一档,带一圈极淡描边定形) |
| `--shadow-modal` | 弹窗(最高) |

⚠ 已删除 `--stack` / `--stack-float`(露边叠纸)——不要再引用,不要再造"一沓纸"效果。

## 4. 动效与手感(一等公民)

**原则**:动是反馈不是装饰;有物理感、方向一致、可被打断、尊重 reduced-motion。
"高级"来自克制而精确的动,"AI slop"来自要么不动、要么乱动。

时长阶梯(token 见 `tokens.css`):

| 档 | 值 | 用在 |
|---|---|---|
| `--dur-instant` | 80ms | 微反馈:按压、勾选、图标态切换 |
| `--dur-fast` | 120ms | 颜色变化、小位移、kbd 下沉 |
| `--dur` | 200ms | 墨条滑入、tooltip、switch 滑块、hover 抬起 |
| `--dur-slow` | 320ms | 输入框墨线划过、浮层入场、抽屉滑出 |
| `--dur-page` | 420ms | 路由/视图切换的编排级动画 |

曲线:`--ease`(标准)、`--ease-enter`(入场,快起慢收=落定)、`--ease-exit`(退场,直接撤走)、
`--ease-spring`(回弹,只给 switch 滑块/关闭钮/盖章式反馈)、`--ease-smooth`(对称,折叠展开/拖动)。

动效库(keyframes 在 `styles/global.css`,命名 `ws-<动作>`):`ws-view-in`(视图入场)、
`ws-pop-in/out`(浮层)、`ws-slide-up`(toast/底部抽屉)、`ws-slide-in-right`(右抽屉)、
`ws-toast-in/out`、`ws-stagger-in`(列表逐项)、`ws-reveal-down`(树展开)、`ws-overlay-in`(遮罩)、
`ws-check-draw`(勾选描线)、`ws-ring-pop`(焦点圈一下)、`ws-shimmer`(骨架)、`ws-pulse`(保存脉冲)。
工具类:`.ws-anim-view` / `.ws-anim-pop` / `.ws-skeleton`。

**该动的清单**(落地基线,别少):浮层入场/退场;弹窗遮罩淡入 + 卡片落定;toast 侧滑入带回弹;
路由切换视图入场;侧栏树展开/折叠;列表首次渲染 stagger(≤6 项,超过则关);标签页切换/开关;
按钮 letterpress;hover 墨条滑入;输入框焦点墨线;switch/勾选描线;骨架/加载态。
**尊重** `prefers-reduced-motion: reduce`——全站已在 global.css 兜底(关位移/缩放,留极短透明度)。

## 5. 组件配方(实现以 `ui-demo/src/styles/controls.css` 为准)

- **按钮**:全部 pill。primary = 墨底 + `0 2px 0` 硬脚投影;secondary = 纸底 + 强边 +
  同款脚;hover 抬 1px 脚变 3px,active 沉 1px 脚归零;ghost = 无边无脚,墨条滑入。
- **输入框**:凹进纸里(sunken 底 + inset 投影,无边框),focus 时底变白 + 2px 墨青蓝
  墨线从左划到右(320ms enter),**不加批注圈**。错误态:底变 danger-wash + 墨线变红。
- **弹窗**:白纸 + `--shadow-modal`,10px 圆角,`overflow:hidden`;入场 = 遮罩淡入 + 卡片
  `ws-modal-pop`(上移 10px+缩放 0.975 落定,`--dur-slow`/enter);× 按钮 hover 旋转 90°(spring)。
  **不垫假纸**。
- **菜单/右键菜单**:白纸圆角 + 1px 细边 + `--shadow-menu`;入场 `ws-pop-in`;菜单项 hover
  墨条滑入(danger 项同滑入、只换 tint 色)。
- **命令面板**:白纸圆角 + `--shadow-pop`;入场 `ws-pop-in`;搜索行聚焦墨线。归浮层族。
- **toast**:书签纸条——左侧 4px 语义色条 + `--shadow-menu`(hover `--shadow-pop` 抬 2px);
  入场 `ws-toast-in`(侧滑带回弹),退场 `ws-toast-out`。
- **tooltip**:墨底白字,hover 延迟 400ms 浮现(200ms enter)。
- **kbd**:键帽——`border-bottom-width 2px`,按下变 1px + 沉 1px。
- **switch**:track 圆丸,on = 墨底;滑块 spring 滑动,按住时滑块拉宽(蓄力感)。
- **segmented**:sunken 圆丸槽 + 选中项白纸浮起(浮起用 `--dur`/spring 微弹)。
- **焦点**:全站 `:focus-visible` 批注圈(见 §0-4);输入框例外。

## 6. 落地与对齐

- ui-demo:`styles/tokens.css`(token)→ `styles/controls.css`(共享控件,单一来源,
  **别在组件 CSS 里重新声明 `.ws-btn`/`.ws-input`/`.ws-modal`**)→ 组件 CSS 只写布局
  与组件特有样式,颜色/圆角/动效必须走 token,新硬编码色值一律不收。
- 真 app(`src/renderer/**`):按本文件移植(独立 PR);token 值直接复制
  `tokens.css`,类名体系可不同,配方与手感必须一致。
- 改基调 = 改本文件 + `tokens.css`/`controls.css` 同 PR;两边(ui-demo/真 app)
  谁跟进滞后,以本文件为准。
