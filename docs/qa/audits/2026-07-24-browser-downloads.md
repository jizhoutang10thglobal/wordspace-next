# 审计报告 · 浏览器下载 — 2026-07-24

`/audit-feature` 第二跑。**探索性发现,非回归门**。该 feature 已有强 e2e(`e2e/web-downloads.spec.js` 8 条真下载 + 变异自检),本轮聚焦 e2e 之外的**安全边角 + UI 观感**。

## 范围与名字解析

- 输入「浏览器下载」→ 高置信解析:正本 `docs/browser-feature-spec.md` §4.11 → 真 app `src/main/web-tabs.js`(`will-download` 引擎)+ `src/lib/downloads.js`(uniquify/sanitize)+ `src/renderer/browser.js`/`browser.css`(进度环/popover/toast)+ `src/main/browser-store.js`(持久化)。
- 采证:真 app dev + 本地 http server(`/dl` 即时附件 / `/slowdl` 慢下载 / `/traversal` 恶意名 / `/weird` 非法字符)+ `WS2_DL_DIR`=tmpdir 零落盘 + `downloadURL` 触发(复用 e2e 套路)。
- 预期清单 70 条见 [`2026-07-24-browser-downloads-expectations.md`](2026-07-24-browser-downloads-expectations.md)。

## Finding(verified)

### P2 · 下载「正在下载」toast 盖住地址栏 URL

- **现象**:web 标签激活时触发下载,顶部弹出的「正在下载 big.bin」toast 钉在左上角,**盖住了地址栏 URL 的左半段**——本该显示 `http://127.0.0.1:64909/`,被 toast 遮得只剩「64909/」(对比空态 URL 完整)。见 assets `toast-covers-url.png`。
- **根因**:`browser.css` `.dl-toast { position: fixed; z-index: 397 }`——固定定位钉在左上,不避让地址栏。spec §4.11「侧栏开着=侧栏内紧凑 toast,锚下载图标下方、不顶网页」:它确实**没盖网页内容区**(起始页/网页正文清晰),但**盖了地址栏**(chrome 层)。
- **影响**:下载进行中用户看不全当前网址。toast 是短暂的(会自动消),覆盖的是 chrome 不是内容,所以是 P2 而非 P1。
- **非驱动伪影**:已排除——CSS `position: fixed` 定位实锤,不是截图偶发。
- **建议**:toast 择位避开地址栏(下移到地址栏之下,或锚在下载图标正下方且不与地址栏重叠)。

## 待核(需确定性层/真机确认,判官拿不准)

- **DL-2** 「清空记录」按钮圆角疑似小圆角矩形(~8-10px)而非全圆丸 pill(R1)——用的是共享 class,CSS 里没定死,需读 computed `border-radius` 确认;若真为小圆角则是 pill 语义小违反(P3)。
- **DL-3** 亮态 popover 层分离偏弱(近白 popover 叠近白页面,淡阴影不明显)——有 1px 细边不构成硬违反,需读 computed `box-shadow` 确认 `--shadow-pop` 是否真挂上。暗态正常。
- **行为待核(probe 未诱发的态)**:并发同名 uniquify / 无扩展名 / 多段扩展名(report.tar.gz)插入点、失败态 failed+重试、退出转 interrupted 重启读回、fileMissing 置灰、「清空记录」只清终态在途保留、无 Content-Length 时进度环表现、中途新增下载聚合分母是否回退。
- **安全待核**:砍下载对话框换来的攻击面——恶意网页能否无用户手势狂触发下载塞盘(spec 未写节流)。值得你拍。

## 需真机手测(自动化够不着)

- 中文文件名 + `Content-Disposition` RFC 5987(`filename*`)编码解码是否不乱码。
- 右键网页「存储图片 / 链接另存为」走同一管线(WebContentsView 右键 Playwright 难驱动)。
- 下载完**绝不自动打开**这条红线的 OS 级最终确认(代码已确认见下,真机再兜一眼)。

## 符合(逐条对照实测/代码通过)

**安全红线全守住**:
- **不覆盖**(P1):连下同名 → 磁盘 [evil.bin, evil (1).bin],不覆盖旧文件。
- **目录穿越防住**(P1):`../../../../pwned-TRAVERSAL.bin` → 落盘无害化、**未逃逸到上级/tmp**(Chromium `getFilename` 换 `/`→`_` + app `sanitizeFilename` 二次防护)。落盘名带 cruft(`_.._.._.._pwned`)是 Chromium pre-mangle、非 app bug、安全无损。
- **不自动打开**(P1,**代码实锤**):`web-tabs.js` download-`done` 处理器只置状态,`shell.openPath` 仅在用户点「打开」的 `dlOpen()` 里(注释明标「≠自动打开」)。
- **非法字符无害化**:`a:b*c?.bin` → `a_b_c_.bin`。
- **取消无残留**:`/slowdl` 取消前有半截 big.bin、取消后磁盘残留=空、记录=canceled、persisted receivedBytes=0。

**核心功能与 UI**:
- happy path 落盘字节 === 服务端 body、completed 可开;进度环着色(accent 蓝)+ 计数徽标 + is-active、全完环消失;popover 列表操作按状态分派(完成=打开/在访达中显示/移除;取消=重下/移除;进行中=取消);**popover 锁侧栏宽、不盖网页**(rect right=251 < 侧栏 260,coversWeb=false,守住 Colin 2026-07-20 那点);持久化只存元数据、~5 条;console 零报错;亮暗两态 popover 可读、状态色不失真、无假纸叠层、暗态投影不发光。

**有意分歧(spec 已声明,不报)**:自动落盘不弹保存对话框、不做跨重启续传、无独立下载整页、下载完不自动打开、进行中不刷 progress-tone toast。

## 尾注(基线)

- **占机**:probe ~3 分钟(首跑因 trigger 手滑 `window` 引用重跑一次)+ 无独立对抗验证段(DL-1 截图+CSS 即证、红线走代码验证)。合计 ~3 分钟,远低于预算。
- **误报**:硬误报 0。视觉判官「取消后 toast 仍显下载中」被行为判官正确识别为**两帧拼合的误读**(非同一帧并存)、未进报告——判官间交叉纠正生效。
- **token**:约 210k(预期 45k + 双判官 117k + 编排)。
- **覆盖诚实度**:大量态未诱发(见待核),右键/WebContentsView 内容 Playwright 采不到。探索器不是回归门;下载的确定性回归由 `e2e/web-downloads.spec.js` 8 条真下载兜底。
