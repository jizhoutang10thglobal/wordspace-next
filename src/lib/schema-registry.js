// Schema 注册表 + 分类器：Wordspace 不写死「只有一个 Schema」——遍历已注册的 schema，认出一份 .html 属于哪个。
// 每个 schema = descriptor { id, detect(doc)→bool, validate(doc)→{conform,violations} }：
//   · detect 是宽容的「候选筛」（多 schema 并存时快速排除 / 性能），允许误判 false-positive；
//   · validate 才是权威（§4.3 铁律：不看 <meta> 自称、只查内容、判磁盘字节 reparse 的 DOM）。
// classify(doc) 找第一个 detect 命中且 validate 通过的 → {schemaId, conform, violations}；都不中 → schemaId:null。
// 加 Schema #N = 新写一个被动 descriptor 文件 + 在下面的「注册收口」按优先级 register()。
// 双导出：node:test 用 require，渲染层用 <script> 当 classic script（window.WS2SchemaRegistry）。
(function (global) {
  const WSV = (typeof require === 'function') ? require('./schema-validate.js') : (global.WS2SchemaValidate || {});
  const SCHEMAS = []; // 按注册顺序；先注册先试（detect 命中优先级）

  function register(descriptor) {
    if (!descriptor || SCHEMAS.some((s) => s.id === descriptor.id)) return descriptor; // 幂等：无效/重复 id 不注册（浏览器脚本重复加载兜底）
    SCHEMAS.push(descriptor);
    return descriptor;
  }
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

  // ---- 注册收口（唯一注册点；顺序 = 归类优先级：schema-2 先试，schema-1 兜底）----
  // descriptor 是被动数据模块（不自注册、不 require 本文件），故在此主动收集：
  //   · node：本文件 require 各 descriptor（它们只 require validate/page，不回 require 本文件 → 无循环）；
  //     任何消费方 `require('./schema-registry.js')` 即拿到满员注册表（护住 e2e/*.spec.js 的 node 侧 classify）。
  //   · 浏览器：descriptor 的 <script> 在 index.html 里排在本文件之前 → 读 window 全局。
  // 顺序只活在这一处 + test/schema-registry.test.js 断言 schemas() 前两位序列（别靠 script 标签默契）。
  const schema2 = (typeof require === 'function') ? require('./schema-2-paged.js') : global.WS2Schema2Paged;
  register(schema2); // Schema #2 分页文档：head 有可解析 page 块 → 优先认（register 会挡 undefined）
  register({ id: 'schema-1', detect: () => true, validate: (doc) => WSV.validate(doc) }); // Schema #1 流式文档：detect 恒真兜底，validate 是权威

  const api = { register, classify, schemas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2SchemaRegistry = api;
})(typeof window !== 'undefined' ? window : globalThis);
