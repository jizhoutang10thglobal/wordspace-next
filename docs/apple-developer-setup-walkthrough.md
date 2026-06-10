# Apple Developer 一次性设置 walkthrough（缴费后逐步做）

> 给 Colin 做的一次性手工设置。做完之后，每次发版 pipeline 全自动，这步不用再碰。
> 全部步骤来自 Apple 官方文档（文末有出处）。Apple 后台 UI 偶尔变，按"找这个意思的按钮"理解，别死磕字面。
>
> **✅ 状态（2026-06-08 全部完成）**：Colin 已缴费入会、建好 Developer ID Application 证书、导出 `.p12`、生成 app 专用密码、**5 个 GitHub secret 全部配好**（`CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`）。这半边的活已完工，剩下是工厂 session 的事（release.yml 消费这 5 个 secret）。下面步骤留作记录/将来重做参考。
> `.p12` 在 `~/Desktop/Certificates.p12`（含私钥，**别提交进仓**；要重新 base64 跑 `base64 -i ~/Desktop/Certificates.p12 | pbcopy`）。
> （原起点：已通过身份验证、未缴费，从第 0 步开始；预计耗时 ~30–40 分钟。）

---

## 先搞懂三个词（后面一直用）

- **证书 / Developer ID Application 证书**：一把 Apple 发给你的"私章"。用它给 app 盖章 = **签名（code-sign）**。盖了章，用户的 Mac 才知道"这 app 是这个开发者发的、没被篡改"。
- **公证（notarization）**：把签好名的 app 上传给 Apple 自动扫一遍（查恶意软件），通过后 Apple 发一张"通行证"。**全自动、无人工审核、2–15 分钟**——跟 App Store 那种人工审核是两回事，别混。
- **`.p12` 文件**：证书 + 对应私钥打包成的一个文件（带密码）。GitHub 的机器要拿它替你签名，所以要把它导出来塞进 GitHub。

这三样的关系：证书拿来**签名** → 签好名的 app 拿去**公证** → 用户下载打开，Mac 的 Gatekeeper 验签名+公证都 OK → 不弹"无法验证开发者"的吓人警告。

---

## 第 0 步：缴费入会（$99/年）

1. 去 https://developer.apple.com/programs/enroll/ ，点 **Start your enrollment**。
2. 用你已开通**两步验证**的 Apple 账户登录（没开两步验证后面生成不了 app 专用密码，必须先开）。
3. 选 **个人（Individual）**——你是个人开发者，选这个最简单，不需要公司的 D-U-N-S 号。
   - ⚠ 名字必须填**法定真名**（拼音全名），用昵称/公司名当 first/last name 会拖慢审批。
4. 同意 License Agreement → 付 **99 USD**（按地区显示当地货币）。
5. 付完等激活。激活后去 https://developer.apple.com/account 能看到你的会员信息，就算成了。

> 这步是**前提**：没有有效会员资格，第 2 步建不了 Developer ID 证书。

---

## 第 1 步：在「钥匙串访问」里生成 CSR（证书申请文件）

CSR（Certificate Signing Request）= 你在自己 Mac 上生成的一个申请文件，交给 Apple 换证书。**它会在你 Mac 上同时生成一把私钥**——这把私钥是命根子，下一步导 `.p12` 全靠它。

1. 打开 **钥匙串访问**（Keychain Access，在 `/应用程序/实用工具/`）。
2. 菜单：**钥匙串访问 > 证书助理 > 从证书颁发机构请求证书**
   （Keychain Access > Certificate Assistant > Request a Certificate from a Certificate Authority）。
3. **用户电子邮件地址**：填你的邮箱。
4. **常用名称（Common Name）**：随便起个能认的名，比如 `Colin Dev Key`。
5. **CA 电子邮件地址**：**留空**。
6. 选 **存储到磁盘（Saved to disk）**，点继续，存成一个 `.certSigningRequest` 文件（一般在桌面）。

> ⚠ 关键坑：这一步生成的私钥**只在这台 Mac 上**。后面第 3 步导 `.p12` 必须在**同一台 Mac** 上做。换机器就没有私钥、导不出来。

---

## 第 2 步：在 Apple 后台建 Developer ID Application 证书

1. 去 https://developer.apple.com/account/resources ，左栏点 **Certificates**。
2. 左上角点 **加号（+）**。
3. 在 **Software** 下选 **Developer ID** → Continue。
   - 选 **Developer ID Application**（给 Mac app 签名的）。
   - ⚠ 别选成 Developer ID Installer（那是给 .pkg 安装包用的，我们走 dmg/zip，不需要它）。
4. 点 **Choose File**，选第 1 步那个 `.certSigningRequest` 文件 → Continue。
5. 点 **Download**，下到一个 `.cer` 文件（在下载文件夹）。
6. **双击这个 `.cer` 文件**，它会装进你的钥匙串。

> 备注（官方）：Developer ID Application 证书最多能建 5 个；**必须是 Account Holder 角色**——你个人账户本来就是，没问题。证书有效期约 5 年，到期才需要续。

---

## 第 3 步：从钥匙串导出 `.p12`

1. 还在 **钥匙串访问**，左栏选 **登录（login）** 钥匙串，上面选 **我的证书（My Certificates）** 分类。
2. 找到刚装好的那条 **Developer ID Application: 你的名字 (XXXXXXXXXX)**。
3. 点开它左边的小三角——**下面要挂着一把私钥**（key 图标）。
   - ⚠ 如果没挂私钥，说明你不在生成 CSR 的那台 Mac 上，或私钥被删了——回第 1 步重来。
4. **同时选中证书 + 它下面的私钥**（按住 ⌘ 点两个），右键 → **导出 2 项（Export 2 items）**。
5. 存成 **个人信息交换（.p12）** 格式，**设一个密码**（记住它，这就是后面的 `CSC_KEY_PASSWORD`）。存成比如 `cert.p12`。

---

## 第 4 步：把 `.p12` 转成 base64（GitHub 只能存文本）

GitHub secret 存不了二进制文件，所以把 `.p12` 编码成一长串文本。终端跑：

```bash
base64 -i cert.p12 | pbcopy
```

这会把 base64 文本直接复制到剪贴板（`pbcopy`）。这串文本就是后面的 `CSC_LINK`。

> 想存成文件检查的话：`base64 -i cert.p12 -o cert-base64.txt`。多行也没关系，electron-builder 解码时不挑。

---

## 第 5 步：生成 App 专用密码（给公证用）

公证时 GitHub 的机器要"代表你"登录 Apple，但不能给它你的主密码。所以生成一个**只给这一个用途的 app 专用密码**。

1. 去 https://account.apple.com 登录。
2. 在 **登录与安全（Sign-In and Security）** 区，选 **App 专用密码（App-Specific Passwords）**。
3. 选 **生成 App 专用密码**，按提示起个名（比如 `notarize-ci`），生成出一串 `xxxx-xxxx-xxxx-xxxx`。

**这串就是 `APPLE_APP_SPECIFIC_PASSWORD`。当场抄下来，离开页面就看不到了。**

> 为什么不用 App Store Connect API key？官方明确：**Individual key 用不了 notarytool（公证工具）**，必须建 Team Key，而 Team Key 要 Admin 账户、更绕。你个人账户走 app 专用密码这条最省事。以后转团队再换 API key 不迟。
>
> ⚠ 坑：每次你改/重置 Apple 主密码，**所有 app 专用密码会被自动作废**，到时 CI 公证会突然失败，重新生成一个填回去即可。

---

## 第 6 步：找到 Team ID

1. 去 https://developer.apple.com/account ，看 **Membership details（会员信息）**。
2. 里面有个 **Team ID**，10 位字母数字（像 `A1B2C3D4E5`）。

**这就是 `APPLE_TEAM_ID`。**

---

## 第 7 步：把 5 个 secret 塞进 GitHub

去仓库 `wordspace-next-demo` → **Settings → Secrets and variables → Actions → New repository secret**，加这 5 个：

| Secret 名 | 值 | 来自 |
|---|---|---|
| `CSC_LINK` | 第 4 步那串 base64 | `.p12` 编码 |
| `CSC_KEY_PASSWORD` | 第 3 步导出时设的密码 | `.p12` 密码 |
| `APPLE_ID` | 你的 Apple 账户邮箱 | — |
| `APPLE_APP_SPECIFIC_PASSWORD` | 第 5 步那串 `xxxx-xxxx-xxxx-xxxx` | app 专用密码 |
| `APPLE_TEAM_ID` | 第 6 步那 10 位 | Team ID |

名字要**一字不差**（大小写、下划线）——release.yml 按这些名字读。

> 那个并行 session 在搭的工厂（electron-builder + release.yml）正是消费这 5 个 secret 的。你把 secret 备好，他把工厂接好，两边一合就能真发版。

---

## 做完怎么知道对不对（自查）

- 第 2 步后：钥匙串「我的证书」里能看到 `Developer ID Application: 你的名字`，**左边小三角点开有私钥**。
- 第 3 步后：有个 `cert.p12` 文件，导出时没报"找不到私钥"。
- 终端验证证书装好了（可选）：
  ```bash
  security find-identity -v -p codesigning
  ```
  应该列出一条带 `Developer ID Application: 你的名字 (TEAMID)` 的项。
- 第 7 步后：GitHub Settings 里能看到 5 个 secret 名字（值看不到是正常的）。

全齐 = 你这半边的活就完了，剩下交给工厂自动跑。

---

## 出处（官方）

- 入会缴费：https://developer.apple.com/programs/enroll/
- 生成 CSR：https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request/
- Developer ID 证书：https://developer.apple.com/help/account/certificates/create-developer-id-certificates/
- App 专用密码：https://support.apple.com/en-us/102654 （account.apple.com → Sign-In and Security → App-Specific Passwords）
- App Store Connect API key（Individual key 不能用 notarytool 那条就出自这）：https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api
