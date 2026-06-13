(function (global) {
  const LIMIT = 200;

  class UndoManager {
    constructor(doc) {
      this.doc = doc;
      this.stack = [doc.body.innerHTML];
      this.idx = 0;
      this.timer = null;
    }

    checkpoint() {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      const s = this.doc.body.innerHTML;
      if (s === this.stack[this.idx]) return;
      this.stack = this.stack.slice(0, this.idx + 1);
      this.stack.push(s);
      if (this.stack.length > LIMIT) this.stack.shift();
      this.idx = this.stack.length - 1;
    }

    scheduleCheckpoint() {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.checkpoint(), 500);
    }

    undo() {
      this.checkpoint();
      if (this.idx > 0) {
        this.idx--;
        this.doc.body.innerHTML = this.stack[this.idx];
        return true;
      }
      return false;
    }

    redo() {
      // 与 undo 对称：先把未提交的编辑 checkpoint 掉，免得 redo 覆盖丢失它们。
      // 无改动时 checkpoint 是 no-op（不动 redo 分支）；有改动时提交它、redo 自然变 no-op。
      this.checkpoint();
      if (this.idx < this.stack.length - 1) {
        this.idx++;
        this.doc.body.innerHTML = this.stack[this.idx];
        return true;
      }
      return false;
    }
  }

  // 已知取舍：撤销后不还原光标位置，v1 接受
  const api = { UndoManager };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2Undo = api;
})(typeof window !== 'undefined' ? window : globalThis);
