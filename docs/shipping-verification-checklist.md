# Shipping 验证清单：怎么知道这台「造 app 的机器」真的成了

> 配合仓里「门存在 ≠ 门够强、要真验产物」的文化（见 CLAUDE.md S4 教训）。
> **核心原则：CI 跑绿 ≠ 机器成了。** release.yml 全绿，只证明"脚本没报错"，不证明"产物真能用"。
> 下面每一条都是：**声称 → 怎么真验 → 绿长什么样**。在宿主 Mac 上跑，容器跑不了。
>
> 用法：那个并行 session 把工厂搭完、真发了一版之后，拿这张清单逐条打钩。能打满 = 可以录屏给 Wendi。

---

## 为什么不能信"CI 绿了"

签名/公证这类东西最爱"假绿"：脚本 exit 0、Release 也挂出来了，但 app 下载下来一打开弹"无法验证开发者"，或者自动更新装不上。这些**只在真产物上才暴露**。所以验证的对象是**下载下来的那个 app**，不是 CI 日志。

---

## 声称 1：能自动打包并发布

**怎么验**：合一个 PR 进 main 后，去仓库 Releases 页面看。

打钩条件：
- [ ] 出现了一个新 Release，版本号比上一个 +1（自动 bump 了）。
- [ ] 资源里有 **3 类文件**：`*.dmg`（给人下载）、`*.zip`（给自动更新）、`latest-mac.yml`（更新清单，electron-updater 靠它判断有没有新版）。
  - ⚠ 只有 dmg 没有 zip/yml = 自动更新一定坏。这是最常见的漏。

---

## 声称 2：app 真的签名了

**怎么验**：下载 dmg，挂载，把 `.app` 拖到某处，终端跑：

```bash
codesign --verify --deep --strict --verbose=2 /path/to/wordspace.app
codesign -dvv /path/to/wordspace.app 2>&1 | grep Authority
```

打钩条件：
- [ ] 第一条**无任何报错**（没输出就是过了，`codesign` 这点反直觉）。
- [ ] 第二条能看到 `Authority=Developer ID Application: 你的名字 (TEAMID)`。
  - 如果显示 `adhoc` 或啥都没有 = 根本没签名（就是老 wordspace 的状态）。

---

## 声称 3：app 真的公证了 + 通行证贴上了

**怎么验**：

```bash
# Gatekeeper 实际会怎么判这个 app（注意 .app 用 execute，dmg/pkg 才用 install）
spctl --assess --type execute --verbose /path/to/wordspace.app

# 公证通行证有没有真 staple 到 app 上
xcrun stapler validate /path/to/wordspace.app
```

打钩条件：
- [ ] `spctl` 输出 `accepted` 且 `source=Notarized Developer ID`。
  - 出现 `rejected` = 公证没生效，用户会撞警告。
- [ ] `stapler validate` 输出 `The validate action worked!`。

> 这两条就是签名/公证的"变异探针"：哪天 CI 配置被改坏、签名悄悄丢了，这两条会立刻翻红。建议把它们写进一个宿主脚本（接 host-verify 的思路），别靠手记。

---

## 声称 4：用户下载打开不撞吓人警告

**怎么验**：用**真实下载路径**模拟普通用户——从 Releases 页面用浏览器下载 dmg（别用 `git`/`scp` 绕过），打开，拖进「应用程序」，双击启动。

打钩条件：
- [ ] 双击能正常打开，**不弹**「无法打开，因为无法验证开发者」。
  - 顶多第一次弹一个普通的「这是从互联网下载的，确定打开吗？」——那是正常的，点打开即可。
- [ ] （讲究的话）下载后先验隔离属性还在、Gatekeeper 仍放行：
  ```bash
  xattr -p com.apple.quarantine /path/to/downloaded.dmg   # 有输出=确实带了"网络下载"标记
  ```
  带着 quarantine 标记还能正常打开，才证明签名公证真扛住了 Gatekeeper。

> 这条最像 Wendi 视角——她不看 CI，她看"我点下载、我打开、它就开了"。录屏重点拍这条。

---

## 声称 5：自动更新真的生效（最容易假绿，重点验）

**关键认知：一个版本证明不了自动更新。** 必须造两个真签名版本，看老版本会不会自己变新。dev 模式不触发 autoUpdater，必须用打包后的真 app。

**怎么验**（两版本翻转测试）：
1. 发 `v1.0.0`（签名公证好），下载安装，启动，记下版本号。
2. 再发 `v1.0.1`（随便改个可见的小东西，比如标题文字）。
3. **再次启动 v1.0.0**（别手动下 v1.0.1）→ 它应该自己从 `latest-mac.yml` 发现新版 → 后台下载 v1.0.1 → 提示重启或下次启动后已是新版。

打钩条件：
- [ ] v1.0.0 启动后，**没人工干预**，过一会儿/重启后变成了 v1.0.1（界面那个小改动出现了）。
- [ ] 整个过程没弹签名错误（mac 自动更新强制要签名，没签名这步必挂——这也顺带验了签名）。

> 这是整条 pipeline 最难、最值钱的一步。录屏一定要拍到"老版本自己变新版本"这个瞬间——这才是"用户可自动更新"的实锤。

---

## 声称 6：门有牙（可选，但符合你们的文化）

仿 VA 变异自检：**故意打坏，看门会不会红。**

- [ ] 临时把 release.yml 里的签名 secret 引用注释掉（或本地拿个没签名的 build），跑声称 2/3 的 `codesign`/`spctl` 检查 → **必须翻红**。如果打坏了还绿，说明你的验证脚本是哑的，整套验证不可信。

---

## 给 Wendi 录屏的取景建议

按这个顺序拍，就是一条完整的"想法 → 上线 → 可下载可更新"：
1. 一个极简 spec（Hello World 级）+ 和 AI 确认需求。
2. 走开，pipeline 无人值守跑：spec → PR → CI 绿 → 合并。
3. **合并后自动触发发版**：Releases 页面冒出新版本（dmg+zip+yml）。
4. 真机下载 dmg、打开、**不撞警告**（声称 4）。
5. 改个小东西、再发一版，**老 app 自己更新成新版**（声称 5）——全片高潮。

这 5 段连起来，就是"pipeline 最远能到哪"的答案：**一路到用户手里、还能自己长大。**

---

## 一句话给那个工厂 session

光让 release.yml 绿不算完工。**完工的定义 = 上面声称 2–5 在真下载的 app 上都打钩**。最值得先接成自动脚本的是声称 2/3/5（签名、公证、两版本更新），它们对应你们的 host-verify 真门。
