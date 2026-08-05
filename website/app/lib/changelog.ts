/**
 * Changelog loader + parser (build time only).
 *
 * 正本是仓库根的 CHANGELOG.md（发版约定见 docs/releasing.md）。本模块在 next build
 * 时读它并解析成结构化数据；页面是纯静态产物，运行时零请求。
 *
 * 读取策略：优先读 ../CHANGELOG.md（Vercel 克隆整个仓库、Root Directory 只是收窄
 * cwd，父目录文件在盘上）；读不到（万一平台裁掉了 root 外文件）回退到 GitHub raw。
 * 两条都失败就抛错让构建响亮地挂掉——绝不静默渲染空页。
 *
 * ⚠ 触发时机：CHANGELOG.md 不在 website/ 内，vercel.json 的 ignoreCommand 已单独
 * 放行它（否则改 changelog 不会触发网站重建）。改 ignoreCommand 前想清楚方向。
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const RAW_FALLBACK_URL =
  'https://raw.githubusercontent.com/jizhoutang10thglobal/wordspace-next/main/CHANGELOG.md';
const RAW_FALLBACK_URL_EN =
  'https://raw.githubusercontent.com/jizhoutang10thglobal/wordspace-next/main/CHANGELOG.en.md';

export type ChangelogItem = {
  /** 行内已按 **粗体** 切好段：odd index 为粗体段 */
  parts: string[];
};

export type ChangelogImage = {
  /** 站点根绝对路径（`/changelog/xxx.png`）——正本里写的是仓库根相对路径，解析时剥前缀 */
  src: string;
  /** 必填：既当 alt 又当 figcaption（图注是内容，不是装饰） */
  alt: string;
  /**
   * 固有像素尺寸，构建时从文件头读出来、写进 `<img width/height>`。
   * 不写宽高的话图一到货就把下方内容整体顶下去（实测首屏内一张图 = CLS 0.166，
   * Google「良好」阈值是 0.1）。读不出来（非 png/jpeg、文件头怪）就留空退回现状——
   * 尺寸是优化项，没资格挂构建。只有走查盘那条路径才有值（GitHub raw 回退时没有）。
   */
  width?: number;
  height?: number;
};

export type ChangelogGroup = {
  /** 新增 / 改进 / 修复；null = 未分组的平铺列表（≤3 条的小版本允许平铺） */
  title: string | null;
  items: ChangelogItem[];
  /** 本组的配图（写在该 ### 之下的独立图片行），渲染在条目列表下方 */
  images: ChangelogImage[];
};

export type ChangelogEntry = {
  version: string; // "v0.10.1"
  date: string; // "2026-07-16"
  /** 版本标题行括号里的备注（如「发版流水线中断…」），多数版本没有 */
  note: string | null;
  /** 版本导语（标题下的第一段非列表文本），可选 */
  lead: string | null;
  /** 版本级配图（写在任何 ### 之前的独立图片行），渲染在导语下方 */
  images: ChangelogImage[];
  groups: ChangelogGroup[];
};

/** 正本里图片路径的固定前缀：写仓库根相对路径，GitHub 上直接看 CHANGELOG.md 也能显示图 */
const IMG_REPO_PREFIX = 'website/public/';
/**
 * 独立成行的 markdown 图片（前后允许空白，整行只有这一个图片）。
 * alt 段刻意用贪婪 `.*` 而不是 `[^\]]*`：alt 里出现半角 `]`（`![多选 [Cmd+K] 改色](…)`）
 * 在 `[^\]]*` 下会让整条锚定正则失配，图既解析不出来、也逃过下面那条行内检测 → 静默消失。
 * 贪婪 `.*` 会一直吃到最后一个 `](`，正是我们要的分界。
 */
const IMG_LINE = /^!\[(.*)\]\((.*)\)$/;
/** 行内混着的图片语法——只用来抓「图片被写进了条目/导语里」这种写法错误（同样不能用 `[^\]]*`） */
const IMG_INLINE = /!\[.*\]\(.*\)/;
/** alt 同时当图注，只能是纯文本：`**粗体**` / 反引号在条目里会被处理，在图注这儿会被原样吐到页面上 */
const MD_IN_ALT = /\*\*|`/;
/** 路径段白名单：一个段只能是这些字符，顺带把 `//`（空段）、前后多余斜杠、空格全挡掉 */
const SAFE_SEG = /^[A-Za-z0-9._-]+$/;
/** 只发这几种图。`![总览](website/public/changelog)`（漏写文件名）在这一步就被挡，不必等查盘 */
const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

/** 把一行按 **bold** 切成交替段（偶数下标普通、奇数下标粗体），供 JSX 安全渲染 */
function splitBold(line: string): string[] {
  return line.split(/\*\*([^*]+)\*\*/g);
}

/** 按行内代码段切开：偶数下标在代码外，奇数下标是代码段本身（含两侧反引号） */
function splitCode(line: string): string[] {
  return line.split(/(`[^`]*`)/g);
}

/**
 * 去掉行内 markdown 痕迹：链接留文字、行内代码去反引号。
 *
 * 剥链接只在代码段之外做——`粘贴图片自动写成 \`![alt](path)\` 语法` 这种正当写作里，
 * 反引号本来就是 markdown 的转义手段，整行一起剥会把它变成字面 `!alt` 噪声（作者按标准
 * 写法转义了，产出还是坏的，只能改文案绕开）。
 */
function stripInline(line: string): string {
  return splitCode(line)
    .map((seg, i) => (i % 2 === 1 ? seg.slice(1, -1) : seg.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')))
    .join('');
}

/**
 * 「这行没被解析成独立图片行」这一侧的收口，两种坏法各给一条响亮的错。
 *
 * ① 图片没独立成行：上面 stripInline 的链接正则会把 `![图](x.png)` 剥成字面 `!图`
 *    跟在正文后面——构建全绿、页面上多个怪字符串，最难被发现的那种坏法。
 * ② 图片语法本身写坏了（解析不出完整形状）：这条以前是漏的，而且漏得最狠——
 *    守卫跟被测对象共用同一个正则，坏语法既不成图、又骗过守卫，图就静默消失
 *    （或原样变成页面上的字面 markdown）。所以判据不能是「能不能匹配出完整图片语法」，
 *    得再加一层形状级兜底：剩个裸 `![` 就是写坏了。
 *
 * 行内代码里提到图片语法是正当写作（「粘贴自动写成 `![alt](path)`」），先把代码段挖掉
 * 再判——否则连 markdown 标准的反引号转义都救不了作者，只能改写文案绕开这道门。
 */
function assertNoInlineImage(line: string): void {
  const bare = splitCode(line)
    .filter((_, i) => i % 2 === 0)
    .join('');
  if (IMG_INLINE.test(bare)) {
    throw new Error(`changelog: 图片必须独立成行，不能写在条目或导语里：${line}`);
  }
  if (bare.includes('![')) {
    throw new Error(
      `changelog: 配图这行写法不合法，解析不出 ![图注](${IMG_REPO_PREFIX}…) 形状（最常见是 alt 或路径里带了半角括号）：${line}`,
    );
  }
}

/**
 * 独立图片行 → 结构化配图；不是图片行返回 null。
 *
 * 正本写仓库根相对路径 `website/public/changelog/x.png`（GitHub 上看 CHANGELOG.md
 * 图能显示），站点这边把 `website/public/` 剥成站点根 `/`。硬校验，坏了就抛：
 * ① alt 必填且必须是纯文本——它同时是 figcaption，空 alt 等于既没图注也没无障碍文本，
 *    带 markdown 标记则会被原样吐到页面上（图注不过 stripInline/splitBold）；
 * ② 路径必须在 website/public/ 下——Next 只服务 public/，写别处就是线上 404 裂图，
 *    而且构建全绿没人发现（正是这个模块一贯要躲开的「静默坏掉」）；
 * ③ 路径形状要逐段钉死，光 startsWith 不够。踩过的坑：查盘那头用 path.join，它把
 *    `//`、`./`、`../` 全归一掉，浏览器却按 URL 规则解析原串——`website/public//a.png`
 *    归一后文件在盘上（门绿），页面上 `<img src="//a.png">` 是 protocol-relative URL，
 *    线上会去请求外部主机 → 裂图；`website/public/../../CHANGELOG.md` 同理归一到仓库根
 *    的真文件、门照样绿。查盘用的路径和 `<img src>` 用的字符串必须是同一个真相。
 */
function parseImage(line: string): ChangelogImage | null {
  const m = line.match(IMG_LINE);
  if (!m) return null;
  const alt = m[1].trim();
  const src = m[2].trim();
  if (!alt) {
    throw new Error(`changelog: 配图缺 alt（alt 同时当图注，必填）：${line}`);
  }
  if (MD_IN_ALT.test(alt)) {
    throw new Error(`changelog: 配图 alt 只能写纯文本（它同时当图注，**粗体** 和反引号会原样显示在页面上）：${line}`);
  }
  if (!src.startsWith(IMG_REPO_PREFIX)) {
    throw new Error(`changelog: 配图路径必须写成 ${IMG_REPO_PREFIX}…（仓库根相对，GitHub 与官网两边都显示）：${line}`);
  }
  const rest = src.slice(IMG_REPO_PREFIX.length);
  const segs = rest.split('/');
  if (segs.some((s) => !SAFE_SEG.test(s) || s === '.' || s === '..') || !IMG_EXT.test(rest)) {
    throw new Error(
      `changelog: 配图路径形状不合法（${IMG_REPO_PREFIX} 之后只允许 [A-Za-z0-9._-] 和单个 /，且要带图片扩展名）：${line}`,
    );
  }
  return { src: `/${rest}`, alt };
}

export function parseChangelog(md: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let cur: ChangelogEntry | null = null;
  let curGroup: ChangelogGroup | null = null;

  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    // note 括号兼容中英：zh 全角（…），en 半角 (…)
    const h2 = line.match(/^##\s+(v\d+\.\d+\.\d+)\s+—\s+(\d{4}-\d{2}-\d{2})(?:（(.+)）|\s+\((.+)\))?\s*$/);
    if (h2) {
      cur = { version: h2[1], date: h2[2], note: h2[3] ?? h2[4] ?? null, lead: null, images: [], groups: [] };
      curGroup = null;
      entries.push(cur);
      continue;
    }
    if (!cur) continue; // 文件头（约定说明块）不进页面

    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3) {
      curGroup = { title: h3[1], items: [], images: [] };
      cur.groups.push(curGroup);
      continue;
    }
    // 图片行要在「列表项 / 导语」之前分派：否则它会被下面的导语规则抢去当文本
    const img = parseImage(line.trim());
    if (img) {
      (curGroup ?? cur).images.push(img); // 在 ### 之内归该组，之前归该版本
      continue;
    }
    const li = line.match(/^-\s+(.*)$/);
    if (li) {
      assertNoInlineImage(li[1]);
      if (!curGroup) {
        curGroup = { title: null, items: [], images: [] }; // 无 ### 分组的平铺列表（小版本/历史条目）
        cur.groups.push(curGroup);
      }
      curGroup.items.push({ parts: splitBold(stripInline(li[1])) });
      continue;
    }
    const text = line.trim();
    if (!text) continue;
    // 走到这儿的文本行里还含图片语法 = 图片没独立成行（或路径/alt 写错导致没匹配上）。
    // 这类行在下面多半会被静默丢弃，所以在丢弃前先拦——别让写错的图悄悄消失。
    assertNoInlineImage(text);
    if (!cur.lead && cur.groups.length === 0) {
      // 标题下第一段非列表文本 = 导语（历史条目多为「**一句话。**」，剥掉包裹粗体）
      cur.lead = stripInline(text).replace(/^\*\*(.+)\*\*$/, '$1');
    }
  }
  return entries;
}

/**
 * PNG IHDR / JPEG SOFn 里的固有尺寸。只认这两种（配图规范就是 png 截图），
 * 认不出来返回 null——尺寸只是防位移的优化，没资格挂构建。
 */
function intrinsicSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length && buf[i] === 0xff) {
      const marker = buf[i + 1];
      // SOF0..SOF15 里挖掉 DHT/JPG/DAC 这三个同段号但不是 SOF 的
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

/**
 * 构建门：正本引用的配图必须真在 website/public 下、而且真是个文件。
 * 图丢了只会在页面上变成裂图（没有任何构建错误、没有任何 CI 会红——官网 e2e 都不在 CI 里），
 * 所以这里主动查一遍盘，缺一张就挂构建。publicDir 由调用方给，方便单测拿临时目录跑。
 *
 * 顺带在同一趟里把固有尺寸读出来写回 img（防 CLS，见 ChangelogImage.width 的注释）：
 * 文件已经要打开一次了，拆成两趟既多读一遍盘，又容易漂成「门查了 A、尺寸读了 B」。
 *
 * 两个细节是踩出来的：
 * ① 用 stat().isFile() 而不是 access()——`![总览](website/public/changelog)` 漏写文件名时
 *    access 对目录成立、门放行，线上 `<img src="/changelog">` 是 404 裂图；
 * ② 用 path.resolve 的结果比对 publicDir 边界——join/resolve 都会把 `..` 归一掉，归一后
 *    落在 publicDir 之外的文件照样查得到（仓库根的 CHANGELOG.md 中过），门就成了哑门。
 *    parseImage 那头已经把 `..` 挡了，这里是第二道，别指望单点不失手。
 */
export async function assertImagesOnDisk(
  entries: ChangelogEntry[],
  publicDir: string,
  file: string,
): Promise<void> {
  const root = path.resolve(publicDir);
  const all: { img: ChangelogImage; version: string }[] = [];
  for (const e of entries) {
    for (const img of e.images) all.push({ img, version: e.version });
    for (const g of e.groups) for (const img of g.images) all.push({ img, version: e.version });
  }

  const dims = new Map<string, { width: number; height: number } | null>();
  const missing: string[] = [];
  for (const { img, version } of all) {
    if (!dims.has(img.src)) {
      const abs = path.resolve(root, `.${img.src}`);
      let size: { width: number; height: number } | null = null;
      let ok = abs.startsWith(root + path.sep);
      if (ok) {
        try {
          ok = (await stat(abs)).isFile();
        } catch {
          ok = false;
        }
      }
      // 尺寸单独一趟、失败不影响判定：它只是优化项，没资格挂构建。也别图省事跟上面的
      // stat 合并——合并后「目录」这条会靠 readFile 的 EISDIR 顺带兜住，isFile 就成了
      // 没人盯着的死代码，哪天顺序一动这个洞就悄悄回来（变异自检当场抓到过）。
      if (ok) {
        try {
          size = intrinsicSize(await readFile(abs));
        } catch {
          size = null;
        }
      }
      dims.set(img.src, size);
      // 报错回显正本里的原始写法（而不是映射后的站点路径），方便直接拿去 grep CHANGELOG*.md；
      // 前面带上是哪份正本、哪个版本——两份正本都跑这道门，只报站点路径根本不知道去哪找。
      if (!ok) missing.push(`${file} ${version} → ${IMG_REPO_PREFIX}${img.src.slice(1)}`);
    }
    const size = dims.get(img.src);
    if (size) {
      img.width = size.width;
      img.height = size.height;
    }
  }

  if (missing.length > 0) {
    throw new Error(`changelog: 配图文件不存在或不是文件（website/public 下查不到）：${missing.join('、')}`);
  }
}

/**
 * 正本文本 → 结构化条目，顺带跑构建门。
 *
 * publicDir = null 表示「正本不是从本地盘读来的」（GitHub raw 回退），此时跳过配图存在性校验：
 * 那条路径下 md 来自 GitHub main、而 public/ 里的图来自本次 checkout，两者不同源，硬校会假红
 * 挂掉构建（图刚随 PR 进来、main 的正本还没提到它，或反过来）。跳过是安全的——这本就是
 * 「盘上读不到正本」的异常降级，且图真缺了页面上是裂图 + figcaption 文字还在，不会静默错内容。
 *
 * 但**跳过必须留痕**：否则整道门在这条分支上无声失效，构建日志里一个字没有，事后没人判断得出
 * 这次部署到底有没有被门保护过。这里不改成「生产直接抛」——回退存在的意义就是平台裁掉了 root
 * 外文件那种情况，把它升级成硬失败会让整个官网构建挂掉（爆炸半径远大于一张裂图）。
 */
export async function buildEntries(md: string, file: string, publicDir: string | null): Promise<ChangelogEntry[]> {
  const entries = parseChangelog(md);
  if (entries.length === 0) throw new Error(`changelog: ${file} parsed zero entries — format drift?`);
  if (publicDir !== null) {
    await assertImagesOnDisk(entries, publicDir, file);
  } else {
    console.warn(
      `changelog: ${file} 走了 GitHub raw 回退（盘上读不到正本），配图存在性门与固有尺寸已跳过——本次构建这部分没有门保护。`,
    );
  }
  return entries;
}

async function loadOne(file: string, rawUrl: string): Promise<ChangelogEntry[]> {
  let md: string | null = null;
  let fromDisk = false;
  try {
    md = await readFile(path.join(process.cwd(), '..', file), 'utf8');
    fromDisk = true;
  } catch {
    const res = await fetch(rawUrl, { cache: 'no-store' });
    if (res.ok) md = await res.text();
  }
  if (!md) throw new Error(`changelog: ${file} unreadable (fs ../ and raw fallback both failed)`);
  return buildEntries(md, file, fromDisk ? path.join(process.cwd(), 'public') : null);
}

export async function loadChangelog(): Promise<ChangelogEntry[]> {
  return loadOne('CHANGELOG.md', RAW_FALLBACK_URL);
}

/**
 * 英文镜像 + 双语同步门（构建时）：en 的最新版本必须与 zh 一致——发版只写中文漏英文时
 * next build 直接挂（部署红，响亮可见），这是「每版双语同写」约定的真门（docs/releasing.md）。
 * 历史条目允许 en 缺失（页面按版本回落 zh），门只咬最新版。
 */
export async function loadChangelogEn(): Promise<ChangelogEntry[]> {
  const [zh, en] = await Promise.all([loadChangelog(), loadOne('CHANGELOG.en.md', RAW_FALLBACK_URL_EN)]);
  if (zh[0].version !== en[0].version) {
    throw new Error(
      `changelog: latest version mismatch — zh ${zh[0].version} vs en ${en[0].version}. ` +
        '发版要同步更新 CHANGELOG.md 与 CHANGELOG.en.md（docs/releasing.md「双语同写」）。',
    );
  }
  return en;
}
