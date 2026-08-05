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
import { access, readFile } from 'node:fs/promises';
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
/** 独立成行的 markdown 图片（前后允许空白，整行只有这一个图片） */
const IMG_LINE = /^!\[([^\]]*)\]\(([^)]*)\)$/;
/** 行内混着的图片语法——只用来抓「图片被写进了条目/导语里」这种写法错误 */
const IMG_INLINE = /!\[[^\]]*\]\([^)]*\)/;

/** 把一行按 **bold** 切成交替段（偶数下标普通、奇数下标粗体），供 JSX 安全渲染 */
function splitBold(line: string): string[] {
  return line.split(/\*\*([^*]+)\*\*/g);
}

/** 去掉行内 markdown 痕迹：链接留文字、行内代码去反引号 */
function stripInline(line: string): string {
  return line
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1');
}

/**
 * 图片必须独立成行。写进条目/导语里的话，上面 stripInline 的链接正则会把
 * `![图](x.png)` 剥成字面 `!图` 跟在正文后面——构建全绿、页面上多个怪字符串，
 * 是最难被发现的那种坏法。所以在这儿响亮地拦下来。
 */
function assertNoInlineImage(line: string): void {
  if (IMG_INLINE.test(line)) {
    throw new Error(`changelog: 图片必须独立成行，不能写在条目或导语里：${line}`);
  }
}

/**
 * 独立图片行 → 结构化配图；不是图片行返回 null。
 *
 * 正本写仓库根相对路径 `website/public/changelog/x.png`（GitHub 上看 CHANGELOG.md
 * 图能显示），站点这边把 `website/public/` 剥成站点根 `/`。两条硬校验，坏了就抛：
 * ① alt 必填——它同时是 figcaption，空 alt 等于既没图注也没无障碍文本；
 * ② 路径必须在 website/public/ 下——Next 只服务 public/，写别处就是线上 404 裂图，
 *    而且构建全绿没人发现（正是这个模块一贯要躲开的「静默坏掉」）。
 */
function parseImage(line: string): ChangelogImage | null {
  const m = line.match(IMG_LINE);
  if (!m) return null;
  const alt = m[1].trim();
  const src = m[2].trim();
  if (!alt) {
    throw new Error(`changelog: 配图缺 alt（alt 同时当图注，必填）：${line}`);
  }
  if (!src.startsWith(IMG_REPO_PREFIX) || src.length === IMG_REPO_PREFIX.length) {
    throw new Error(`changelog: 配图路径必须写成 ${IMG_REPO_PREFIX}…（仓库根相对，GitHub 与官网两边都显示）：${line}`);
  }
  return { src: `/${src.slice(IMG_REPO_PREFIX.length)}`, alt };
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
 * 构建门：正本引用的配图必须真在 website/public 下。
 * 图丢了只会在页面上变成裂图（没有任何构建错误、没有任何 CI 会红——官网 e2e 都不在 CI 里），
 * 所以这里主动查一遍盘，缺一张就挂构建。publicDir 由调用方给，方便单测拿临时目录跑。
 */
export async function assertImagesOnDisk(entries: ChangelogEntry[], publicDir: string): Promise<void> {
  const srcs = new Set<string>();
  for (const e of entries) {
    for (const img of e.images) srcs.add(img.src);
    for (const g of e.groups) for (const img of g.images) srcs.add(img.src);
  }
  const missing: string[] = [];
  for (const src of srcs) {
    try {
      await access(path.join(publicDir, src));
    } catch {
      missing.push(src);
    }
  }
  if (missing.length > 0) {
    throw new Error(`changelog: 配图文件不存在（website/public 下找不到）：${missing.join('、')}`);
  }
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
  const entries = parseChangelog(md);
  if (entries.length === 0) throw new Error(`changelog: ${file} parsed zero entries — format drift?`);
  // 配图存在性只在「正本来自磁盘」时校验。回退路径下 md 来自 GitHub main，而 public/ 里的图
  // 来自本次 checkout——两者不同源，拿 main 的正本去对照本次 checkout 的图会假红挂掉构建
  // （比如图刚随 PR 加进来、main 上的正本还没提到它，或反过来）。跳过是安全的：这条路径本就是
  // 「盘上读不到正本」的异常降级，且图真缺了页面上是裂图 + figcaption 文字还在，不会静默错内容。
  if (fromDisk) await assertImagesOnDisk(entries, path.join(process.cwd(), 'public'));
  return entries;
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
