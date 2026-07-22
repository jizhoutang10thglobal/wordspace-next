/* src/lib/edge-zones.js
 * 收起态 peek 触发区的**纯几何判定**(无 electron / 无 DOM)——主进程光标轮询 watcher 与 node:test 共用。
 * 背景(Wendi 2026-07-22「必须精确停在那道缝上」):原 DOM 热区只有窗内 10px 竖条 + 120ms 停留,
 * ①快速划过(进→出)被取消 ②鼠标甩过头落到窗外 = DOM 收不到事件、永远不触发 ③没有左上角触发区。
 * Arc 的手感 = 全局光标监听:滑到窗口左缘附近(含甩出窗外)或左上角就唤出。本模块给 watcher 判
 * 「光标在不在触发区/驻留区」,轮询本身在 ipc.js(只在收起态跑、win 聚焦时判、xvfb try/catch 护)。
 *
 * 区域(相对窗口 bounds{x,y,width,height},pt={x,y} 为屏幕坐标):
 *  - 左缘带: [x-OUT, x+IN] × [y, y+height]   —— 甩出窗外 OUT px 内也认(Arc 式宽容)
 *  - 左上角: [x, x+CORNER_W] × [y, y+CORNER_H] —— 灯所在那片,Arc 同款唤出区
 *  - peek 开着时的驻留区: [x-OUT, x+cardWidth+CARD_PAD] × [y, y+height]
 *    (光标在卡上/卡右缘缓冲内不算离开——离开判定交给它 + DOM mouseleave 双保险)
 * 双导出:主进程 require;测试 node:test。
 */
(function (root) {
  'use strict';
  const OUT = 24;        // 窗外宽容带(甩过头仍触发)
  const IN = 16;         // 窗内触发带(比可见 10px 缝宽,不用精确停)
  const CORNER_W = 80;   // 左上角唤出区宽(≈红绿灯那片)
  const CORNER_H = 48;   // 左上角唤出区高
  const CARD_PAD = 24;   // peek 卡右缘的离开缓冲
  const FS_TOP = 8;      // 全屏顶缘唤出带高(Colin 2026-07-22:全屏推顶=顶栏下拉+侧栏同滑出,灯只活在卡上)

  // 光标是否落在「唤出触发区」(左缘带 ∪ 左上角区;全屏时再 ∪ 顶缘带全宽)。
  function inTriggerZone(bounds, pt, fullscreen) {
    if (!bounds || !pt) return false;
    const inBandX = pt.x >= bounds.x - OUT && pt.x <= bounds.x + IN;
    const inBandY = pt.y >= bounds.y && pt.y <= bounds.y + bounds.height;
    if (inBandX && inBandY) return true;
    const inCorner = pt.x >= bounds.x && pt.x <= bounds.x + CORNER_W
      && pt.y >= bounds.y && pt.y <= bounds.y + CORNER_H;
    if (inCorner) return true;
    // 全屏专属:顶缘带(与 macOS 菜单栏下拉同区)——推顶时侧栏跟着滑出,关闭钮在卡上、顶栏不重复放灯。
    // 非全屏不做:窗顶那条是拖拽带,顶缘触发会跟拖窗打架。
    if (fullscreen) {
      return pt.y >= bounds.y && pt.y <= bounds.y + FS_TOP
        && pt.x >= bounds.x && pt.x <= bounds.x + bounds.width;
    }
    return false;
  }

  // peek 开着时,光标是否仍在「驻留区」(触发区 ∪ 卡片区+右缘缓冲)——不在了才算离开。
  function inDwellZone(bounds, pt, cardWidth, fullscreen) {
    if (!bounds || !pt) return false;
    if (inTriggerZone(bounds, pt, fullscreen)) return true;
    const w = (typeof cardWidth === 'number' && cardWidth > 0 ? cardWidth : 260) + CARD_PAD;
    return pt.x >= bounds.x - OUT && pt.x <= bounds.x + w
      && pt.y >= bounds.y && pt.y <= bounds.y + bounds.height;
  }

  const api = { inTriggerZone, inDwellZone, OUT, IN, CORNER_W, CORNER_H, CARD_PAD, FS_TOP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WS2EdgeZones = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
