# [P3-08] 失联根改回原路径后不自愈,必须手动「重新定位」

**问题(2/2)**:外部把根目录改名 → 根转失联灰态(对)→ 再把目录**改回一模一样的原路径** →
focus 也好、等也好,永远灰着;必须手点「重新定位」再选一次同一个文件夹。外置盘拔了再插回是同款高频场景。

**根因方向(执行时核实)**:`markRootMissing` 后没有任何复查机制;missing 根的 watcher 已注销,
没人再看那个路径(重启倒是会重判——restoreRoots 会,所以只是运行中不自愈)。

**修法(轮询,便宜且稳)**:主进程对 missing 根挂低频复活探测:每 5s `dirExists(root.path)`
(fs.stat 一次,便宜),通了 → 清 missing、重挂 watcher(`startRootWatch`)、广播 `ws-roots-changed`
+该根 `ws-tree-changed`(null=全量)。根被移除/重定位/app 退出时取消对应 timer。别用 fs.watch 盯父目录
——父目录可能也没了/是卷根,轮询 5s 对「灰态恢复」这种事足够快。

**门**:单测不适用(纯 Electron 侧胶水);e2e(multi-root spec 有失联用例,追加):改名根→灰态→改回→
`expect.poll` 断言 ≤8s 内根行恢复彩色+树回来。变异:去掉探测 timer→翻红。

**spec 记账**:多根 spec(grep 失联)补「失联根自动复活探测(5s)」。
