import { useStore } from '../mock/store'
import { relTime } from '../lib/format'
import { Avatar } from '../ui/primitives'
import { useBrowserSettings, SEARCH_ENGINES, type EngineKey } from '../mock/browserSettings'
import './Settings.css'

export default function Settings() {
  const workspace = useStore((s) => s.workspace)
  const members = useStore((s) => s.members)
  const engine = useBrowserSettings((s) => s.engine)
  const homepage = useBrowserSettings((s) => s.homepage)
  const setEngine = useBrowserSettings((s) => s.setEngine)
  const setHomepage = useBrowserSettings((s) => s.setHomepage)

  return (
    <div className="st-scroll">
      <div className="st-page">
        <header className="st-head">
          <div className="ws-eyebrow">设置 · SETTINGS</div>
          <h1 className="st-title">设置</h1>
        </header>

        {/* 存储与归属 */}
        <section className="st-section">
          <div className="st-label">存储与归属</div>
          <div className="st-rows">
            <div className="st-row">
              <div className="st-row-left">
                <div className="st-row-label">本地仓库</div>
                <div className="st-row-note">文件在你机器上,归你所有</div>
              </div>
              <code className="st-row-value st-mono">{workspace.storagePath}</code>
            </div>
            <div className="st-row">
              <div className="st-row-left">
                <div className="st-row-label">部署目标</div>
                <div className="st-row-note">可自托管,由公司掌控</div>
              </div>
              <span className="st-row-value">{workspace.deployTarget}</span>
            </div>
            <div className="st-row">
              <div className="st-row-left">
                <div className="st-row-label">同步</div>
              </div>
              <span className="st-row-value st-sync">
                <span className="st-dot" />
                已同步 · {relTime(workspace.syncedAt)}
              </span>
            </div>
          </div>
        </section>

        {/* 成员 */}
        {/* 浏览器 */}
        <section className="st-section">
          <div className="st-label">浏览器</div>
          <div className="st-rows">
            <div className="st-row">
              <div className="st-row-left">
                <div className="st-row-label">默认搜索引擎</div>
                <div className="st-row-note">在地址栏打一句话（不是网址）时用它搜索</div>
              </div>
              <select className="st-select" value={engine} onChange={(e) => setEngine(e.target.value as EngineKey)}>
                {(Object.keys(SEARCH_ENGINES) as EngineKey[]).map((k) => (
                  <option key={k} value={k}>{SEARCH_ENGINES[k].name}</option>
                ))}
              </select>
            </div>
            <div className="st-row">
              <div className="st-row-left">
                <div className="st-row-label">主页</div>
                <div className="st-row-note">新标签页 / 启动时打开</div>
              </div>
              <input className="st-input" defaultValue={homepage} onBlur={(e) => setHomepage(e.target.value)} spellCheck={false} />
            </div>
          </div>
        </section>

        <section className="st-section">
          <div className="st-label">成员</div>
          <div className="st-rows">
            {members.map((m) => (
              <div key={m.id} className="st-row st-member">
                <Avatar member={m} size={28} />
                <span className="st-member-name">{m.name}</span>
                <span
                  className={`st-chip${m.kind === 'agent' ? ' st-chip-agent' : ''}`}
                >
                  {m.kind === 'agent' ? 'Agent' : '成员'}
                </span>
                <span className="st-member-email st-mono">{m.email}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 工作区 */}
        <section className="st-section">
          <div className="st-label">工作区</div>
          <div className="st-rows">
            <div className="st-row">
              <div className="st-row-left">
                <div className="st-row-label">名称</div>
              </div>
              <span className="st-row-value">{workspace.name}</span>
            </div>
            <div className="st-row">
              <div className="st-row-left">
                <div className="st-row-label">套餐</div>
              </div>
              <span className="st-row-value">{workspace.plan}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
