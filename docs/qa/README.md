# docs/qa/ —— AI feature 审计产出

`/audit-feature <feature>` skill 的报告落点(skill 见 `.claude/skills/audit-feature/`)。

- `audits/YYYY-MM-DD-<slug>.md` —— 每次审计一份报告(范围 / 行为预期清单 / 分级 finding / 需真机手测 / 待拍板项 / 占机与误报尾注)。
- `assets/<YYYY-MM-DD-slug>/` —— 该次报告引用的 verified finding 关键截图(每张 <200KB)。**只服务报告可读性,不是截图库**(不做检索 / 跨版本比对)。

审计是**探索性发现**,不是回归门(那是 `e2e/`)。同一 feature 跑两次 finding 集会不同。
