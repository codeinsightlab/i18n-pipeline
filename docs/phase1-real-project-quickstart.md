# Phase 1 真实项目验证最小说明

## 1) 不传 `--script-rules` 时

- assignment/call 业务 script 规则不生效。
- 例如 `this.title = "中文"`、`this.$modal.msgSuccess(...)`、`this.$modal.confirm(...)` 不会被替换。
- 这些候选仍会进入 report，并体现为 script 侧策略跳过。

## 2) 传入 `--script-rules` 时

- 仅按规则文件中显式声明的 assignment/call 规则执行匹配与替换。
- `matched_rule` 使用规则文件里的 `id`，可直接回溯配置来源。

## 3) `init-script-rules` 用法

```bash
i18n init-script-rules --out ./i18n/script-rules.json
```

用于导出最小模板；后续按该 JSON 显式传入 `--script-rules`。

## 4) 推荐验证命令（最小）

```bash
i18n scan --dir ./src/views/system/user --script-rules ./i18n/script-rules.json --report ./logs/scan.json
i18n run --dir ./src/views/system/user --script-rules ./i18n/script-rules.json --report ./logs/run.json
i18n apply --dir ./src/views/system/user --script-rules ./i18n/script-rules.json --report ./logs/apply.json
```

若要验证“未启用业务 script 规则”的基线，对应命令去掉 `--script-rules` 即可。

## 5) 内置与外置边界说明

- `rules.message` 仍是内置结构能力（无需 `--script-rules`）。
- assignment/call（如 `this.title`、`this.$modal.msgSuccess`、`this.$modal.confirm`）必须显式传入 `--script-rules` 才会生效。
