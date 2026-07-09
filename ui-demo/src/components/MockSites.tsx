import { useState } from 'react'
import { Search, ArrowRight, Check } from 'lucide-react'
import { useBrowser, resolve, type SiteKey } from '../mock/browser'
import { useStore } from '../mock/store'
import { useHistory } from '../mock/history'
import './MockSites.css'

// Polished MOCK websites. The app chrome is plain, but these are meant to read
// as real, distinct sites on the open web — each with its own header, branding
// and restrained palette. Internal links call useBrowser.navigate(...), so the
// demo can hop between mock sites and real URLs from inside a page.

// 点链接 = 当前标签导航；⌘/Ctrl+点击 = 后台新标签打开（对齐真浏览器）。
// 读 window.event 拿修饰键,免得改遍每个 onClick 的签名。
const nav = (url: string) => {
  const e = window.event as MouseEvent | undefined
  if (e && (e.metaKey || e.ctrlKey)) {
    const title = resolve(url).title
    useStore.getState().openWebTab(url, title, true)
    useHistory.getState().record(url, title)
    useStore.getState().toast('已在后台标签页打开', 'neutral')
    return
  }
  useBrowser.getState().navigate(url)
}

// ===========================================================================
// Glass 搜索 — a clean search-engine results page
// ===========================================================================
interface Result {
  title: string
  url: string
  display: string
  snippet: string
}

function buildResults(q: string): Result[] {
  const term = q || 'Wordspace'
  return [
    {
      title: `${term} — Tenth Global 官网`,
      url: 'https://tenthglobal.com',
      display: 'https://tenthglobal.com',
      snippet:
        '我们帮团队把内容做成自己掌控的文件,再一键发布成网站、内网页或对外站点。了解我们的服务与团队。',
    },
    {
      title: `加入我们 · ${term} 招聘`,
      url: 'https://tenthglobal.com/careers',
      display: 'https://tenthglobal.com › careers',
      snippet:
        '正在招聘项目经理、项目助理与财务运营。第一天就接触真实业务,以结果为准,时间地点你自己定。',
    },
    {
      title: 'FlowDesk — 团队的协作操作台',
      url: 'https://flowdesk.app',
      display: 'https://flowdesk.app',
      snippet:
        '把文档、任务和发布放在一个本地优先的工作台里。为小团队设计,数据归你所有。免费开始。',
    },
    {
      title: `${term} 是什么,为什么值得关注 — Designer News`,
      url: 'https://news.design/today',
      display: 'https://news.design › today',
      snippet:
        '本地优先软件正在回来。我们聊了几家把文档当作网页来设计、再自托管全部内容的小团队。',
    },
    {
      title: `${term} - 维基百科`,
      url: 'https://zh.wikipedia.org',
      display: 'https://zh.wikipedia.org › wiki',
      snippet:
        '一个自由的百科全书条目示例。点开会用内置浏览器尝试真实加载这个外部网站。',
    },
  ]
}

function GlassSearch({ query }: { query?: string }) {
  const [value, setValue] = useState(query ?? '')
  const q = (query ?? '').trim()
  const results = buildResults(q)

  return (
    <div className="ms ms-glass">
      <header className="gl-bar">
        <button className="gl-logo" onClick={() => nav('glass://home')}>
          <span className="gl-logo-mark">G</span>
          <span className="gl-logo-word">Glass</span>
        </button>
        <form
          className="gl-search"
          onSubmit={(e) => {
            e.preventDefault()
            const v = value.trim()
            if (v) nav('glass://search?q=' + encodeURIComponent(v))
          }}
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="在 Glass 搜索"
            spellCheck={false}
          />
          <button type="submit" className="gl-search-go" aria-label="搜索">
            <Search size={16} />
          </button>
        </form>
      </header>

      {q ? (
        <div className="gl-body">
          <div className="gl-stats">约 1,240,000 条结果（0.21 秒）</div>
          <div className="gl-results">
            {results.map((r, i) => (
              <div className="gl-result" key={i}>
                <div className="gl-result-url">{r.display}</div>
                <button className="gl-result-title" onClick={() => nav(r.url)}>
                  {r.title}
                </button>
                <div className="gl-result-snippet">{r.snippet}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="gl-home">
          <div className="gl-home-mark">
            <span className="gl-logo-mark gl-home-g">G</span>
            <span className="gl-home-word">Glass</span>
          </div>
          <form
            className="gl-home-search"
            onSubmit={(e) => {
              e.preventDefault()
              const v = value.trim()
              if (v) nav('glass://search?q=' + encodeURIComponent(v))
            }}
          >
            <Search size={18} className="gl-home-ico" />
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="搜索网页"
              spellCheck={false}
            />
          </form>
          <div className="gl-home-chips">
            {['Tenth Global', '本地优先软件', 'FlowDesk', 'Designer News'].map((c) => (
              <button key={c} onClick={() => nav('glass://search?q=' + encodeURIComponent(c))}>
                {c}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// Tenth Global — a corporate-clean company site
// ===========================================================================
function CompanySite() {
  const features = [
    { h: '自己掌控的文件', p: '每份内容都是本地的 HTML 文件,归你所有,可随时打开、备份、迁移。' },
    { h: '一键对外发布', p: '从私有到内网到公开,一个开关切换,链接即时生成。' },
    { h: '让 AI 参与', p: 'AI 帮你起草、排版、改写,产物仍是你能继续编辑的文档。' },
  ]
  return (
    <div className="ms ms-company">
      <header className="co-nav">
        <button className="co-brand" onClick={() => nav('https://tenthglobal.com')}>
          <span className="co-brand-mark" />
          Tenth Global
        </button>
        <nav className="co-links">
          <button onClick={() => nav('https://tenthglobal.com')}>关于</button>
          <button onClick={() => nav('https://tenthglobal.com')}>服务</button>
          <button onClick={() => nav('https://tenthglobal.com/careers')}>招聘</button>
          <button onClick={() => nav('https://tenthglobal.com')}>联系</button>
        </nav>
        <button className="co-cta" onClick={() => nav('https://tenthglobal.com/careers')}>
          加入我们
        </button>
      </header>

      <section className="co-hero">
        <div className="co-hero-eyebrow">本地优先的内容工作方式</div>
        <h1>把每一份内容,变成你真正拥有的文件。</h1>
        <p>
          Tenth Global 帮团队用一套工具写文档、做网页、发布对外站点。内容是本地的,
          发布是你说了算的,AI 只是帮手。
        </p>
        <div className="co-hero-actions">
          <button className="co-btn-primary" onClick={() => nav('https://flowdesk.app')}>
            看看产品 <ArrowRight size={15} />
          </button>
          <button className="co-btn-ghost" onClick={() => nav('https://tenthglobal.com/careers')}>
            我们在招聘
          </button>
        </div>
      </section>

      <section className="co-features">
        {features.map((f, i) => (
          <div className="co-feature" key={i}>
            <div className="co-feature-num">0{i + 1}</div>
            <div className="co-feature-h">{f.h}</div>
            <div className="co-feature-p">{f.p}</div>
          </div>
        ))}
      </section>

      <footer className="co-foot">
        <div className="co-foot-brand">Tenth Global</div>
        <div className="co-foot-cols">
          <button onClick={() => nav('https://tenthglobal.com')}>关于我们</button>
          <button onClick={() => nav('https://tenthglobal.com/careers')}>招聘</button>
          <button onClick={() => nav('https://news.design/today')}>博客</button>
          <button onClick={() => nav('https://flowdesk.app')}>产品</button>
        </div>
        <div className="co-foot-fine">© 2026 Tenth Global · tenthglobal.com</div>
      </footer>
    </div>
  )
}

// ===========================================================================
// FlowDesk — a modern SaaS landing page (Linear / Notion-ish)
// ===========================================================================
function SaasSite() {
  const features = [
    { h: '文档即文件', p: '每个页面都是可移植的文件,不锁在某个云里。' },
    { h: '任务在侧边', p: '把待办、评论和文档放在同一处,上下文不丢。' },
    { h: '即时发布', p: '一键把任意页面变成可分享的链接。' },
    { h: '本地优先', p: '离线也能用,联网时再静默同步。' },
    { h: '团队空间', p: '为每条业务线分一个可切换的空间。' },
    { h: '可被 AI 调用', p: '开放接口,让你的 Agent 直接读写。' },
  ]
  return (
    <div className="ms ms-saas">
      <header className="fd-nav">
        <button className="fd-brand" onClick={() => nav('https://flowdesk.app')}>
          <span className="fd-brand-mark">◳</span> FlowDesk
        </button>
        <nav className="fd-links">
          <button onClick={() => nav('https://flowdesk.app')}>产品</button>
          <button onClick={() => nav('https://flowdesk.app')}>定价</button>
          <button onClick={() => nav('https://news.design/today')}>博客</button>
          <button onClick={() => nav('https://flowdesk.app')}>文档</button>
        </nav>
        <div className="fd-nav-actions">
          <button className="fd-signin" onClick={() => nav('https://flowdesk.app')}>登录</button>
          <button className="fd-cta" onClick={() => nav('https://flowdesk.app')}>免费开始</button>
        </div>
      </header>

      <section className="fd-hero">
        <div className="fd-pill">v2.0 · 全新本地引擎</div>
        <h1>团队的协作操作台,数据始终归你所有。</h1>
        <p>FlowDesk 把文档、任务与发布放进一个本地优先的工作台。为小团队设计,快到不打断思路。</p>
        <div className="fd-hero-actions">
          <button className="fd-btn-primary" onClick={() => nav('https://flowdesk.app')}>
            免费开始 <ArrowRight size={15} />
          </button>
          <button className="fd-btn-ghost" onClick={() => nav('https://tenthglobal.com')}>
            预约演示
          </button>
        </div>
        <div className="fd-hero-meta">
          <span><Check size={13} /> 无需信用卡</span>
          <span><Check size={13} /> 离线可用</span>
        </div>
      </section>

      <section className="fd-logos">
        <span>被这些团队使用</span>
        <div className="fd-logos-row">
          {['NORTHWIND', 'Tenth Global', 'ACME', 'Lumen', 'Foundry'].map((l) => (
            <span key={l} className="fd-logo">{l}</span>
          ))}
        </div>
      </section>

      <section className="fd-grid">
        {features.map((f, i) => (
          <div className="fd-card" key={i}>
            <div className="fd-card-dot" />
            <div className="fd-card-h">{f.h}</div>
            <div className="fd-card-p">{f.p}</div>
          </div>
        ))}
      </section>

      <footer className="fd-foot">
        <div className="fd-foot-brand"><span className="fd-brand-mark">◳</span> FlowDesk</div>
        <div className="fd-foot-links">
          <button onClick={() => nav('https://flowdesk.app')}>产品</button>
          <button onClick={() => nav('https://flowdesk.app')}>定价</button>
          <button onClick={() => nav('https://tenthglobal.com')}>关于</button>
          <button onClick={() => nav('https://news.design/today')}>博客</button>
        </div>
        <div className="fd-foot-fine">© 2026 FlowDesk Inc. · flowdesk.app</div>
      </footer>
    </div>
  )
}

// ===========================================================================
// Designer News — a clean magazine / news site
// ===========================================================================
function NewsSite() {
  const posts = [
    { tag: '排版', title: '为什么单栏长文比多栏更好读', meta: '8 分钟阅读 · 今天', tint: 'a' },
    { tag: '工具', title: '本地优先软件正在回来', meta: '6 分钟阅读 · 昨天', tint: 'b' },
    { tag: '观点', title: '把文档当作网页来设计', meta: '5 分钟阅读 · 2 天前', tint: 'c' },
    { tag: '访谈', title: '一个小团队如何自托管全部内容', meta: '12 分钟阅读 · 本周', tint: 'd' },
    { tag: '产品', title: 'FlowDesk 评测:操作台还是过度设计?', meta: '9 分钟阅读 · 本周', tint: 'b' },
    { tag: '行业', title: 'AI 写文档,人来定调子', meta: '7 分钟阅读 · 上周', tint: 'c' },
  ]
  return (
    <div className="ms ms-news">
      <header className="nw-nav">
        <button className="nw-brand" onClick={() => nav('https://news.design/today')}>
          Designer News
        </button>
        <nav className="nw-links">
          <button onClick={() => nav('https://news.design/today')}>最新</button>
          <button onClick={() => nav('https://news.design/today')}>专题</button>
          <button onClick={() => nav('https://news.design/today')}>工具</button>
          <button onClick={() => nav('https://news.design/today')}>关于</button>
        </nav>
        <button className="nw-cta" onClick={() => nav('https://flowdesk.app')}>订阅</button>
      </header>

      <article className="nw-hero" data-ctx-href="https://tenthglobal.com" onClick={() => nav('https://tenthglobal.com')}>
        <div className="nw-hero-media" data-ctx-img="https://news.design/img/hero.jpg" />
        <div className="nw-hero-body">
          <div className="nw-hero-tag">头条</div>
          <h1>文档、网站和浏览器,正在变成同一件东西</h1>
          <p>越来越多团队把内容做成自己掌控的文件,再一键发布。我们聊了几家这样做的公司。</p>
          <div className="nw-hero-meta">特写 · 14 分钟阅读 · 今天</div>
        </div>
      </article>

      <section className="nw-grid">
        {posts.map((p, i) => (
          <article
            key={i}
            className="nw-card"
            data-ctx-href="https://news.design/today"
            onClick={() => nav('https://news.design/today')}
          >
            <div className={`nw-thumb nw-thumb-${p.tint}`} data-ctx-img={`https://news.design/thumb/${i + 1}.jpg`} />
            <div className="nw-card-tag">{p.tag}</div>
            <div className="nw-card-title">{p.title}</div>
            <div className="nw-card-meta">{p.meta}</div>
          </article>
        ))}
      </section>

      <footer className="nw-foot">
        news.design · 一个关于设计与产品的独立刊物
      </footer>
    </div>
  )
}

// 一篇「野生」的文章详情页：真正的长文正文被顶部横幅广告、右侧栏推广、正文中插
// 广告、底部标题党推荐和一个订阅浮层层层包围——就是阅读模式（Reader）真正的主场。
// 正文全在 .lr-article 里；阅读模式把 .ms.lr 的其余直接子全隐藏，只留这一块。
function LongreadArticle() {
  const hot = [
    '月薪三万的人，周末都在偷偷做这件事',
    '为什么聪明人从不在下午开会',
    '这 5 个习惯，正在悄悄拖垮你的团队',
    '看完这篇，你会重新考虑你的工具栈',
  ]
  const related = [
    { t: '震惊！90% 的团队都用错了协作工具', m: '广告 · 推广' },
    { t: '一个动作，让你的文档效率翻倍', m: '4.1 万阅读' },
    { t: '2026 年最值得换掉的 7 个软件', m: '赞助内容' },
    { t: '他把公司文档搬上本地后，发生了什么', m: '2.3 万阅读' },
  ]
  return (
    <div className="ms ms-longread lr">
      <div className="lr-topbanner" onClick={() => nav('https://flowdesk.app')}>
        🔥 限时 3 天 · 团队套件全场五折，名额有限 —— 点这里立即抢 →
      </div>

      <header className="lr-nav">
        <span className="lr-logo" onClick={() => nav('https://www.dailybuzz.co/article')}>DailyBuzz</span>
        <nav className="lr-nav-links">
          <button>科技</button><button>职场</button><button>生活</button>
          <button>财经</button><button>八卦</button><button>更多</button>
        </nav>
        <button className="lr-nav-login">登录</button>
      </header>

      <article className="lr-article">
        <div className="lr-kicker">职场 · 效率</div>
        <h1>10 个信号，说明你的团队早该换掉现在的工具了</h1>
        <div className="lr-byline">作者 佚名编辑部 · 2026-07-09 · 3.2 万阅读 · 128 评论</div>
        <figure className="lr-fig" />
        <p>
          你有没有过这样的时刻：明明是件小事，一份文件却在三个软件、五个链接和无数条消息里
          绕了一大圈，最后谁也说不清最新版本在哪。如果这一幕你觉得熟悉，那你并不孤单——
          我们采访了几十个团队，几乎每一个都在用一套自己都嫌弃、却又懒得换的工具。
        </p>
        <p>
          问题往往不在某一个软件本身，而在于它们拼在一起之后的那种「摩擦感」。下面这 10 个信号，
          只要中了三个以上，就说明是时候认真考虑换一套了。
        </p>

        <h2>1. 你们还在靠邮件和群消息传文件</h2>
        <p>
          文件靠附件传，版本靠文件名区分（「最终版」「最终版2」「真的最终版」），这是最典型的信号。
          文件一旦离开源头，就再也没人知道哪份是对的。好的工具应该让「文件在哪、谁改的、改了什么」
          一目了然，而不是让你在聊天记录里考古。
        </p>

        <div className="lr-inline-ad" onClick={() => nav('https://flowdesk.app')}>
          广告 · 你可能感兴趣：立省 60% 的团队协作套件，现在注册再送三个月 →
        </div>

        <h2>2. 每换一个环节，就要换一个软件</h2>
        <p>
          写东西一个软件，存文件一个软件，发布又是另一个软件，中间还要手动搬来搬去。每一次「导出再导入」
          都是一次信息损耗，也是一次出错的机会。工具越多，团队花在「对齐工具」上的时间就越多，
          真正做事的时间反而被挤没了。
        </p>

        <h2>3. 没人说得清「东西到底存在哪」</h2>
        <p>
          有的在云端，有的在某个人电脑上，有的在聊天软件的历史消息里。当「我们的资料在哪」这个问题
          没有一个确定答案时，说明你们的工具已经失去了它最基本的职责——让东西有个可靠的家。
        </p>

        <h2>4. 你开始害怕升级和迁移</h2>
        <p>
          一想到要换工具、要迁数据就头大，于是能拖就拖。但这种「换不起」的恐惧本身，恰恰说明你被工具
          绑架了。真正好用的东西，应该让你的数据始终掌握在自己手里，走得干净、来得也干净。
        </p>

        <p>
          说到底，工具是为人服务的，不是反过来。如果每天有相当一部分精力花在和软件较劲，那不是你的问题，
          是工具的问题。别忍了。
        </p>
      </article>

      <aside className="lr-rail">
        <div className="lr-adcard" onClick={() => nav('https://flowdesk.app')}>
          <div className="lr-adcard-tag">赞助</div>
          <div className="lr-adcard-title">还在用旧工具？该升级了</div>
          <div className="lr-adcard-cta">了解一下 →</div>
        </div>
        <div className="lr-hot">
          <h3 className="lr-hot-title">热门 · 大家都在看</h3>
          {hot.map((h, i) => (
            <button key={i} className="lr-hot-item" onClick={() => nav('https://www.dailybuzz.co/article')}>
              <span className="lr-hot-num">{i + 1}</span>
              <span>{h}</span>
            </button>
          ))}
        </div>
        <div className="lr-subbox">
          <div className="lr-subbox-title">订阅每日推送</div>
          <input className="lr-subbox-input" placeholder="你的邮箱" spellCheck={false} />
          <button className="lr-subbox-btn">立即订阅</button>
        </div>
      </aside>

      <section className="lr-related">
        <h3 className="lr-related-title">猜你喜欢</h3>
        <div className="lr-related-grid">
          {related.map((r, i) => (
            <button key={i} className="lr-related-card" onClick={() => nav('https://www.dailybuzz.co/article')}>
              <div className="lr-related-thumb" />
              <div className="lr-related-card-title">{r.t}</div>
              <div className="lr-related-card-meta">{r.m}</div>
            </button>
          ))}
        </div>
      </section>

      <footer className="lr-foot">DailyBuzz · 本页内容仅供演示 · 广告纯属虚构</footer>

      <div className="lr-popup">
        <button className="lr-popup-x">×</button>
        <div className="lr-popup-title">别急着走！</div>
        <div className="lr-popup-sub">订阅即可解锁全部文章，还送新人礼包</div>
        <div className="lr-popup-row">
          <input className="lr-popup-input" placeholder="输入邮箱" spellCheck={false} />
          <button className="lr-popup-btn">订阅</button>
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
export function MockSite({ siteKey, query }: { siteKey: SiteKey; query?: string }) {
  switch (siteKey) {
    case 'search':
      return <GlassSearch query={query} />
    case 'company':
      return <CompanySite />
    case 'saas':
      return <SaasSite />
    case 'news':
      return <NewsSite />
    case 'longread':
      return <LongreadArticle />
    default:
      return <CompanySite />
  }
}

export default MockSite
