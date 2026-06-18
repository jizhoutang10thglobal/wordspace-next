// ui-demo 验收审计 · 变异注入（v2 · U4）
// 每个键 = scenario id；值 = async (page, driveOut) => void：在 drive 成功**之后**把该功能的
// 「效果」破坏掉（如插了块又删掉、AI 弹窗强行关掉、转块还原），产出一份「功能坏掉」的证据。
// 变异自检拿这份坏证据喂判官，断言判官**必须判不符合**；判不出 = 哑门。
// 注入点在取证层（capture.mjs --mutate <id>），测的是「判官能否判出功能失效」，不是改 app。
//
// U1 阶段为空（capture.mjs 的 --mutate 管道已就位）；U4 填入具体破坏。

export const MUTATIONS = {}
