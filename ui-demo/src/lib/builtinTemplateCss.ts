// ============================================================================
// 内置官方模板的版式 CSS（纯字符串，无依赖）。seed.ts 用它构造 Template，
// scripts/test-template-gate.mjs 用它验证「黄金模板过门」（AE8）。
// ----------------------------------------------------------------------------
// 选择器写相对形式（h1 / .ws-callout / …），Canvas 注入时经 templateScope 包进
// `.ws-doc.ws-tpl-on { … }`，天然作用域到文档区、不漏 app 界面。
// 全部只用 templateCheck 放行的能力：无外链、无 !important、无定位类、字体/图片走 data:。
// ============================================================================

// data:image/png 1×1 占位（证明 data:image 内嵌通道；真 app 换真 logo，见 spec 欠账）。
const LOGO_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

// —— 会议纪要：清爽蓝 ——
export const CSS_MINUTES = `
h1 { color: #1a4d8f; letter-spacing: .2px; }
h2 { color: #1a4d8f; border-bottom: 2px solid #d6e4f5; padding-bottom: 4px; }
.ws-callout { background: #eef4fc; border-left: 3px solid #1a73e8; }
`.trim()

// —— 项目方案：暖橙 ——
export const CSS_PROPOSAL = `
h1 { color: #b5560a; }
h2 { color: #b5560a; }
h2::before { content: "▸ "; color: #e8710a; }
.ws-callout { background: #fdf1e7; border-left: 3px solid #e8710a; }
blockquote { border-left: 3px solid #e8710a; color: #7a5230; }
`.trim()

// —— 周计划：玫红 ——
export const CSS_WEEKLY = `
h1 { color: #b02a54; font-weight: 700; }
h2 { color: #b02a54; }
h3 { color: #c4568a; }
.ws-callout { background: #fdeef4; border-left: 3px solid #d4356b; }
ul { line-height: 1.9; }
`.trim()

// —— 黄金标书模板（表达力验收 AE8）：内嵌 data:font + data:image logo + 正式封面观感 ——
// @font-face 用 data:font 短占位证明门放行内嵌字体（真 app 换真字体、字体子集化见 spec 欠账），
// font-family 回退到衬线栈，渲染优雅降级不破。封面 logo 走 data:image。
export const CSS_PROPOSAL_FORMAL = `
@font-face {
  font-family: 'WS Proposal Serif';
  src: url(data:font/woff2;base64,d09GMgABAAAAAAKUAA0AAAAAB) format('woff2');
  font-display: swap;
}
h1, h2, h3 { font-family: 'WS Proposal Serif', Georgia, 'Songti SC', 'Noto Serif SC', serif; }
p, li, blockquote { font-family: Georgia, 'Songti SC', 'Noto Serif SC', serif; line-height: 1.85; color: #2b2b2b; }
h1 {
  color: #14213d; font-size: 2.1em; text-align: center;
  padding-bottom: 18px; margin-bottom: 8px; border-bottom: 2px solid #14213d;
}
h1::before {
  content: ""; display: block; width: 46px; height: 46px; margin: 0 auto 14px;
  border-radius: 10px; background-color: #14213d; background-image: url(${LOGO_PNG});
  background-size: cover;
}
h2 { color: #14213d; border-left: 4px solid #c8a24a; padding-left: 10px; }
.ws-callout { background: #faf6ec; border: 1px solid #e4d6ac; }
blockquote { border-left: 3px solid #c8a24a; color: #5c4a1e; font-style: italic; }
table th { background: #14213d; color: #fff; }
`.trim()
