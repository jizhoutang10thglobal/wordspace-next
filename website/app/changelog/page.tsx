import type { Metadata } from 'next';
import { SiteHeader } from '../components/SiteHeader';
import { SiteFooter } from '../components/SiteFooter';
import { loadChangelog } from '../lib/changelog';

export const metadata: Metadata = {
  title: '更新日志 — wordspace',
  description: 'wordspace 每个版本的新增、改进与修复，最新版本在最上。',
  alternates: { canonical: '/changelog' },
};

const RELEASES_URL = 'https://github.com/jizhoutang10thglobal/wordspace-next/releases';

function GroupBadge({ title }: { title: string }) {
  const kind = title === '新增' ? 'new' : title === '修复' ? 'fix' : 'improve';
  return <span className={`cl-badge cl-badge--${kind}`}>{title}</span>;
}

export default async function ChangelogPage() {
  const entries = await loadChangelog();
  return (
    <>
      <SiteHeader />
      <main className="cl-main container">
        <header className="cl-head">
          <h1>更新日志</h1>
          <p className="cl-sub">
            每个版本改了什么，最新在最上。App 内「检查更新」看到的说明也来自这里。
          </p>
        </header>

        <div className="cl-entries">
          {entries.map((e, idx) => (
            <section key={e.version} className="cl-entry" id={e.version}>
              <div className="cl-entry__head">
                <a className="cl-entry__version" href={`#${e.version}`}>
                  {e.version}
                </a>
                <time className="cl-entry__date" dateTime={e.date}>
                  {e.date}
                </time>
                {idx === 0 && <span className="cl-badge cl-badge--latest">最新</span>}
                {e.note && <span className="cl-entry__note">{e.note}</span>}
              </div>
              {e.lead && <p className="cl-entry__lead">{e.lead}</p>}
              {e.groups.map((g, gi) => (
                <div key={gi} className="cl-group">
                  {g.title && <GroupBadge title={g.title} />}
                  <ul className="cl-items">
                    {g.items.map((it, ii) => (
                      <li key={ii}>
                        {it.parts.map((p, pi) =>
                          pi % 2 === 1 ? <strong key={pi}>{p}</strong> : <span key={pi}>{p}</span>,
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>

        <p className="cl-dev-note">
          开发者视角的每版完整改动（PR 列表）在{' '}
          <a href={RELEASES_URL} rel="noopener">
            GitHub Releases
          </a>
          。
        </p>
      </main>
      <SiteFooter />
    </>
  );
}

// 静态化：构建时读 CHANGELOG.md 渲染死，运行时零请求（正本变更靠重新部署带上来）。
export const dynamic = 'force-static';
