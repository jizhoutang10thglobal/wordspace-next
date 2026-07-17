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
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const RAW_FALLBACK_URL =
  'https://raw.githubusercontent.com/jizhoutang10thglobal/wordspace-next/main/CHANGELOG.md';

export type ChangelogItem = {
  /** 行内已按 **粗体** 切好段：odd index 为粗体段 */
  parts: string[];
};

export type ChangelogGroup = {
  /** 新增 / 改进 / 修复；null = 未分组的平铺列表（≤3 条的小版本允许平铺） */
  title: string | null;
  items: ChangelogItem[];
};

export type ChangelogEntry = {
  version: string; // "v0.10.1"
  date: string; // "2026-07-16"
  /** 版本标题行括号里的备注（如「发版流水线中断…」），多数版本没有 */
  note: string | null;
  /** 版本导语（标题下的第一段非列表文本），可选 */
  lead: string | null;
  groups: ChangelogGroup[];
};

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

export function parseChangelog(md: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let cur: ChangelogEntry | null = null;
  let curGroup: ChangelogGroup | null = null;

  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    const h2 = line.match(/^##\s+(v\d+\.\d+\.\d+)\s+—\s+(\d{4}-\d{2}-\d{2})(?:（(.+)）)?\s*$/);
    if (h2) {
      cur = { version: h2[1], date: h2[2], note: h2[3] ?? null, lead: null, groups: [] };
      curGroup = null;
      entries.push(cur);
      continue;
    }
    if (!cur) continue; // 文件头（约定说明块）不进页面

    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3) {
      curGroup = { title: h3[1], items: [] };
      cur.groups.push(curGroup);
      continue;
    }
    const li = line.match(/^-\s+(.*)$/);
    if (li) {
      if (!curGroup) {
        curGroup = { title: null, items: [] }; // 无 ### 分组的平铺列表（小版本/历史条目）
        cur.groups.push(curGroup);
      }
      curGroup.items.push({ parts: splitBold(stripInline(li[1])) });
      continue;
    }
    const text = line.trim();
    if (text && !cur.lead && cur.groups.length === 0) {
      // 标题下第一段非列表文本 = 导语（历史条目多为「**一句话。**」，剥掉包裹粗体）
      cur.lead = stripInline(text).replace(/^\*\*(.+)\*\*$/, '$1');
    }
  }
  return entries;
}

export async function loadChangelog(): Promise<ChangelogEntry[]> {
  let md: string | null = null;
  try {
    md = await readFile(path.join(process.cwd(), '..', 'CHANGELOG.md'), 'utf8');
  } catch {
    const res = await fetch(RAW_FALLBACK_URL, { cache: 'no-store' });
    if (res.ok) md = await res.text();
  }
  if (!md) throw new Error('changelog: CHANGELOG.md unreadable (fs ../ and raw fallback both failed)');
  const entries = parseChangelog(md);
  if (entries.length === 0) throw new Error('changelog: parsed zero entries — format drift?');
  return entries;
}
