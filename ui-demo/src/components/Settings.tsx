import { useStore } from '../mock/store'
import { relTime } from '../lib/format'
import { Avatar } from '../ui/primitives'
import { useBrowserSettings, SEARCH_ENGINES, type EngineKey } from '../mock/browserSettings'
import { useAppearance, type AppearancePref } from '../appearance'
import { useLang, useT, LANG_PREFS, type LangPref } from '../i18n'
import './Settings.css'

const APPEARANCE_ORDER: AppearancePref[] = ['system', 'light', 'dark']
const THEME_KEY: Record<AppearancePref, string> = { system: 'settings.themeSystem', light: 'settings.themeLight', dark: 'settings.themeDark' }
const LANG_KEY: Record<LangPref, string> = { system: 'settings.langSystem', zh: 'settings.langZh', en: 'settings.langEn' }

export default function Settings() {
  const t = useT()
  const workspace = useStore((s) => s.workspace)
  const members = useStore((s) => s.members)
  const engine = useBrowserSettings((s) => s.engine)
  const setEngine = useBrowserSettings((s) => s.setEngine)
  const appearancePref = useAppearance((s) => s.pref)
  const setAppearancePref = useAppearance((s) => s.setPref)
  const langPref = useLang((s) => s.pref)
  const lang = useLang((s) => s.lang)
  const setLangPref = useLang((s) => s.setPref)

  return (
    <div className="st-scroll">
      <div className="st-page">
        <header className="st-head">
          <div className="ws-eyebrow">{t('settings.eyebrow')}</div>
          <h1 className="st-title">{t('settings.title')}</h1>
        </header>

        {/* 存储与归属 */}
        <section className="st-section">
          <div className="st-label">{t('settings.storage')}</div>
          <div className="st-rows">
            <div className="st-row">
              <div className="st-row-left">
                <div className="st-row-label">{t('settings.localRepo')}</div>
                <div className="st-row-note">{t('settings.localRepoNote')}</div>
              </div>
              <code className="st-row-value st-mono">{workspace.storagePath}</code>
            </div>
            <div className="st-row">
              <div className="st-row-left">
                <div className="st-row-label">{t('settings.deployTarget')}</div>
                <div className="st-row-note">{t('settings.deployTargetNote')}</div>
              </div>
              <span className="st-row-value">{workspace.deployTarget}</span>
            </div>
            <div className="st-row">
              <div className="st-row-left">
                <div className="st-row-label">{t('settings.sync')}</div>
              </div>
              <span className="st-row-value st-sync">
                <span className="st-dot" />
                {t('settings.synced', { time: relTime(workspace.syncedAt) })}
              </span>
            </div>
          </div>
        </section>

        {/* 语言 */}
        <section className="st-section">
          <div className="st-label">{t('settings.language')}</div>
          <div className="st-rows">
            <div className="st-row">
              <div className="st-row-left">
                <div className="st-row-label">{t('settings.languageRow')}</div>
                <div className="st-row-note">{t('settings.languageNote')}</div>
              </div>
              <select
                className="st-select"
                value={langPref}
                onChange={(e) => setLangPref(e.target.value as LangPref)}
              >
                {LANG_PREFS.map((k) => (
                  <option key={k} value={k}>{t(LANG_KEY[k])}</option>
                ))}
              </select>
            </div>
            {langPref === 'system' && (
              <div className="st-row">
                <div className="st-row-left">
                  <div className="st-row-note">{t('settings.langCurrent', { lang: lang === 'zh' ? t('settings.langZh') : t('settings.langEn') })}</div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 外观 */}
        <section className="st-section">
          <div className="st-label">{t('settings.appearance')}</div>
          <div className="st-rows">
            <div className="st-row">
              <div className="st-row-left">
                <div className="st-row-label">{t('settings.theme')}</div>
                <div className="st-row-note">{t('settings.themeNote')}</div>
              </div>
              <select
                className="st-select"
                value={appearancePref}
                onChange={(e) => setAppearancePref(e.target.value as AppearancePref)}
              >
                {APPEARANCE_ORDER.map((k) => (
                  <option key={k} value={k}>{t(THEME_KEY[k])}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* 浏览器 */}
        <section className="st-section">
          <div className="st-label">{t('settings.browser')}</div>
          <div className="st-rows">
            <div className="st-row">
              <div className="st-row-left">
                <div className="st-row-label">{t('settings.defaultEngine')}</div>
                <div className="st-row-note">{t('settings.defaultEngineNote')}</div>
              </div>
              <select className="st-select" value={engine} onChange={(e) => setEngine(e.target.value as EngineKey)}>
                {(Object.keys(SEARCH_ENGINES) as EngineKey[]).map((k) => (
                  <option key={k} value={k}>{SEARCH_ENGINES[k].name}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* 成员 */}
        <section className="st-section">
          <div className="st-label">{t('settings.members')}</div>
          <div className="st-rows">
            {members.map((m) => (
              <div key={m.id} className="st-row st-member">
                <Avatar member={m} size={28} />
                <span className="st-member-name">{m.name}</span>
                <span
                  className={`st-chip${m.kind === 'agent' ? ' st-chip-agent' : ''}`}
                >
                  {m.kind === 'agent' ? t('settings.roleAgent') : t('settings.roleMember')}
                </span>
                <span className="st-member-email st-mono">{m.email}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 工作区 */}
        <section className="st-section">
          <div className="st-label">{t('settings.workspace')}</div>
          <div className="st-rows">
            <div className="st-row">
              <div className="st-row-left">
                <div className="st-row-label">{t('settings.wsName')}</div>
              </div>
              <span className="st-row-value">{workspace.name}</span>
            </div>
            <div className="st-row">
              <div className="st-row-left">
                <div className="st-row-label">{t('settings.wsPlan')}</div>
              </div>
              <span className="st-row-value">{workspace.plan}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
