// 隐藏驻留收口的单测：全屏下必须「先退全屏、等事件、再藏」，否则 macOS 吞掉 hide 留下空 Space（黑屏）。
// 注入 window-like 假对象记录调用序，断言的是**顺序不变量**——把 hideForResidency 里的全屏分支删掉，
// 「hide 在退全屏前被调用」这条立刻翻红（变异自检已验）。
const { test } = require('node:test');
const assert = require('node:assert');
const { hideForResidency } = require('../src/lib/window-residency');

// 最小 window 替身：记录调用序 + 手动触发 once 注册的事件。
function fakeWin({ fullScreen = false, destroyed = false } = {}) {
  const calls = [];
  const listeners = new Map();
  return {
    calls,
    _fullScreen: fullScreen,
    _destroyed: destroyed,
    isFullScreen() { return this._fullScreen; },
    isDestroyed() { return this._destroyed; },
    hide() { calls.push('hide'); },
    setFullScreen(v) { calls.push('setFullScreen:' + v); this._fullScreen = v; },
    once(ev, cb) { calls.push('once:' + ev); listeners.set(ev, cb); },
    // 测试驱动：模拟 macOS 转场完成后主进程收到的事件
    emit(ev) { const cb = listeners.get(ev); if (cb) cb(); },
  };
}

test('非全屏：立刻藏（隐藏驻留原行为不变）', () => {
  const w = fakeWin({ fullScreen: false });
  assert.strictEqual(hideForResidency(w), 'hide');
  assert.deepStrictEqual(w.calls, ['hide']);
});

test('全屏：先退全屏、hide 必须等到 leave-full-screen 之后（黑屏 bug 的核心不变量）', () => {
  const w = fakeWin({ fullScreen: true });
  assert.strictEqual(hideForResidency(w), 'exit-fullscreen-then-hide');
  // 关键：此刻还不能藏——直接 hide 就是 macOS 吞掉、留空 Space 的那条老路
  assert.ok(!w.calls.includes('hide'), '退全屏落定前不许 hide，实际调用序: ' + w.calls.join(','));
  assert.deepStrictEqual(w.calls, ['once:leave-full-screen', 'setFullScreen:false']);
  w.emit('leave-full-screen'); // macOS 转场完成
  assert.deepStrictEqual(w.calls, ['once:leave-full-screen', 'setFullScreen:false', 'hide']);
});

test('全屏转场中窗口被销毁：不对已销毁窗口 hide（防 TypeError 崩主进程）', () => {
  const w = fakeWin({ fullScreen: true });
  hideForResidency(w);
  w._destroyed = true;
  w.emit('leave-full-screen');
  assert.ok(!w.calls.includes('hide'), '窗口已销毁仍调了 hide');
});

test('已销毁窗口：直接 noop，不碰任何 API', () => {
  const w = fakeWin({ destroyed: true });
  assert.strictEqual(hideForResidency(w), 'noop');
  assert.deepStrictEqual(w.calls, []);
});

test('全屏下连点两次关闭：hide 幂等、不早于退全屏（转场中重复触发不塌）', () => {
  const w = fakeWin({ fullScreen: true });
  hideForResidency(w);
  w._fullScreen = true; // 转场未完成，第二次点时仍是全屏态
  hideForResidency(w);
  assert.ok(!w.calls.includes('hide'), '转场中不许 hide');
  w.emit('leave-full-screen');
  assert.ok(w.calls.includes('hide'), '转场完成后应当藏起来');
});
