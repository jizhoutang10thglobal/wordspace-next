(function (global) {
  // HVE_AlignGuide 等价物：拖动中算被拖框与其它顶层元素的对齐关系（边 + 中心），画品红辅助线 +
  // 距离标注，阈值内吸附。等距（spacing）暂留空数组 stub，核心先做边/中心对齐。
  // 纯几何 computeGuides 可 jsdom/node 单测；attach 是薄 DOM 驱动，覆盖节点走 in-doc CSSOM（KTD2）。

  // ---- 纯几何 ----

  const MAGENTA = '#ff00ff';

  // 一个 rect 的三条竖向对齐坐标（决定竖线 = 垂直对齐：左/水平中心/右）和三条横向对齐坐标
  // （决定横线 = 水平对齐：上/竖直中心/下）。统一用 left/top/right/bottom（right=left+width）。
  function vCoords(r) {
    const right = r.right != null ? r.right : r.left + r.width;
    return [
      { kind: 'left', value: r.left },
      { kind: 'hcenter', value: (r.left + right) / 2 },
      { kind: 'right', value: right },
    ];
  }
  function hCoords(r) {
    const bottom = r.bottom != null ? r.bottom : r.top + r.height;
    return [
      { kind: 'top', value: r.top },
      { kind: 'vcenter', value: (r.top + bottom) / 2 },
      { kind: 'bottom', value: bottom },
    ];
  }

  function normRect(r) {
    const right = r.right != null ? r.right : r.left + r.width;
    const bottom = r.bottom != null ? r.bottom : r.top + r.height;
    return { left: r.left, top: r.top, right, bottom, width: right - r.left, height: bottom - r.top };
  }

  // 在一根轴上挑最佳候选：对 moving 的每个对齐坐标 × 每个 other 的**同类**坐标（左↔左、中心↔中心、
  // 右↔右），记录 |delta|<=threshold 的候选。同类比对避免「左边吸到别人右边」这类意外吸附，确定且可测。
  // 返回 best = {target, delta(=target-movingCoord), absDelta, otherRect} 或 null。
  // 吸附方向约定：把 moving 吸到 target，delta = target - movingCoord（movingCoord + delta === target）。
  // 选最小 |delta|；并列（|delta| 相等）取最小 target 坐标，确定性、不振荡。
  function pickAxis(movingCoords, others, otherCoordsFn, threshold) {
    let best = null;
    for (const mc of movingCoords) {
      for (const other of others) {
        for (const oc of otherCoordsFn(other.rect)) {
          if (oc.kind !== mc.kind) continue; // 同类坐标才比对
          const delta = oc.value - mc.value;
          const abs = Math.abs(delta);
          if (abs > threshold) continue;
          const cand = { target: oc.value, delta, absDelta: abs, otherRect: other.rect };
          // best：最小 |delta|；并列取最小 target
          if (!best || cand.absDelta < best.absDelta ||
              (cand.absDelta === best.absDelta && cand.target < best.target)) {
            best = cand;
          }
        }
      }
    }
    return { best };
  }

  // movingRect 在「拟落点」位置；otherRects = 其它顶层元素的框。threshold 像素阈值（~6）。
  // 返回 { snapDx, snapDy, lines:[{orientation:'v'|'h', pos, from, to, label}], spacing:[] }。
  // 无任何轴命中阈值 → lines:[], snapDx:0, snapDy:0, spacing:[]。
  function computeGuides(movingRect, otherRects, threshold) {
    threshold = threshold == null ? 6 : threshold;
    const m = normRect(movingRect);
    const others = (otherRects || []).map((r) => ({ rect: normRect(r) }));

    const vAxis = pickAxis(vCoords(m), others, vCoords, threshold); // 竖线 / 横向吸附 dx
    const hAxis = pickAxis(hCoords(m), others, hCoords, threshold); // 横线 / 纵向吸附 dy

    const snapDx = vAxis.best ? vAxis.best.delta : 0;
    const snapDy = hAxis.best ? hAxis.best.delta : 0;
    const lines = [];

    // 吸附后的框，用来算线的跨度（from/to）和距离标注
    const snapped = {
      left: m.left + snapDx, right: m.right + snapDx,
      top: m.top + snapDy, bottom: m.bottom + snapDy,
    };

    if (vAxis.best) {
      const o = vAxis.best.otherRect;
      const pos = vAxis.best.target; // 竖线 x 坐标 = 对齐到的目标坐标
      // 线跨被拖框与对齐元素的纵向并集
      const from = Math.min(snapped.top, o.top);
      const to = Math.max(snapped.bottom, o.bottom);
      // 距离标注：被拖框与对齐元素在横向上的间隙（边缘距离），>=0
      const gap = Math.max(0, Math.max(o.left - snapped.right, snapped.left - o.right));
      lines.push({ orientation: 'v', pos, from, to, label: Math.round(gap) + 'px' });
    }
    if (hAxis.best) {
      const o = hAxis.best.otherRect;
      const pos = hAxis.best.target; // 横线 y 坐标
      const from = Math.min(snapped.left, o.left);
      const to = Math.max(snapped.right, o.right);
      const gap = Math.max(0, Math.max(o.top - snapped.bottom, snapped.top - o.bottom));
      lines.push({ orientation: 'h', pos, from, to, label: Math.round(gap) + 'px' });
    }

    return { snapDx, snapDy, lines, spacing: [] };
  }

  // ---- DOM / 事件驱动（in-doc CSSOM，KTD2）----

  function attach(doc) {
    const win = doc.defaultView;
    const nodes = []; // 复用的辅助线 + 标注节点池

    function makeLineNode() {
      const el = doc.createElement('div');
      el.setAttribute('data-ws2-ui', '');
      el.setAttribute('contenteditable', 'false');
      el.style.position = 'absolute';
      el.style.display = 'none';
      el.style.pointerEvents = 'none';
      el.style.background = MAGENTA;
      el.style.zIndex = '99998';
      doc.documentElement.appendChild(el);
      return el;
    }
    function makeLabelNode() {
      const el = doc.createElement('div');
      el.setAttribute('data-ws2-ui', '');
      el.setAttribute('contenteditable', 'false');
      el.style.position = 'absolute';
      el.style.display = 'none';
      el.style.pointerEvents = 'none';
      el.style.background = MAGENTA;
      el.style.color = '#fff';
      el.style.font = '10px -apple-system, sans-serif';
      el.style.padding = '1px 4px';
      el.style.borderRadius = '2px';
      el.style.whiteSpace = 'nowrap';
      el.style.zIndex = '99999';
      doc.documentElement.appendChild(el);
      return el;
    }

    function hideAll() {
      for (const n of nodes) { n.line.style.display = 'none'; n.label.style.display = 'none'; }
    }

    function ensureSlot(i) {
      while (nodes.length <= i) nodes.push({ line: makeLineNode(), label: makeLabelNode() });
      return nodes[i];
    }

    // movingEl 当前被拖元素，proposed = {left, top} 拟落点（offsetParent 相对坐标，dragmove 写的那个）。
    // 用拟落点构造 movingRect，算 guides，渲染线 + 标注，返回吸附后的 {left, top}。
    function update(movingEl, proposed, w) {
      w = w || win;
      const sx = (w && w.scrollX) || 0;
      const sy = (w && w.scrollY) || 0;
      const mRect = movingEl.getBoundingClientRect();
      // proposed 是相对 offsetParent 的 left/top；要把 movingRect 平移到拟落点对应的视口坐标，
      // 这样和 other 元素的 getBoundingClientRect()（视口坐标）同坐标系比对。
      const op = movingEl.offsetParent || doc.documentElement;
      const opRect = op.getBoundingClientRect();
      const movingRect = {
        left: opRect.left + proposed.left,
        top: opRect.top + proposed.top,
        width: mRect.width,
        height: mRect.height,
      };

      const others = [];
      const body = doc.body;
      for (const child of Array.from(body.children)) {
        if (child === movingEl) continue;
        if (child.hasAttribute('data-ws2-ui')) continue;
        const r = child.getBoundingClientRect();
        others.push({ left: r.left, top: r.top, width: r.width, height: r.height });
      }

      const res = computeGuides(movingRect, others, 6);

      hideAll();
      res.lines.forEach((ln, i) => {
        const slot = ensureSlot(i);
        const line = slot.line;
        const label = slot.label;
        if (ln.orientation === 'v') {
          line.style.left = (ln.pos + sx) + 'px';
          line.style.top = (ln.from + sy) + 'px';
          line.style.width = '1px';
          line.style.height = (ln.to - ln.from) + 'px';
          label.style.left = (ln.pos + sx + 3) + 'px';
          label.style.top = (ln.from + sy) + 'px';
        } else {
          line.style.left = (ln.from + sx) + 'px';
          line.style.top = (ln.pos + sy) + 'px';
          line.style.width = (ln.to - ln.from) + 'px';
          line.style.height = '1px';
          label.style.left = (ln.from + sx) + 'px';
          label.style.top = (ln.pos + sy + 3) + 'px';
        }
        line.style.display = 'block';
        label.textContent = ln.label;
        label.style.display = 'block';
      });

      return { left: proposed.left + res.snapDx, top: proposed.top + res.snapDy };
    }

    function clear() { hideAll(); }

    function destroy() {
      for (const n of nodes) { n.line.remove(); n.label.remove(); }
      nodes.length = 0;
    }

    return { update, clear, destroy };
  }

  const api = { computeGuides, attach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2AlignGuide = api;
})(typeof window !== 'undefined' ? window : globalThis);
