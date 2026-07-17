'use client';

import { useEffect, useState } from 'react';
import type { ChangelogEntry } from '../lib/changelog';

/**
 * 客户端切换层：两份语言的条目都在静态产物里（构建时读 CHANGELOG.md / CHANGELOG.en.md），
 * 切换零请求。en 缺某版本时按版本号回落 zh 条目（历史条目允许只有中文）。
 * 默认中文；选择存 localStorage（ws-changelog-lang），下次进来记住。
 */

type Lang = 'zh' | 'en';

const UI = {
  zh: {
    title: '更新日志',
    sub: '每个版本改了什么，最新在最上。App 内「检查更新」看到的说明也来自这里。',
    latest: '最新',
    devNotePre: '开发者视角的每版完整改动（PR 列表）在 ',
    devNotePost: '。',
  },
  en: {
    title: 'Changelog',
    sub: 'What changed in every version, newest first. The notes shown by "Check for Updates" in the app come from here too.',
    latest: 'Latest',
    devNotePre: 'The full per-version change list (PRs) for developers lives on ',
    devNotePost: '.',
  },
} as const;

const RELEASES_URL = 'https://github.com/jizhoutang10thglobal/wordspace-next/releases';
const LANG_KEY = 'ws-changelog-lang';

function GroupBadge({ title }: { title: string }) {
  const kind =
    title === '新增' || title === 'Added' ? 'new' : title === '修复' || title === 'Fixed' ? 'fix' : 'improve';
  return <span className={`cl-badge cl-badge--${kind}`}>{title}</span>;
}

export function ChangelogView({ zh, en }: { zh: ChangelogEntry[]; en: ChangelogEntry[] }) {
  const [lang, setLang] = useState<Lang>('zh');
  useEffect(() => {
    const saved = window.localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'zh') setLang(saved);
  }, []);
  const pick = (l: Lang) => {
    setLang(l);
    try {
      window.localStorage.setItem(LANG_KEY, l);
    } catch {
      /* 隐私模式等存不了就算了，本次会话内仍生效 */
    }
  };

  const enByVersion = new Map(en.map((e) => [e.version, e]));
  // 以 zh 为版本骨架（正本），en 有的版本用 en，没有回落 zh
  const entries = lang === 'en' ? zh.map((e) => enByVersion.get(e.version) ?? e) : zh;
  const t = UI[lang];

  return (
    <main className="cl-main container">
      <header className="cl-head">
        <div className="cl-head-row">
          <h1>{t.title}</h1>
          <div className="cl-lang" role="group" aria-label="Language">
            <button
              className={`cl-lang-btn${lang === 'zh' ? ' is-on' : ''}`}
              data-testid="cl-lang-zh"
              onClick={() => pick('zh')}
            >
              中文
            </button>
            <button
              className={`cl-lang-btn${lang === 'en' ? ' is-on' : ''}`}
              data-testid="cl-lang-en"
              onClick={() => pick('en')}
            >
              English
            </button>
          </div>
        </div>
        <p className="cl-sub">{t.sub}</p>
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
              {idx === 0 && <span className="cl-badge cl-badge--latest">{t.latest}</span>}
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
        {t.devNotePre}
        <a href={RELEASES_URL} rel="noopener">
          GitHub Releases
        </a>
        {t.devNotePost}
      </p>
    </main>
  );
}
