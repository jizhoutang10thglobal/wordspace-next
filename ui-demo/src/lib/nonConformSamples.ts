// ============================================================================
// 非合规 HTML 样例（写死，给「降级为基础编辑」演示用）
// ----------------------------------------------------------------------------
// 三个「野生 HTML」文件，各违反 Schema #1 的不同维度（经 checkSchema 实判，非写死布尔）：
//   ① 花哨落地页 —— 作者 <style> + 大量内联 style + 绝对定位 + 多栏布局容器（结构没法块化）
//   ② 季度数据表 —— 表格合并格(colspan/rowspan) + 嵌套表 + 单元格塞块
//   ③ 活动报名页 —— <script> + on* 事件 + <form>/<input> + <iframe> + h5/h6
// 这些文件「看起来正常甚至漂亮」，但没法用 Schema 的块编辑逻辑编辑 → 只能基础文字编辑。
// 故意保留花哨外观（在隔离 iframe 里渲染，样式不外泄、脚本不执行）。
// ============================================================================

export interface NonConformSample {
  id: string // doc id（d-nc-*）
  fileName: string // 显示名 + 文件树路径叶子
  blurb: string // 一句话：它哪里花哨 / 为什么没法块编辑
  html: string // 完整野生 HTML 文档
}

const FANCY_LANDING = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>新品发布 · 落地页</title>
<style>
  @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
  .hero { position:relative; height:260px; border-radius:18px; overflow:hidden;
    background:linear-gradient(120deg,#7b2ff7,#f107a3 60%,#ff8a00); color:#fff; }
  .badge { position:absolute; top:18px; right:20px; background:rgba(255,255,255,.2);
    padding:6px 14px; border-radius:999px; font-size:13px; backdrop-filter:blur(4px); }
  .orb { position:absolute; bottom:-40px; left:-30px; width:160px; height:160px;
    border-radius:50%; background:rgba(255,255,255,.18); animation:float 4s ease-in-out infinite; }
  .cols { display:flex; gap:18px; margin-top:22px; }
  .card { flex:1; padding:18px; border-radius:14px; box-shadow:0 8px 24px rgba(0,0,0,.08); }
</style></head>
<body>
<div class="page" style="max-width:880px;margin:0 auto;font-family:'PingFang SC',sans-serif;">
  <section class="hero" style="display:flex;align-items:center;padding:0 36px;">
    <span class="badge">限时预售</span>
    <div class="orb"></div>
    <h1 style="font-size:38px;font-weight:800;letter-spacing:-1px;margin:0;">让灵感<span style="color:#ffe08a;">流动</span>起来</h1>
  </section>
  <div class="cols">
    <div class="card" style="background:#f5f0ff;">
      <h3 style="color:#7b2ff7;margin-top:0;">极速</h3>
      <p style="color:#555;line-height:1.7;">原生渲染，秒开任意文档，零等待。</p>
    </div>
    <div class="card" style="background:#fff0f8;">
      <h3 style="color:#f107a3;margin-top:0;">优雅</h3>
      <p style="color:#555;line-height:1.7;">为创作打磨的每一处细节。</p>
    </div>
    <div class="card" style="background:#fff7ec;">
      <h3 style="color:#ff8a00;margin-top:0;">本地</h3>
      <p style="color:#555;line-height:1.7;">文件就在你手里，永远属于你。</p>
    </div>
  </div>
  <p style="text-align:center;margin-top:28px;">
    <a href="#buy" style="display:inline-block;background:#7b2ff7;color:#fff;padding:12px 32px;border-radius:999px;text-decoration:none;">立即抢购 →</a>
  </p>
</div>
</body></html>`

const QUARTER_TABLE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>季度数据</title>
<style>
  table { border-collapse:collapse; width:100%; font-family:sans-serif; }
  th,td { border:1px solid #d7dbe0; padding:8px 12px; }
  th { background:#f3f5f8; }
  .hi { background:#fff7e6; }
</style></head>
<body>
<h2>2026 上半年区域业绩</h2>
<table>
  <thead>
    <tr>
      <th rowspan="2">区域</th>
      <th colspan="2">Q1</th>
      <th colspan="2">Q2</th>
    </tr>
    <tr><th>营收</th><th>增长</th><th>营收</th><th>增长</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>华东</td>
      <td style="text-align:right;">¥1.2M</td><td class="hi">+18%</td>
      <td style="text-align:right;">¥1.5M</td><td class="hi">+25%</td>
    </tr>
    <tr>
      <td>华南</td>
      <td colspan="2">
        <table><tr><td>深圳 ¥0.6M</td><td>广州 ¥0.4M</td></tr></table>
      </td>
      <td style="text-align:right;">¥1.1M</td><td class="hi">+9%</td>
    </tr>
    <tr>
      <td>华北</td>
      <td colspan="4">
        <ul><li>北京：主力，¥0.9M</li><li>天津：新拓，¥0.2M</li></ul>
      </td>
    </tr>
  </tbody>
</table>
</body></html>`

const SIGNUP_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>活动报名</title>
<style>
  body { font-family:sans-serif; max-width:680px; margin:0 auto; }
  .field { margin:12px 0; } label { display:block; font-size:13px; color:#555; margin-bottom:4px; }
  input { width:100%; padding:8px 10px; border:1px solid #ccd2da; border-radius:8px; }
  .btn { background:#1a73e8; color:#fff; border:0; padding:10px 22px; border-radius:8px; cursor:pointer; }
</style>
<script>
  function submitForm(){ alert('报名成功！'); return false; }
</script></head>
<body>
<h2>2026 创作者大会 · 报名</h2>
<h5>时间</h5>
<p>2026 年 7 月 18 日 · 上海</p>
<h6>场地导航</h6>
<iframe src="https://maps.example.com/embed?venue=sh" width="100%" height="180" style="border:0;border-radius:10px;"></iframe>
<form onsubmit="return submitForm()">
  <div class="field"><label>姓名</label><input type="text" placeholder="你的名字"></div>
  <div class="field"><label>邮箱</label><input type="email" placeholder="you@example.com"></div>
  <div class="field"><label>留言</label><input type="text" placeholder="想听的话题"></div>
  <button class="btn" type="submit" onclick="submitForm()">提交报名</button>
</form>
</body></html>`

// ④ 交互产品页 —— 用 JS（标签页 + 折叠）切换内容。不跑文档 JS 时只显示初始那部分（tab 1 + 折叠关闭），
//    其余内容被藏起来看不见 → 编辑走「展开全部（reveal-all）」把它们静态拍出来；想看交互原貌走只读「预览」。
const INTERACTIVE_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>WriteFlow · 产品页</title>
<style>
  body { font-family:'PingFang SC',sans-serif; max-width:640px; margin:0 auto; padding:26px 24px; color:#1c1e21; }
  h1 { font-size:28px; margin:0 0 8px; letter-spacing:-.5px; }
  .lead { color:#555; font-size:16px; line-height:1.7; }
  .tabs { border:1px solid #e6e8eb; border-radius:12px; overflow:hidden; margin:22px 0; }
  .tabbar { display:flex; gap:4px; padding:6px; background:#f7f8fa; border-bottom:1px solid #e6e8eb; }
  .tab { border:0; background:none; padding:6px 15px; border-radius:8px; cursor:pointer; font-weight:600; color:#6b7280; font-size:14px; }
  .tab.on { background:#fff; color:#e8654f; box-shadow:0 1px 3px rgba(0,0,0,.1); }
  .panel { padding:16px 18px; font-size:14px; line-height:1.7; }
  .panel[hidden] { display:none; }
  .panel ul { margin:0; padding-left:18px; } .panel blockquote { margin:0; color:#555; border-left:3px solid #e6e8eb; padding-left:12px; }
  .col-head { width:100%; text-align:left; border:0; background:#f7f8fa; padding:12px 16px; border-radius:10px; cursor:pointer; font-weight:600; }
  .col-body { padding:12px 16px; font-size:13.5px; color:#5a5f66; }
  .col-body[hidden] { display:none; }
</style></head>
<body>
  <h1>WriteFlow 2.0</h1>
  <p class="lead">本地优先的写作工具。这一页用了<b>标签页</b>和<b>折叠</b>这类靠 JS 切换的交互。</p>
  <div class="tabs">
    <div class="tabbar">
      <button class="tab on" onclick="pick(0)">简介</button>
      <button class="tab" onclick="pick(1)">规格</button>
      <button class="tab" onclick="pick(2)">用户评价</button>
    </div>
    <div class="panel" data-p="0"><p style="margin:0;">WriteFlow 让写作回到纯粹——秒开、离线，你的文件永远属于你。</p></div>
    <div class="panel" data-p="1" hidden><ul><li>体积：12 MB</li><li>平台：macOS / Windows</li><li>格式：HTML / Markdown</li></ul></div>
    <div class="panel" data-p="2" hidden><blockquote>「终于有个不把我文件锁在云上的编辑器。」——一位早期用户</blockquote></div>
  </div>
  <button class="col-head" onclick="toggle()">查看更多规格 ▾</button>
  <div class="col-body" id="more" hidden><p style="margin:0;">离线可用 · 端到端加密 · 支持 20 种语言 · 开源内核。</p></div>
  <script>
    function pick(i){
      document.querySelectorAll('.panel').forEach(function(p,k){ p.hidden = k!==i; });
      document.querySelectorAll('.tab').forEach(function(t,k){ t.classList.toggle('on', k===i); });
    }
    function toggle(){ var m=document.getElementById('more'); m.hidden=!m.hidden; }
  </script>
</body></html>`

export const NON_CONFORM_SAMPLES: NonConformSample[] = [
  {
    id: 'd-nc-landing',
    fileName: '新品落地页.html',
    blurb: '渐变 hero + 绝对定位装饰 + 多栏卡片布局 + 满屏内联 style —— 漂亮，但这是一张「设计稿」而非结构化文档，没法拆成 Schema 的块。',
    html: FANCY_LANDING,
  },
  {
    id: 'd-nc-table',
    fileName: '季度数据表.html',
    blurb: '合并单元格(colspan/rowspan) + 单元格里嵌套表格和列表 —— 复杂表格超出 Schema 的矩形表 + 单元格纯文字约束。',
    html: QUARTER_TABLE,
  },
  {
    id: 'd-nc-signup',
    fileName: '活动报名页.html',
    blurb: '内嵌 <script> + 表单控件 + 地图 <iframe> + h5/h6 —— 带交互逻辑和越界结构，只能保住文字、丢掉交互。',
    html: SIGNUP_PAGE,
  },
  {
    id: 'd-nc-interactive',
    fileName: '产品页.html',
    blurb: '标签页 + 折叠靠 JS 切换内容 —— 不跑文档 JS 时只显示初始那部分、其余被藏起来。编辑走「展开全部」把内容拍平可编辑，预览跑 JS 看交互原貌（只读）。',
    html: INTERACTIVE_PAGE,
  },
]

export const NON_CONFORM_BY_ID: Record<string, NonConformSample> = Object.fromEntries(
  NON_CONFORM_SAMPLES.map((s) => [s.id, s]),
)
