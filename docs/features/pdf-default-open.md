# PDF 默认打开设为 Wordspace —— 对齐 spec

> 来源:Wendi 2026-07-17「我想把 PDF 的默认打开,也设置成 Wordspace,但是设置不了」。
> 病根:安装包 Info.plist(CFBundleDocumentTypes)只声明了 html/htm/md——macOS「打开方式 →
> 全部更改」的候选列表里根本没有 Wordspace。这类配置只在打包生效,跑 dev app 测不出来
> (同款前科:md 后端上线时忘加,见 test/file-associations.test.js 头注)。

## 行为契约

- **系统绑定**:mac/win 的 `fileAssociations` 声明 `.pdf`(role=**Viewer**,只看不编)。装包后
  macOS 访达「显示简介 → 打开方式」可选 Wordspace 并「全部更改」;Windows 同理。
- **双击/文件关联打开**(open-file 事件 / Win argv / 第二实例):**按 kind 分流**——html/md 进
  编辑器(原路);**pdf 及其他查看器类型进内置查看器 showViewer**(PDF.js,只读),与「打开」按钮
  `pickAndOpen` 同一套口径。绝不把 PDF 字节塞进文档编辑器。
- **冷启动竞态**:双击 PDF 拉起 app 时,`__pendingColdOpen` 占位让「恢复上次工作区」不抢走
  查看器;viewer 路径没有 sidebar onOpen 来清标记,上屏后自行清(防泄漏抑制后续恢复)。
- 工作区内的 PDF 照旧走 `wsFileUrl(rootId, rel)`(assertInsideWorkspace 守卫);工作区外的能
  预览但不进标签(既有产品决策 B)。

## 文件映射

| 维度 | 真 app |
|---|---|
| 系统绑定声明 | `package.json` build.fileAssociations(顶层 + mac + win 三处,pdf=Viewer) |
| Win/Linux argv 路径 | `src/lib/path-url.js` htmlPathFromArgv(+pdf) |
| open-file 分流 | `src/renderer/shell.js` onOpenFile(classify → openDoc / showViewer) |
| 防漂移锁 | `test/file-associations.test.js`(DOC_EXTS+VIEWER_EXTS 双向锁) |
| e2e 门 | `e2e/pdf-viewer.spec.js` open-file 路由门(pdf→查看器/html 回归;变异自检过:退回直调 openDoc 翻红) |

ui-demo 侧:不适用(OS 集成是打包层能力,ui-demo 无系统绑定面)——有意分歧。

## 欠账

- **真机闭环**:fileAssociations 只在签名安装包生效——要 Wendi 装下一个发版后,在访达对任一
  PDF「显示简介 → 打开方式 → Wordspace → 全部更改」实测绑定 + 双击真进查看器。
- 其他查看器类型(png/jpg 等图片)未声明系统绑定——用户没要;要加时走同一套(VIEWER_EXTS +
  fileAssociations + 分流已就绪,只差声明)。
