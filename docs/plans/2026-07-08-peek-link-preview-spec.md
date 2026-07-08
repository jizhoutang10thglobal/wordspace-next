# Spec(draft·待排期):Peek 外链浮层 + 「存为文档」出口

> 状态:**draft,等 Colin/Wendi 拍板排期**。出处 = Arc UX 调研(docs/design/2026-07-08-arc-ux-research.md)判定表「改造着抄」头号项;Colin 2026-07-08 已认可方向。前置:feat/browser-tabs(PR #132)合并。

## 一句话

文档里点外部链接 → 不跳系统浏览器、不污染标签区,弹一个居中浮层原地看 → 三个出口:**Esc 走人**(零残留)/ **存为文档**(剪藏落盘进文件树)/ **在标签打开**(升级成正式网页标签)。

## 为什么(产品理由)

- 把 Arc 的 Little Arc + Peek + Auto-Archive 三件套收敛成**一个零新名词的手势**——弹层、Esc、保存全是旧动作。
- 「浏览为文档服务」的临门一脚:文档里引的资料链接,看一眼→值得留就变成自己的文档。我们的「留下」(落盘可编辑)比 Arc 的(钉标签)强。
- 现状痛点:文档里点链接要么被 CSP/sandbox 拦死要么全无出口,资料链接是死的。

## UX 细节

- **触发**:块编辑器/基础编辑器里 Cmd+点击(或普通点击?——**待拍板①**:普通点击=Peek 更顺手但改变现有"链接不可点"预期;建议普通点击直接 Peek)外部 http(s) 链接。
- **浮层**:居中卡片(纸方墨圆:surface 白卡+hairline 边+pop 进场),占视口 ~80%×85%;顶部一条迷你 chrome:锁标+标题+域名 | 「存为文档」「在标签打开」「×」。
- **退出**:Esc / 点浮层外 = 关闭,**不留任何标签/历史?——待拍板②**:建议进历史(能 Cmd+P 找回)但不建标签。
- **升级**:「在标签打开」= 现有 openWebTabUrl(浮层关、标签区多一项);「存为文档」= 现有 Readability 剪藏管线原样复用。
- 浮层内导航:允许站内跳转(同现有守卫),前进后退不做(要完整浏览就升级成标签)。

## 架构草图(直觉,不锁实现)

- 复用 web-tabs.js 的 WebContentsView 管线:新 view 类型 `peek:<seq>`,同 persist:webtabs session/同安全边界(零 preload/默认拒权限/file:// 封死),**不进 tabState、不持久化**。
- 浮层 = 父层 DOM 卡片 + native view 按卡片内容区 setBounds 盖上(同 #web-viewport 的 bounds 套路);卡片 chrome(标题/按钮)是父层 DOM,在 view 外圈,不会被盖。
- 链接拦截 seam:块编辑器/basic-edit 的链接点击处(iframe 内)→ postMessage/桥到 shell → openPeek(url)。iframe sandbox 无 allow-popups,现状点击本就被拦,新增的是"拦住之后有去处"。
- 与既有浮层互斥(sb-modal-overlay 开着不 Peek);Peek 开着时 anyOverlay 口径要把它算进去(快捷键别穿透——AI modal 的教训)。

## 单元切分(估 1-2 周)

- U1 openPeek/closePeek 生命周期 + bounds 管理 + Esc/点外关闭(e2e:开/关/不残留 view)
- U2 文档内链接点击桥(块编辑器 + 基础编辑器两处 seam;e2e:点文档里链接→浮层现)
- U3 迷你 chrome(锁/标题/域名实时更新——复用 pushUpdate 镜像)+ 两个升级出口(e2e:存为文档真落盘;在标签打开真建标签)
- U4 互斥与快捷键口径(变异自检:Peek 开着 Cmd+W 不关背后标签)
- U5 收尾:历史口径拍板落地 + 冒烟/文档

## 待拍板

① 触发方式:普通点击 vs Cmd+点击。② Peek 过的页面进不进浏览历史(建议进)。③ 浮层里再点外链:原地导航(建议) vs 套娃新 Peek(不建议)。
