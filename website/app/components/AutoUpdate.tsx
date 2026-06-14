export function AutoUpdate() {
  return (
    <section className="section features" id="features">
      <div className="container">
        <div className="features__grid">
          <article className="feature">
            <div className="feature__top">
              <span className="feature__num">自动更新</span>
            </div>
            <h3 className="feature__title">始终保持最新</h3>
            <p className="feature__body">
              每次打开 wordspace，它都会在后台自动下载最新版本，并提示你一键安装——
              不用手动检查，也不用重新下载。
            </p>
          </article>

          <article className="feature feature--soon">
            <div className="feature__top">
              <span className="feature__num">文档管理</span>
              <span className="feature__badge">开发中</span>
            </div>
            <h3 className="feature__title">所有文档一处管</h3>
            <p className="feature__body">
              未来你可以把多个 .html 文档放进一个工作区，用侧边栏归类、随手搜索、
              按最近打开找回——不用再去文件夹里翻。
            </p>
          </article>

          <article className="feature feature--soon">
            <div className="feature__top">
              <span className="feature__num">团队协作</span>
              <span className="feature__badge">开发中</span>
            </div>
            <h3 className="feature__title">和团队一起写</h3>
            <p className="feature__body">
              我们计划支持把文档共享给同事、同时编辑、在旁边留评论——一份文档大家
              一起改，不用再来回传文件。
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}
