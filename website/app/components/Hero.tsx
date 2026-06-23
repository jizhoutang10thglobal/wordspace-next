export function Hero() {
  return (
    <section className="hero">
      <div className="container">
        <h1 className="hero__title">
          像写文档一样，<em>编辑 HTML</em>。
        </h1>
        <p className="hero__subtitle">
          wordspace 在本地打开你的 .html 文件，像普通文档一样编辑，再原样存回干净的
          HTML。
        </p>
        <div className="hero__ctas">
          <a className="cta" href="/downloads/mac" data-testid="cta-mac">
            <span aria-hidden="true">⌘</span>
            下载 macOS 版（Apple Silicon）
          </a>
          <a className="cta cta--secondary" href="/downloads/mac-intel" data-testid="cta-mac-intel">
            <span aria-hidden="true">⌘</span>
            下载 macOS 版（Intel）
          </a>
          <a className="cta cta--secondary" href="/downloads/win" data-testid="cta-win">
            <span aria-hidden="true">⊞</span>
            下载 Windows 版
          </a>
        </div>
        <p className="hero__ctas-note">
          macOS 同时支持 Apple Silicon（M 系列）和 Intel 芯片；不确定芯片就看苹果菜单「关于本机」
        </p>
      </div>
    </section>
  );
}
