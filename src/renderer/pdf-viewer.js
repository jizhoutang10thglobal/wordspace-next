// PDF.js viewer：用 Mozilla pdfjs-dist 渲染 PDF 成 canvas 连续滚动，替代 Chromium 内置 viewer。
// 解决 Wendi B7（工具栏合并成一行 = wordspace 自己的）+ B8（默认无左侧预览栏 = 自己 UI 不画）。
// classic script（window.WS2PdfViewer），用动态 import() 懒加载 PDF.js（ESM，6.x）。worker 在
// Electron file://+CSP 直接能跑（U1 probe 验过，不用调 CSP）。
(function (global) {
  let pdfjsLib = null;
  async function loadLib() {
    if (pdfjsLib) return pdfjsLib;
    pdfjsLib = await import('../../node_modules/pdfjs-dist/build/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      new URL('../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', window.location.href).href;
    return pdfjsLib;
  }

  const ZOOM_MIN = 0.25, ZOOM_MAX = 4, ZOOM_STEP = 0.2;

  // 挂载：在 viewer 元素里建「一行工具栏 + 连续滚动 canvas 舞台」并渲染 url 指向的 PDF。
  // toolbarExtra：调用方把「文件名 / 在外部打开」等已有控件塞进工具栏左/右（复用 fv-bar 风格）。
  async function mount(viewer, url, opts) {
    opts = opts || {};
    viewer.innerHTML = '';
    viewer.hidden = false;

    const bar = document.createElement('div');
    bar.className = 'fv-bar pdfv-bar';
    const name = document.createElement('span');
    name.className = 'fv-name';
    name.textContent = opts.fileName || 'PDF';
    name.title = opts.fileName || 'PDF'; // 名字过长被截断时，悬停显示全名
    const tag = document.createElement('span');
    tag.className = 'fv-tag';
    tag.textContent = 'PDF · 只读'; // 对齐图片查看器/ui-demo（T4 审计 #120：补只读语义标）
    const pageInfo = document.createElement('span');
    pageInfo.className = 'pdfv-pageinfo';
    pageInfo.textContent = '… / …';
    const sp = document.createElement('div');
    sp.className = 'fv-sp';
    const zoomOut = iconBtn('pdfv-zbtn', '−', '缩小');
    const zoomLabel = document.createElement('span');
    zoomLabel.className = 'pdfv-zlabel';
    const zoomIn = iconBtn('pdfv-zbtn', '＋', '放大');
    const fitBtn = iconBtn('pdfv-fit', '适应宽度', '适应宽度');
    bar.append(name, tag, pageInfo, sp, zoomOut, zoomLabel, zoomIn, fitBtn);
    if (opts.openExternalEl) bar.appendChild(opts.openExternalEl);
    viewer.appendChild(bar);

    const stage = document.createElement('div');
    stage.className = 'pdfv-stage';
    viewer.appendChild(stage);

    const lib = await loadLib();
    let doc;
    try {
      doc = await lib.getDocument({ url }).promise;
    } catch (e) {
      stage.innerHTML = '<div class="pdfv-err">PDF 打开失败：' + ((e && e.message) || e) + '</div>';
      return;
    }
    const numPages = doc.numPages;

    // 缓存每页 page 对象 + 原始尺寸（scale=1），缩放只改渲染尺寸不重取 page。
    const pages = [];
    for (let i = 1; i <= numPages; i++) {
      const pg = await doc.getPage(i);
      const vp1 = pg.getViewport({ scale: 1 });
      const canvas = document.createElement('canvas');
      canvas.className = 'pdfv-page';
      canvas.dataset.pageNo = String(i);
      stage.appendChild(canvas);
      pages.push({ pg, w1: vp1.width, h1: vp1.height, canvas });
    }

    let scale = 1;
    let fitMode = true; // 默认适应宽度
    function fitWidthScale() {
      const avail = stage.clientWidth - 48; // 留两侧内距
      const widest = Math.max(...pages.map((p) => p.w1));
      return widest > 0 ? Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, avail / widest)) : 1;
    }
    async function renderAll() {
      const s = fitMode ? fitWidthScale() : scale;
      zoomLabel.textContent = Math.round(s * 100) + '%';
      for (const p of pages) {
        const vp = p.pg.getViewport({ scale: s * (global.devicePixelRatio || 1) });
        p.canvas.width = vp.width;
        p.canvas.height = vp.height;
        p.canvas.style.width = Math.round(p.w1 * s) + 'px';
        p.canvas.style.height = Math.round(p.h1 * s) + 'px';
        await p.pg.render({ canvasContext: p.canvas.getContext('2d'), viewport: vp }).promise;
      }
    }
    function setScale(s) { fitMode = false; scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, s)); renderAll(); }

    zoomOut.onclick = () => setScale((fitMode ? fitWidthScale() : scale) - ZOOM_STEP);
    zoomIn.onclick = () => setScale((fitMode ? fitWidthScale() : scale) + ZOOM_STEP);
    fitBtn.onclick = () => { fitMode = true; renderAll(); };
    // Ctrl/Cmd + 滚轮缩放
    stage.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setScale((fitMode ? fitWidthScale() : scale) + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
    }, { passive: false });

    // 滚动更新「当前页 / 总页」：取舞台中线落在哪个 canvas。
    function updatePageInfo() {
      const mid = stage.scrollTop + stage.clientHeight / 2;
      let cur = 1;
      for (const p of pages) {
        if (p.canvas.offsetTop <= mid) cur = Number(p.canvas.dataset.pageNo);
      }
      pageInfo.textContent = cur + ' / ' + numPages;
    }
    stage.addEventListener('scroll', updatePageInfo);

    await renderAll();
    updatePageInfo();
  }

  function iconBtn(cls, text, title) {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = text;
    b.title = title;
    return b;
  }

  global.WS2PdfViewer = { mount };
})(window);
