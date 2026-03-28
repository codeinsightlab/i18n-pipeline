# i18n-pipeline

`i18n-pipeline` 是一个面向存量前端项目的 i18n CLI，当前阶段目标是：

- 稳定扫描
- 保守提取
- 可控替换
- 可解释观测（report）

本阶段不是能力扩展阶段，而是收敛阶段。

## 阶段基线

当前稳定命令：

- 主命令（推荐日常使用）
  - `i18n run`
  - `i18n apply`
  - `i18n report`
- 调试命令（用于问题定位/分步排查）
  - `i18n scan`
  - `i18n extract`
  - `i18n replace`
- 初始化命令
  - `i18n init`
  - `i18n init-script-rules`

全部命令列表：

- `i18n scan`
- `i18n extract`
- `i18n replace`
- `i18n run`
- `i18n apply`
- `i18n report`
- `i18n init`
- `i18n init-script-rules`

默认资源结构：

- `--structure module-dir`（默认）

## 当前能力边界

### Template（当前稳定支持）

- `label="中文"`
- `placeholder="中文"`
- `<el-button>中文</el-button>`
- `<el-table-column label="中文" />`

### Script（当前有限支持）

- `rules.message`（内置稳定能力）
- `this.title = "中文"`（需启用 `--script-rules`）
- `this.$modal.xxx(...)`（需启用 `--script-rules`）

说明：

- script 侧是受控白名单策略
- 不传 `--script-rules` 时，业务 script 场景默认不替换
- 本阶段不扩展 script 能力范围

### Key 规则

默认 key 形态：

- 结构化 key：`<modulePrefix>.(query|form|table|rules).<field>`
- 冲突后缀 key：`<modulePrefix>.<group>.<field>.<suffix>` 或 `<modulePrefix>.form.<field>Placeholder`
- 回退 key：`<modulePrefix>.auto_001`（递增）

`modulePrefix` 来源于文件路径（优先锚点 `src/views/...`，其次 `--dir` 相对路径推导）。

`module-dir` 下的结构化 key 生成优先级（按实现顺序）：

1. script `rules.message`：
- 命中 `rules` 语义邻域时，生成 `<modulePrefix>.rules.<field>`
2. `el-table-column[label] + prop`：
- 命中 `template_el_table_column_label` 且存在 `prop`，生成 `<modulePrefix>.table.<field>`
3. `el-form-item[label] + prop`：
- 命中 `template_label_attr` 且标签为 `el-form-item`，优先 `prop`，生成 `<modulePrefix>.form.<field>`
4. `label/placeholder` 的 `v-model` fallback：
- 当前标签存在 `v-model` 时取其字段；否则在 `el-form-item` 内取首个子节点 `v-model`
- root 为 `query/queryParams` -> `<modulePrefix>.query.<field>`
- root 为 `form/ruleForm/formData`（及其他 root）-> `<modulePrefix>.form.<field>`
5. `placeholder` 与 `form-item prop` 同字段稳定组合：
- 生成 `form` 特化 key：`<modulePrefix>.form.<field>Placeholder`

`single` 结构不做上述结构化推导，按文案复用，必要时回退 `auto`。

### 冲突策略

当候选 key 已被占用时，按“保守不误替换”处理：

- `同 key + 同文案`：允许复用
- `同 key + 不同文案`：不复用，记录冲突诊断
- 若存在 suffix 方案（如 `placeholder`）会先尝试 suffix key
- 仍不可用时回退 `<modulePrefix>.auto_xxx`

## 当前非目标

本阶段明确不做：

- 新增 template 识别规则
- 新增 script 识别规则
- 修改 key 生成逻辑
- 修改冲突处理逻辑
- 消灭所有 auto key
- dashboard / Web 服务 / 历史存储
- AI 修复建议

## CLI 用法

## 全局参数

- `--dir <path>`: 目标源码目录（默认当前工作目录）
- `--output <path>`: 资源输出入口（`module-dir` 默认 `./i18n`；`single` 默认 `./i18n/zh.json`）
- `--structure <type>`: `module-dir`（默认）或 `single`
- `--mode <name>`: `merge`（默认）或 `clean`（兼容 `overwrite`，内部会归一为 `merge`）
- `--script-rules <file>`: 外部 script 规则文件
- `--report [file]`: 生成 HTML 报告（`run/apply/report` 可用，默认 `./i18n-report.html`）
- `--report-json [file]`: 保留 JSON 报告（`run/apply` 可用，默认 `./i18n-report.json`）
- `--report-source <file>`: report 日志回放输入
- `--git-check <mode>`: `warn`（默认）/`strict`/`off`（apply 使用）
- `--out <path>`: `init` / `init-script-rules` 的输出目录或文件
- `--dry-run`: replace 预览不落盘
- `--debug`: 调试日志
- `--help` / `--version`

兼容说明：
- 旧用法 `i18n run/apply --report <xxx.json>` 仍兼容为“仅输出 JSON”（不推荐）。
- 新推荐用法：`--report` 产 HTML，`--report-json` 按需保留 JSON。

### `i18n scan`

扫描候选中文，不修改文件。

```bash
i18n scan --dir ./src
```

### `i18n extract`

生成/更新资源 key。

```bash
i18n extract --dir ./src --output ./i18n
```

### `i18n replace`

按当前资源映射执行替换（可 dry-run）。

```bash
i18n replace --dir ./src --output ./i18n --dry-run
```

### `i18n run`

评估链路：`scan -> extract -> replace --dry-run`。

```bash
i18n run --dir ./src --output ./i18n --report
```

### `i18n apply`

落地链路：`extract -> replace`。

```bash
i18n apply --dir ./src --output ./i18n --git-check strict --report
```

### `i18n report`

生成静态 HTML 报告（同时产出同名 JSON）。

```bash
i18n report --dir ./src --output ./i18n --report
```

### `i18n init` / `i18n init-script-rules`

初始化 script 规则模板。

```bash
i18n init ./
i18n init --out ./
i18n init-script-rules --out ./i18n/script-rules.json
```

## Report 两种模式

`i18n report` 支持两种语义：

1. 直接生成模式（默认面向用户）
- `i18n apply --report` / `i18n run --report`：直接生成 HTML 报告
- 若需保留 JSON：追加 `--report-json`

2. Replay 模式（执行复盘）
- 传 `--report-source <json>`
- 直接基于已有 `apply/run/step` JSON 日志生成 HTML
- 用于“已执行后”复盘本次实际结果

### `--report-source` 的作用

`--report-source` 指定 report 的数据来源为已有日志，而不是重新扫描推演。

示例：

```bash
i18n report \
  --dir ./src \
  --report-source ./output/apply-report.json \
  --report ./output/apply-report.html
```

### Preview/Replay 对齐条件

要让 preview 与 replay 可对比，参数需保持一致，至少包括：

- `--output`
- `--structure`
- `--script-rules`
- `--mode`

否则会出现“同一代码，不同口径”的结果偏差。

## 最小真实链路示例

推荐流程（收口期）：

```bash
# 1) 执行并直接拿 HTML（执行后立即可读）
i18n apply --dir ./src --output ./i18n --report ./output/apply-report.html

# 2) 如需保留 JSON（调试/复渲染）
i18n apply --dir ./src --output ./i18n --report ./output/apply-report.html --report-json ./output/apply-report.json

# 3) 基于 JSON 复渲染（高级用法）
i18n report --dir ./src --report-source ./output/apply-report.json --report ./output/apply-replay.html
```

## 验证与回归

```bash
npm run build
npm test
```

当前回归覆盖：

- 默认 `--structure=module-dir`
- 默认 `--dir=process.cwd()`
- 报告与日志中的文件路径统一为 project-relative + POSIX `/`
- report preview/replay
- report 与 apply 口径对齐
- 既有 scan/extract/replace/run/apply 行为稳定
