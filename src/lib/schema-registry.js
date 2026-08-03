// Schema 注册表 + 分类器：Wordspace 不写死「只有一个 Schema」——遍历已注册的 schema，认出一份 .html 属于哪个。
// 每个 schema = descriptor { id, detect(doc)→bool, validate(doc)→{conform,violations} }：
//   · detect 是宽容的「候选筛」（多 schema 并存时快速排除 / 性能），允许误判 false-positive；
//   · validate 才是权威（§4.3 铁律：不看 <meta> 自称、只查内容、判磁盘字节 reparse 的 DOM）。
// classify(doc) 找第一个 detect 命中且 validate 通过的 → {schemaId, conform, violations}；都不中 → schemaId:null。
// 加 Schema #2 = 新写一个 descriptor 文件 + register()，不用改 classify、也不用改 routeDoc 的形状。
// 双导出：node:test 用 require，渲染层用 <script> 当 classic script（window.WS2SchemaRegistry）。
(function (global) {
  const WSV = (typeof require === 'function') ? require('./schema-validate.js') : (global.WS2SchemaValidate || {});
  const SCHEMAS = []; // 按注册顺序；先注册先试（detect 命中优先级）

  function register(descriptor) { SCHEMAS.push(descriptor); return descriptor; }
  function schemas() { return SCHEMAS.slice(); }

  function classify(doc) {
    let firstViolations = null;
    for (const s of SCHEMAS) {
      if (!s.detect(doc)) continue;            // detect 未命中：这份文件肯定不属于该 schema，跳过
      const r = s.validate(doc);
      if (r.conform) return { schemaId: s.id, conform: true, violations: [] }; // 权威通过 → 认定属于该 schema
      if (firstViolations === null) firstViolations = r.violations; // detect 命中但 validate 不过：记违规、继续试下一个
    }
    return { schemaId: null, conform: false, violations: firstViolations || [] }; // 都不属于 → 走基础编辑（降级）
  }

  // 注册 Schema #1（当前唯一 / 兜底）。detect 恒真——它是兜底 schema、validate 是权威；
  // 将来 Schema #2 各自给结构性 detect 做快速候选筛选，那时 detect 才有区分意义。
  register({ id: 'schema-1', detect: () => true, validate: (doc) => WSV.validate(doc) });

  const api = { register, classify, schemas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2SchemaRegistry = api;
})(typeof window !== 'undefined' ? window : globalThis);
