// 更新 UI：侧栏 pill + 更新面板。数据整包来自 main（update-status 推送 / update-get-status 启动补拉），
// 展示模型（panel/pill）在 main 用 src/lib/update-status.js 算好，这里零业务判断、只渲染 + 面板开合策略：
//   manual（用户点「检查更新…」）→ 面板全程跟进；自动路径 → 只挂 pill，下载完成 toast 提示一次。
// 所有文本一律 textContent（release notes 来自 GitHub body，不可信，绝不 innerHTML）。
(() => {
  'use strict';
  const pillEl = document.getElementById('sb-update');
  if (!pillEl || !window.ws2 || !window.ws2.onUpdateStatus) return;
  const pillTxt = document.getElementById('sb-update-txt');
  const pillBar = document.getElementById('sb-update-bar');
  const pillFill = document.getElementById('sb-update-fill');

  let last = null; // 最新 payload {status, panel, pill}
  let panelOpen = false;
  let overlay = null;
  let readyToasted = false;

  function act(id) {
    if (id === 'close') { closePanel(); return; }
    if (id === 'download') window.ws2.updateDownload();
    else if (id === 'install') window.ws2.updateInstall();
    else if (id === 'check') window.ws2.updateCheck();
  }

  function renderPill(pill) {
    if (!pill) { pillEl.hidden = true; return; }
    pillEl.hidden = false;
    const pct = pill.kind === 'downloading' && pill.percent != null ? ' · ' + pill.percent + '%' : '';
    pillTxt.textContent = pill.text + pct;
    pillEl.classList.toggle('is-ready', pill.kind === 'ready');
    pillBar.hidden = pill.kind !== 'downloading';
    if (pill.kind === 'downloading') {
      // percent=null（刚起步）给一小截当「不定进度」；有进度后按真实值走
      pillFill.style.width = (pill.percent == null ? 8 : Math.max(4, pill.percent)) + '%';
    }
  }

  let cardRefs = null; // 增量渲染缓存：{sig, title, bodyLines, bar, fill, detail}——同构模型只原地改值

  // 用户在哪个状态下关掉了面板：同状态的后续推送不再自动弹回（点「后台下载」0.2 秒后被
  // 下一条进度推送打脸重开——Colin 2026-07-17 实踩,#169 原始「手动路径推送必开面板」的策略洞）。
  // 状态跃迁（如 downloading→ready）仍自动弹——「全程跟进」的本意是跟里程碑,不是跟每个进度 tick。
  let dismissedAtState = null;

  function closePanel() {
    if (overlay) overlay.remove();
    overlay = null;
    cardRefs = null;
    panelOpen = false;
    dismissedAtState = last && last.status ? last.status.state : null;
  }

  function openPanel() {
    panelOpen = true;
    dismissedAtState = null;
    renderPanel();
  }

  // 面板结构签名：state + 按钮 + body 行类型 + 有无进度/spinner。签名相同 = 只有文本/进度值在变。
  function modelSig(model) {
    return model.state
      + '|' + (model.buttons || []).map((b) => b.id + ':' + b.label + (b.primary ? '*' : '')).join(',')
      + '|' + (model.body || []).map((l) => l.t).join(',')
      + '|' + (model.progress ? 'p' : '') + (model.spinner ? 's' : '');
  }

  function renderPanel() {
    if (!panelOpen) return;
    const model = last && last.panel;
    if (!model) { closePanel(); return; }
    if (!overlay) {
      // 单例守卫（同 aiax/fp 弹层惯例）：别与保存框等其他 modal 叠层——放弃本次打开，pill 还在随时可再点
      if (document.querySelector('.sb-modal-overlay')) { panelOpen = false; return; }
      overlay = document.createElement('div');
      overlay.className = 'sb-modal-overlay'; // 复用壳：browser.js 的 view 摘除守卫/各处弹层判定自动生效
      overlay.id = 'up-overlay';
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closePanel(); });
      overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePanel(); } });
      document.body.appendChild(overlay);
    }
    // 增量路径：结构没变（下载进度这类每 ~200ms 一次的推送）只原地改文本/宽度——整卡拆重建 + 每次
    // 重抢焦点就是「进度框不停闪」的病根（Wendi 2026-07-16）。不拆卡、不动焦点。
    const sig = modelSig(model);
    if (cardRefs && cardRefs.sig === sig) {
      cardRefs.title.textContent = model.title;
      (model.body || []).forEach((line, i) => {
        if (cardRefs.bodyLines[i]) cardRefs.bodyLines[i].textContent = line.text;
      });
      if (model.progress && cardRefs.fill) {
        const pct = model.progress.percent;
        cardRefs.bar.classList.toggle('is-indet', pct == null);
        if (pct != null) cardRefs.fill.style.width = pct + '%';
        cardRefs.detail.textContent = (pct != null ? pct + '% · ' : '') + model.progress.detail;
      }
      return;
    }
    overlay.textContent = '';
    const card = document.createElement('div');
    card.className = 'sb-modal up-card';
    card.dataset.state = model.state; // e2e/调试锚点

    const head = document.createElement('div');
    head.className = 'sb-modal-head';
    const headText = document.createElement('div');
    headText.className = 'sb-modal-head-text';
    const title = document.createElement('div');
    title.className = 'sb-modal-title';
    title.textContent = model.title;
    headText.appendChild(title);
    head.appendChild(headText);
    const x = document.createElement('button');
    x.className = 'sb-modal-x';
    x.textContent = '×';
    x.title = window.wsT('common.close');
    x.addEventListener('click', closePanel);
    head.appendChild(x);
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'sb-modal-body up-body';
    if (model.spinner) {
      const sp = document.createElement('div');
      sp.className = 'up-spinner';
      body.appendChild(sp);
    }
    const bodyLines = [];
    for (const line of model.body || []) {
      const el = document.createElement('div');
      el.className = 'up-line up-line-' + line.t;
      el.textContent = line.text;
      body.appendChild(el);
      bodyLines.push(el);
    }
    let bar = null, fill = null, detail = null;
    if (model.progress) {
      const prog = document.createElement('div');
      prog.className = 'up-prog';
      bar = document.createElement('div');
      bar.className = 'up-prog-bar' + (model.progress.percent == null ? ' is-indet' : '');
      fill = document.createElement('div');
      fill.className = 'up-prog-fill';
      fill.id = 'up-prog-fill';
      if (model.progress.percent != null) fill.style.width = model.progress.percent + '%';
      bar.appendChild(fill);
      prog.appendChild(bar);
      detail = document.createElement('div');
      detail.className = 'up-prog-detail';
      detail.textContent = (model.progress.percent != null ? model.progress.percent + '% · ' : '') + model.progress.detail;
      prog.appendChild(detail);
      body.appendChild(prog);
    }
    card.appendChild(body);

    if (model.buttons && model.buttons.length) {
      const foot = document.createElement('div');
      foot.className = 'up-foot';
      for (const b of model.buttons) {
        const btn = document.createElement('button');
        btn.className = 'up-btn' + (b.primary ? ' up-btn-primary' : '');
        btn.dataset.act = b.id;
        btn.textContent = b.label;
        btn.addEventListener('click', () => act(b.id));
        foot.appendChild(btn);
      }
      card.appendChild(foot);
    }
    overlay.appendChild(card);
    cardRefs = { sig, title, bodyLines, bar, fill, detail };
    // 焦点只在结构重建（状态跃迁）时给一次——增量路径绝不抢焦点（每 200ms 抢一次也是闪烁源之一）
    const primary = card.querySelector('.up-btn-primary') || card.querySelector('.up-btn');
    if (primary) primary.focus();
  }

  function onPayload(p, fromPush) {
    last = p;
    renderPill(p && p.pill);
    const st = p && p.status;
    // 面板开合：手动路径的推送 → 打开并全程跟进；已开着 → 任何推送都刷新内容。
    // 「跟进」只跟状态跃迁：用户关掉面板后,同状态推送不再弹回（后台下载不被进度 tick 打脸重开）。
    if (fromPush && st && st.manual && p.panel && !panelOpen && st.state !== dismissedAtState) openPanel();
    else renderPanel();
    // 自动路径下载完成：低打扰提示一次（web 标签态临时收缩 view 底部，toast 不被原生 view 盖住）
    if (fromPush && st && st.state === 'ready' && !panelOpen && !readyToasted) {
      readyToasted = true;
      if (window.__wsToast) window.__wsToast(window.wsT('update.toastReady'), window.wsT('update.restartInstall'), () => window.ws2.updateInstall());
      if (window.__webToastInset) window.__webToastInset();
    }
    if (st && st.state !== 'ready') readyToasted = false;
  }

  pillEl.addEventListener('click', () => { if (!panelOpen) openPanel(); });
  window.ws2.onUpdateStatus((p) => onPayload(p, true));
  // 启动补拉：main 的启动检查/静默下载可能先于本脚本就绪（loadTabs 同款竞态）——补拉只挂 pill、不弹面板
  window.ws2.updateGetStatus().then((p) => { if (p && p.status) onPayload(p, false); }).catch(() => {});
})();
