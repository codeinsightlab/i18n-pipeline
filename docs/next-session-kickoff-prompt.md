# i18n-pipeline 下一会话启动 Prompt（Phase 1 冻结后）

你现在在维护 `i18n-pipeline`（Node.js + TypeScript CLI）。

## 当前阶段状态（已完成，作为输入事实）

- Phase 1 主链路已收口并通过回归：
  - `.vue` template/script 扫描与替换链路可用
  - report 可解释字段稳定（含 `context_type / extractable / replaceable / skip_reason / matched_rule`）
  - modulePrefix 锚点逻辑已修复
  - 统计一致性问题已修复
- script 机制已收敛为“外部规则驱动”：
  - 默认不再内置 assignment/call 业务规则
  - 必须显式传 `--script-rules <path>`
  - `init-script-rules --out <path>` 可导出模板
  - `rules.message` 仍保留为内置结构能力
- report 已增加：
  - `summary.script_rules_enabled`（true/false）
- CLI 报告语义已收口：
  - `i18n apply/run --report` 直接生成 HTML
  - `--report-json` 可选保留 JSON
  - `i18n report --report-source <json>` 用于基于 JSON 重渲染 HTML
- key 决策已收敛：
  - extract 产出统一 `key_decisions`
  - report 不再通过候选态反推 final key
  - apply/report 使用同源 final key 决策结果
- 已修复真实页白名单漏替换问题（template 文本尾空格口径一致性）。

## 下一会话唯一目标（必须单点聚焦）

- 只做“真实项目验证与验收判定”，不做功能开发。
- 任务核心：确认 Phase 1 在真实页面中的覆盖表现是否达到小范围试用要求，并准确区分“策略未覆盖”与“实现 bug”。

## 严格边界（必须遵守）

1. 不新增任何替换能力
2. 不扩大 template/script 白名单
3. 不引入 AST
4. 不改规则 schema（JSON 结构保持现状）
5. 不做自动规则发现/自动 merge 规则
6. 不改 key 策略
7. 不改 append-only 资源策略
8. 不发散到 Phase 2 设计

## 内核能力口径（固定）

- template 白名单：
  - `label="中文"`
  - `placeholder="中文"`
  - `<el-button>中文</el-button>`
  - `<el-table-column label="中文" />`
- script 白名单：
  - `rules.message`
  - assignment/call 仅在显式传入 `--script-rules` 时启用
- 外部 script pattern 枚举固定：
  - `string_literal`
  - `ternary_string`
  - `concat_string_var_string`

## 当前可用命令（最小）

```bash
i18n init-script-rules --out ./i18n/script-rules.json
i18n scan --dir <target-dir> --script-rules ./i18n/script-rules.json --report ./logs/scan.json
i18n run --dir <target-dir> --script-rules ./i18n/script-rules.json --report ./logs/run.html --report-json ./logs/run.json
i18n apply --dir <target-dir> --script-rules ./i18n/script-rules.json --report ./logs/apply.html --report-json ./logs/apply.json
i18n report --report-source ./logs/apply.json --report ./logs/apply-rerender.html
```

> 若要验证“未启用外部业务 script 规则”的基线，去掉 `--script-rules`。

## 阻塞级 bug 判定标准（出现即必须修）

1. 白名单内候选进入 `replaceable`，但未实际替换（`replaced_count < replaceable_count` 且可复现）。
2. 白名单外候选被实际替换（误替换）。
3. `--script-rules` 已传入但 `summary.script_rules_enabled` 不是 `true`。
4. `matched_rule / skip_reason` 与实际场景明显错位，导致 report 失去可解释性。
5. 同一轮中 scan/replace 对同一候选口径不一致（例如文本归一化不一致导致 key 查找失败）。

## 已知遗留（非阻塞，先记录）

- 大量 `script_unsupported_generic`（如字典映射、switch 返回文案）属于 Phase 1 策略外，不是 bug。
- `start-placeholder/end-placeholder` 等 template 属性属于策略性未覆盖，不是 bug。
- 非白名单 API（如 `$message.*`、`msgError`）不在当前阶段范围内。

## 下一会话验收阈值（量化）

1. 目标页面 `replaceable_count` 与 `replaced_count` 一致（允许 0=0）。
2. 误替换数为 0（白名单外不应被替换）。
3. report 中必须包含：
   - `context_type / extractable / replaceable / skip_reason / matched_rule`
   - `summary.script_rules_enabled`
4. 使用外部规则验证时，`summary.script_rules_enabled=true`；不传规则基线验证时为 `false`。
5. 每页输出必须给出：策略性未覆盖项与真实 bug 的分界结论。

## 本会话优先工作方式

- 先复现（scan/replace --dry-run/report），再定位，最后最小修复。
- 修复仅限实现 bug，不改能力边界。
- 输出要偏工程验收：先结论，再证据（命令/统计/文件定位）。
- 任何“看起来合理的新增支持”统一延后，不在本会话执行。

## 交付格式（建议）

1. 结论（是否符合预期）
2. 证据（summary 关键指标 + 关键命中/skip 样本）
3. 问题分类（策略性未覆盖 vs 真 bug）
4. 最小修复（如有）
5. 回归结果（至少 `npm test` + 目标页面复测）

## 会话开场可直接使用的指令模板

```text
你现在只做 Phase 1 真实页验收，不新增任何能力，不扩白名单，不改 schema/key/append-only。
先跑：scan + apply(--dry-run) + report。
按页面输出：
1) summary 指标
2) 白名单内是否命中并替换
3) 策略性未覆盖项（非 bug）
4) 真 bug（若有）
并补充：
5) key_decisions 中 final_key 与最终文件写入 key 是否一致
6) report 是否直接消费 final_key（而非二次反推）
最后给出是否可继续小范围试用的结论。
```
