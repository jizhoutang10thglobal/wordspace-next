import { useState } from 'react'
import { Search, ArrowRight, Check } from 'lucide-react'
import { useBrowser, type SiteKey } from '../mock/browser'
import './MockSites.css'

// Polished MOCK websites. The app chrome is plain, but these are meant to read
// as real, distinct sites on the open web — each with its own header, branding
// and restrained palette. Internal links call useBrowser.navigate(...), so the
// demo can hop between mock sites and real URLs from inside a page.

const nav = (url: string) => useBrowser.getState().navigate(url)

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
    default:
      return <CompanySite />
  }
}

export default MockSite
