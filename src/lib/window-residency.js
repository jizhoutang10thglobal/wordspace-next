// 隐藏驻留的收口逻辑（macOS 关窗=藏不退）。不带 require('electron')，注入 window-like 对象直测（S1）。
//
// 背景（2026-07-20 实锤，Wendi/Colin 报「全屏状态下点左上角关闭 → 黑屏」）：
// macOS 原生全屏的窗口独占一个 Space，**macOS 不接受对它的 orderOut:**——直接 win.hide() 静默失效：
// 窗口没藏起来、那个全屏 Space 也没拆，用户面对的是一块空 Space（黑屏），只能手动划走。
// 宿主实测（两轮可复现）：全屏下 close → isVisible() 6 秒后仍是 true、isFullScreen() 仍是 true；
// 同一条路在非全屏下 isVisible() 立刻变 false（对照组）；先退全屏等 leave-full-screen 再 hide → 15ms 内
// vis=false/fs=false（修复验证）。
//
// 正解 = 对齐原生 mac app：全屏下点红灯 → 先退出全屏，等 leave-full-screen 落定再藏。
// 回来时是窗口态（不恢复全屏）——与 Finder/Messages 等系统 app 的红灯语义一致。
'use strict';

/**
 * 把窗口按「隐藏驻留」语义藏起来。
 * @param {{isFullScreen:Function,setFullScreen:Function,hide:Function,once:Function,isDestroyed:Function}} win
 * @returns {'hide'|'exit-fullscreen-then-hide'|'noop'} 走了哪条路（给调用方/测试看，无副作用含义）
 */
function hideForResidency(win) {
  if (!win || win.isDestroyed()) return 'noop';
  if (!win.isFullScreen()) {
    win.hide();
    return 'hide';
  }
  // 全屏：不能直接 hide（会被 macOS 吞掉留下空 Space）。退全屏 → 等事件 → 再藏。
  // 用 once 而非 on：每次关窗各挂一次，事件到了自摘；窗口在转场中被销毁则什么都不做。
  win.once('leave-full-screen', () => {
    if (!win.isDestroyed()) win.hide();
  });
  win.setFullScreen(false);
  return 'exit-fullscreen-then-hide';
}

module.exports = { hideForResidency };
