(function (global) {
  // HVE_InsertPanel 等价物：「+ 插入」面板 + 元素工厂。Float（绝对定位、可任意拖）/ Flow（文档流）
  // 两模式 + 10 种 heyhtml 元素类型。工厂是纯函数（jsdom 可单测）：用 doc.createElement + INLINE
  // 样式（CSSOM el.style.cssText，绝不 setAttribute('style')/<style>，KTD2）。inline 样式是普通
  // 内联样式，序列化原样保留（KTD4——白名单零改）；插入内容**不**盖任何 data-ws2-* 标记。
  // 面板本身是父层 chrome（shell.css 类，非注入 iframe），满足 renderer CSP。

  // ---- 纯工厂 ----

  // 10 种类型 → 一个干净、带 inline 样式的元素。样式以分号串拼好一次性写 el.style.cssText（CSSOM）。
  // 不盖 data-ws2-*（KTD4），不依赖外部 class/`<style>`，全 inline → 序列化白嫖、存盘干净。
  function createElement(doc, type) {
    let el;
    switch (type) {
      case 'container': {
        el = doc.createElement('div');
        el.style.cssText = 'min-height:80px;padding:16px;border:1px dashed #c4c4c4;border-radius:6px;';
        break;
      }
      case 'text': {
        el = doc.createElement('p');
        el.textContent = '文本段落';
        el.style.cssText = 'margin:0;font-size:16px;line-height:1.6;color:#1a1a1a;';
        break;
      }
      case 'heading': {
        el = doc.createElement('h2');
        el.textContent = '标题';
        el.style.cssText = 'margin:0;font-size:28px;font-weight:700;line-height:1.3;color:#1a1a1a;';
        break;
      }
      case 'table': {
        el = doc.createElement('table');
        el.style.cssText = 'border-collapse:collapse;width:240px;';
        const tbody = doc.createElement('tbody');
        for (let r = 0; r < 2; r++) {
          const tr = doc.createElement('tr');
          for (let c = 0; c < 2; c++) {
            const td = doc.createElement('td');
            td.style.cssText = 'border:1px solid #d0d0d0;padding:8px 12px;';
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
        el.appendChild(tbody);
        break;
      }
      case 'image': {
        el = doc.createElement('img');
        // 占位灰块（data-uri 1x1 透明 GIF），尺寸盒撑出可见区域；用户后续替换 src。
        el.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
        el.setAttribute('alt', '');
        el.style.cssText = 'display:block;width:200px;height:120px;background:#ececec;border:1px solid #dcdcdc;border-radius:4px;object-fit:cover;';
        break;
      }
      case 'button': {
        el = doc.createElement('button');
        el.textContent = '按钮';
        el.style.cssText = 'padding:10px 20px;border:none;border-radius:6px;background:linear-gradient(135deg,#ff5a5f,#ff8a5b);color:#fff;font-size:14px;font-weight:600;cursor:pointer;';
        break;
      }
      case 'divider': {
        el = doc.createElement('hr');
        el.style.cssText = 'border:none;border-top:1px solid #d8d8d8;margin:12px 0;';
        break;
      }
      case 'link': {
        el = doc.createElement('a');
        el.setAttribute('href', '#');
        el.textContent = '链接文本';
        el.style.cssText = 'color:#1a73e8;text-decoration:underline;';
        break;
      }
      case 'list': {
        el = doc.createElement('ul');
        el.style.cssText = 'margin:0;padding-left:24px;font-size:16px;line-height:1.7;color:#1a1a1a;';
        for (let i = 0; i < 3; i++) {
          const li = doc.createElement('li');
          li.textContent = '列表项';
          el.appendChild(li);
        }
        break;
      }
      case 'quote': {
        el = doc.createElement('blockquote');
        el.textContent = '引用内容';
        el.style.cssText = 'margin:0;padding:8px 16px;border-left:4px solid #ff5a5f;color:#555;font-style:italic;';
        break;
      }
      default:
        return null;
    }
    return el;
  }

  // Float：绝对定位，落点 = 视口坐标 + 当前滚动偏移（doc 坐标），append 到 body。CSSOM 写样式。
  function placeFloat(doc, el, x, y, win) {
    win = win || doc.defaultView || {};
    el.style.position = 'absolute';
    el.style.left = (x + (win.scrollX || 0)) + 'px';
    el.style.top = (y + (win.scrollY || 0)) + 'px';
    el.style.zIndex = '10';
    doc.body.appendChild(el);
    return el;
  }

  // Flow：有被选元素 → 插在其后；否则插到 body 顶部（heyhtml Flow 语义）。
  function placeFlow(doc, el, selectedEl) {
    if (selectedEl && selectedEl.after) selectedEl.after(el);
    else doc.body.prepend(el);
    return el;
  }

  // ---- 面板 UI（父层 chrome） ----

  const TYPES = [
    { type: 'container', label: '容器' },
    { type: 'text', label: '文本' },
    { type: 'heading', label: '标题' },
    { type: 'table', label: '表格' },
    { type: 'image', label: '图片' },
    { type: 'button', label: '按钮' },
    { type: 'divider', label: '分隔线' },
    { type: 'link', label: '链接' },
    { type: 'list', label: '列表' },
    { type: 'quote', label: '引用' },
  ];

  function attach(host, deps) {
    deps = deps || {};
    const doc = deps.doc;
    const getSelectedEl = deps.getSelectedEl || (() => null);
    const canvas = deps.canvas || null;
    const undoMgr = deps.undoMgr || null;
    const markDirty = deps.markDirty || (() => {});
    const win = deps.win || (doc && doc.defaultView) || {};
    const d = host.ownerDocument; // 父层 renderer document（面板属父层 chrome）

    let mode = 'flow';

    const trigger = d.createElement('button');
    trigger.className = 'tb-btn tb-textbtn';
    trigger.textContent = '+ 插入';
    trigger.title = '插入元素';
    trigger.addEventListener('click', togglePanel);

    const panel = d.createElement('div');
    panel.className = 'insert-panel';

    // Float/Flow 分段切换
    const toggleRow = d.createElement('div');
    toggleRow.className = 'insert-modes';
    const flowBtn = d.createElement('button');
    flowBtn.className = 'insert-mode active';
    flowBtn.textContent = 'Flow 文档流';
    const floatBtn = d.createElement('button');
    floatBtn.className = 'insert-mode';
    floatBtn.textContent = 'Float 浮动';
    function setMode(m) {
      mode = m;
      flowBtn.classList.toggle('active', m === 'flow');
      floatBtn.classList.toggle('active', m === 'float');
    }
    flowBtn.addEventListener('click', () => setMode('flow'));
    floatBtn.addEventListener('click', () => setMode('float'));
    toggleRow.append(flowBtn, floatBtn);

    // 10 种类型网格
    const grid = d.createElement('div');
    grid.className = 'insert-grid';
    for (const t of TYPES) {
      const cell = d.createElement('button');
      cell.className = 'insert-cell';
      cell.textContent = t.label;
      cell.addEventListener('click', () => insert(t.type));
      grid.appendChild(cell);
    }

    panel.append(toggleRow, grid);
    host.append(trigger, panel);

    function openPanel() { panel.classList.add('open'); }
    function closePanel() { panel.classList.remove('open'); }
    function togglePanel() {
      if (panel.classList.contains('open')) closePanel();
      else openPanel();
    }

    function insert(type) {
      if (!doc) return;
      const el = createElement(doc, type);
      if (!el) return;
      if (mode === 'float') {
        // 默认落点：视口中心偏左上一点（避开手柄/选中框边缘），加滚动偏移。
        const vw = win.innerWidth || 800;
        const vh = win.innerHeight || 600;
        placeFloat(doc, el, Math.round(vw / 2) - 100, Math.round(vh / 2) - 40, win);
      } else {
        placeFlow(doc, el, getSelectedEl());
      }
      if (canvas && canvas.select) canvas.select(el); // 选中新元素 → 出手柄 + 可拖
      if (undoMgr && undoMgr.checkpoint) undoMgr.checkpoint(); // 插入 = 结构变更 → html 快照 undo
      markDirty();
      closePanel();
    }

    // 点面板外（含触发钮外）关闭
    function onDocDown(e) {
      if (!panel.contains(e.target) && e.target !== trigger) closePanel();
    }
    d.addEventListener('mousedown', onDocDown);

    function detach() {
      d.removeEventListener('mousedown', onDocDown);
      trigger.remove();
      panel.remove();
    }

    return { detach };
  }

  const api = { createElement, placeFloat, placeFlow, attach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2Insert = api;
})(typeof window !== 'undefined' ? window : globalThis);
