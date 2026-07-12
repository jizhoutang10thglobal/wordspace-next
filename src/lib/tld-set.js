// IANA 根区 TLD 快照（omnibox「是 URL 还是搜索」判定用）。纯数据，双模导出。
//
// ⚠ 这是 2026 年的手工快照,非实时同步的完整根区。设计取舍(doc review 明确要求):
// 不能用「十来个手挑常见集」——那会把 shop.pizza / a.bar 这类长尾真 gTLD 误判成搜索。
// 这里收全部 ISO 3166 ccTLD(稳定,极少变动)+ 主流 gTLD + 热门 new gTLD,覆盖真实流量的绝大多数。
// 长尾漏网的新 gTLD 会被判成搜索(而非 URL)——可接受的降级,不是数据损坏。
// 同步路径(follow-up):从 https://data.iana.org/TLD/tlds-alpha-by-domain.txt 生成覆盖此文件。
const RAW = `
com net org info biz name pro mobi asia tel xxx aero coop jobs museum travel cat post arpa edu gov int mil
ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bw by bz
ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg er es et eu fi fj fk
fm fo fr ga gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir
is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mh mk
ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl
pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st su sv sx sy sz
tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw
app dev page new web site online store shop tech blog cloud email link live life world today news media
xyz top club vip fun fyi wiki work run zone city space design studio agency digital solutions network
ai io ly me tv cc co gg sh io money fund finance capital ventures partners holdings group global inc llc
art photo photos pics gallery video film music audio game games play toys fashion style beauty fit health
care clinic dental doctor law legal tax accountant consulting expert guru academy school education university
coffee pizza bar pub beer wine kitchen recipes menu restaurant cafe bakery farm garden florist flowers
house home casa realty estate rentals apartments condos properties builders construction contractors
travel tours vacations flights hotel hotels holiday cruises reise guide directory review reviews deals
software app apps computer digital data systems tools codes host hosting domains dev sh git io tech ninja
family love dating singles wedding baby kids mom dad life quest cool wtf lol rocks buzz gives community
church faith bible temple yoga guru zen earth eco green solar energy water sky moon star space voyage
`;

const set = new Set();
for (const t of RAW.split(/\s+/)) {
  const tld = t.trim().toLowerCase();
  if (tld) set.add(tld);
}

function isKnownTld(label) {
  if (typeof label !== 'string') return false;
  const l = label.toLowerCase();
  if (set.has(l)) return true;
  // 国际化 TLD（punycode）：xn-- 开头一律当真 TLD（无法逐个枚举，形状即证据）
  if (l.indexOf('xn--') === 0) return true;
  return false;
}

const API = { isKnownTld, _size: set.size };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.WS2Tld = API;
