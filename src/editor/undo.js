(function (global) {
  const LIMIT = 200;

  // DOM 索引路径：从 body 出发，记录每一层的子元素下标。撤销/重做时按路径重新解析元素，
  // 这样即使中途有一次 html 快照（innerHTML 整体重写、旧 ref 失效）也能重新定位。
  function pathOf(el, body) {
    const path = [];
    let n = el;
    while (n && n !== body) {
      const parent = n.parentNode;
      if (!parent) return null;
      path.unshift(Array.prototype.indexOf.call(parent.children, n));
      n = parent;
    }
    return n === body ? path : null;
  }

  function resolvePath(path, body) {
    let n = body;
    for (const i of path) {
      if (!n || !n.children || i < 0 || i >= n.children.length) return null;
      n = n.children[i];
    }
    return n;
  }

  class UndoManager {
    constructor(doc) {
      this.doc = doc;
      // 时间线：第 0 项恒为 html 基线快照；其上每项是一次「转换」op（html 全量快照或 prop 元素属性变更）。
      // idx 指向「已应用到当前状态的最后一个 op」。
      this.stack = [{ kind: 'html', html: this._cleanHtml() }];
      this.idx = 0;
      this.timer = null;
      this.coalesce = null; // { key, op } —— beginCoalesce 期间把同 key 的多帧并进一个 prop op
      this._applied = this._cleanHtml(); // 上次落 op / checkpoint 后的真实 DOM 序列化（判脏基准）
    }

    // 用于快照/判脏的 body innerHTML：剥掉编辑器标记（选中/编辑态属性、contenteditable）后再比较——
    // 否则纯状态 toggle 会被当成内容变更、产生看不见的「假」撤销步。renderer 有 WS2Serialize 时用它
    // （与存盘同一白名单，不误删用户自带 data-ws2-*）；node 单测无该全局则回退原始 innerHTML。
    _cleanHtml() {
      const body = this.doc.body;
      if (typeof WS2Serialize !== 'undefined' && WS2Serialize.cleanedBodyHtml) return WS2Serialize.cleanedBodyHtml(body);
      return body.innerHTML;
    }
    // U10（KD5）：折叠态 fold 从撤销轴解耦——快照剥了 open（全折叠），undo/redo 重写 innerHTML 后按
    // <details> 文档序位置索引把「重写前的活 fold」重贴回去，内容撤销不扰用户当前折叠态。身份=位置索引
    //（innerHTML 重写销毁元素引用、data-ws2 标记被剥，无稳定 id）；已知 v1 局限：结构性 toggle 增删的撤销
    // 会让 fold 漂移（内容不丢，复活的 toggle 回到折叠态）。设 d.open 会触发原生 toggle→markDirty（已 dirty，无害）。
    _captureFold() { return [...this.doc.body.querySelectorAll('details')].map((d) => d.open); }
    _applyFold(fold) { const ds = this.doc.body.querySelectorAll('details'); for (let i = 0; i < ds.length; i++) ds[i].open = !!fold[i]; }

    // 砍掉 idx 之后的 redo 尾、push 新 op、维持 LIMIT 截断、idx 前移。
    _push(op) {
      this.stack = this.stack.slice(0, this.idx + 1);
      this.stack.push(op);
      if (this.stack.length > LIMIT) this.stack.shift();
      this.idx = this.stack.length - 1;
      this._applied = this._cleanHtml();
    }

    checkpoint() {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      // 栈顶是 prop op 时跳过：DOM 与最近 html 基线的差异已被那个 prop op 解释，
      // 再快照会埋掉 prop op、破坏 LIFO（prop 走 recordStyleOp 这条 path，不靠快照）。
      if (this.stack[this.idx].kind === 'prop') return;
      const s = this._cleanHtml();
      if (s === this._applied) return; // 跟「上次落 op 后的真实 DOM」比，而非存储基线串——避免 cssText 归一化被误判成脏
      this._push({ kind: 'html', html: s });
    }

    // 当前生效状态对应的 html 文本：取 idx 处或其下方最近的 html 快照。
    // prop op 不携带整页 html，所以遇到 prop 要往下找最近的 html 基线。
    _lastHtml() {
      for (let i = this.idx; i >= 0; i--) {
        if (this.stack[i].kind === 'html') return this.stack[i].html;
      }
      return null;
    }

    scheduleCheckpoint() {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.checkpoint(), 500);
    }

    // 元素级 inline-style 变更记一个 prop op：path 寻址、before/after 是完整 style 字符串。
    // 合并态下（beginCoalesce 已开）同 key 的连续调用塌成一个 op——首帧建、后续只更新 after。
    recordStyleOp(el, before, after, coalesceKey) {
      if (this.coalesce && (coalesceKey === undefined || coalesceKey === this.coalesce.key)) {
        if (!this.coalesce.op) {
          const path = pathOf(el, this.doc.body);
          if (!path) return false;
          this.coalesce.op = { kind: 'prop', path, before, after, coalesceKey: this.coalesce.key };
        } else {
          this.coalesce.op.after = after; // path/before 保持首帧
        }
        return true;
      }
      const path = pathOf(el, this.doc.body);
      if (!path) return false;
      this._push({ kind: 'prop', path, before, after, coalesceKey });
      return true;
    }

    // 开始合并一次连续操作（如一次拖动的多帧 pointermove），key 用于区分目标。
    beginCoalesce(key) {
      this.commit(); // 防御：上一段没 commit 干净，先收尾
      this.coalesce = { key, op: null };
    }

    // 结束合并：把累积出的单个 prop op 落进历史（若整段没有净变化则不落）。
    commit() {
      if (!this.coalesce) return;
      const pending = this.coalesce;
      this.coalesce = null;
      if (pending.op && pending.op.before !== pending.op.after) {
        this._push(pending.op);
      }
    }

    undo() {
      this.commit();
      this.checkpoint();
      if (this.idx <= 0) return false;
      const op = this.stack[this.idx];
      if (op.kind === 'prop') {
        const el = resolvePath(op.path, this.doc.body);
        // 写样式走 CSSOM cssText（不是 setAttribute('style')）——后者被文档严格 style-src CSP 拦（KTD2）
        if (el) el.style.cssText = op.before || '';
        this.idx--;
      } else { // html op：还原到它下方最近的 html 基线
        this.idx--;
        const html = this._lastHtml();
        if (html !== null) { const fold = this._captureFold(); this.doc.body.innerHTML = html; this._applyFold(fold); } // U10：重贴活 fold
      }
      this._applied = this._cleanHtml();
      return true;
    }

    redo() {
      // 与 undo 对称：先收尾合并、再把未提交编辑 checkpoint 掉，免得 redo 覆盖丢失它们。
      // 无改动时 checkpoint 是 no-op（不动 redo 分支）；有改动时提交它、redo 自然变 no-op。
      this.commit();
      this.checkpoint();
      if (this.idx >= this.stack.length - 1) return false;
      const next = this.stack[this.idx + 1];
      this.idx++;
      if (next.kind === 'prop') {
        const el = resolvePath(next.path, this.doc.body);
        if (el) el.style.cssText = next.after || ''; // CSSOM 写回，CSP-safe（KTD2）
      } else {
        const fold = this._captureFold(); this.doc.body.innerHTML = next.html; this._applyFold(fold); // U10：重贴活 fold
      }
      this._applied = this._cleanHtml();
      return true;
    }
  }

  // 已知取舍：撤销后不还原光标位置，v1 接受
  const api = { UndoManager };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2Undo = api;
})(typeof window !== 'undefined' ? window : globalThis);
