# i18n-pipeline

`i18n-pipeline` 是一个面向旧项目国际化改造的最小 CLI。当前版本只做三件事：`scan`、`extract`、`replace`。它优先保证可运行、保守替换和结果一致性，不追求一次覆盖所有代码形态。

## Core

`src/core` 只负责通用能力，不直接绑定某个框架。

- `src/core/files.ts`: 文件收集和目录处理
- `src/core/keygen.ts`: 简单 key 生成
- `src/core/resources.ts`: 资源文件加载、扁平化和写回
- `src/core/rules.ts`: 当前版本的保守匹配和跳过原因规则
- `src/core/types.ts`: 命令、报告和替换数据结构

未来如果要适配更复杂的项目，建议在 `adapter` 层扩展，而不是把框架细节继续塞进 core。当前仓库还没有实现 adapter，只在设计上预留这个方向。

## Boundaries

当前支持：

- 扫描 `.js`、`.ts`、`.jsx`、`.tsx`、`.vue`
- JS/TS 中的普通中文字符串字面量
- Vue `<template>` 中的简单插值 `{{ "中文" }}`
- `scan`、`extract`、`replace --dry-run` 的 JSON 报告输出，包含 summary 和 per-file details
- 基于已有 `zh.json` 的稳定 key 复用

当前明确不支持：

- AST
- 自动注入 `t` import
- 自动注入 `useI18n`
- 模板字符串替换
- 复杂表达式替换
- Vue template 纯文本节点替换
- Vue 属性值替换
- 更多框架或插件系统

## Consistency

`scan`、`extract`、`replace` 遵循同一套保守规则。

- 已经是 `t("...")` 或 `{{ $t("...") }}` 的内容，不再作为候选重复处理
- `extract` 优先复用已有 `zh.json` 中的 key
- 当没有现成 key 时，新文本按稳定排序分配新 key，避免文件顺序变化导致 key 漂移
- `replace` 第二次执行时应保持幂等，不应产生新的代码修改

## Context Classification

当前版本在扫描后会先给中文候选打上下文分类，再决定是否可提取、是否可替换。

- `js_string`: JS/TS 中可安全处理的普通字符串字面量
- `template_attr_static`: Vue template 中的静态属性值，例如 `title="保存"`
- `template_text_static`: Vue template 中的静态文本节点，例如 `<span>保存</span>`
- `template_expr`: Vue template 中的简单插值字符串，例如 `{{ "保存" }}`
- `template_string`: 模板字符串，当前只进入 report，不参与提取或替换
- `unsafe_skip`: 明确高风险或当前不处理的场景，例如 `console_call`、`object_key`、注释等

这些分类会进入扫描结果和 report sample，字段包括：

- `context_type`
- `matched_rule`
- `extractable`
- `replaceable`
- `skip_reason`

## Scan Output

`scan` 除了逐条输出命中的候选，还会在结尾输出简洁摘要：

```text
scan_count:
  files_scanned: 3
  candidates_found: 11
```

这里的含义是：

- `files_scanned`: 当前目录下被遍历到的支持文件数
- `candidates_found`: 当前规则命中的候选中文总数

这只是终端摘要输出，不会改变 JSON report 的 `summary/details` 主结构。

## Key Rule

当前默认 key 规则是：

```text
<modulePrefix>.auto_<NNN>
```

例如：

- `plugins.auto_001`
- `router.auto_001`
- `system.user.auto_001`

规则说明：

- `modulePrefix` 来自相对扫描目录下的业务路径前缀
- 不直接使用完整物理路径
- 如果文件直接位于扫描目录根下，没有明显第一层模块目录，则退回为 `module`
- 相同原文优先复用已有 `zh.json` 里的 key
- 只有新增原文才会分配新 key
- 编号按模块前缀分别递增，例如 `plugins.auto_001`、`plugins.auto_002`
- 新 key 会从当前模块已有最大序号继续递增，不会因为重扫重排旧 key
- 稳定性优先于语义化命名，因此当前不做“不同原文自动合并 key”

`modulePrefix` 提取示例：

- 扫描目录：`src`
- 文件：`src/plugins/user/list.ts`
  结果前缀：`plugins`
- 文件：`src/router/index.ts`
  结果前缀：`router`
- 文件：`src/views/system/user/index.vue`
  结果前缀：`system.user`
- 文件：`src/app.ts`
  结果前缀：`module`

## Resource Structure

当前支持两种资源输出结构：

- `single`:
  默认模式，输出到单文件，例如 `./i18n/zh.json`
- `module-dir`:
  按 key 的模块前缀拆分目录，例如：
  - `system.user.auto_001` -> `./i18n/system/user/zh.json`
  - `plugins.download.auto_002` -> `./i18n/plugins/download/zh.json`

内部处理会先把资源统一加载成 `Map<key, text>`，`replace` 只依赖 key 到文本的扁平映射，不依赖资源文件的物理结构。
在 `module-dir` 下，旧 key 复用会优先限制在当前模块内；相同文本不会跨模块复用别的模块 key。

## CLI

```bash
npm run build
node dist/cli/index.js scan --dir ./fixtures/realish --report ./output/scan-report.json
node dist/cli/index.js extract --dir ./fixtures/realish --output ./i18n/zh.json --report ./output/extract-report.json
node dist/cli/index.js extract --dir ./fixtures/realish --output ./i18n/zh.json --structure module-dir
node dist/cli/index.js replace --dir ./fixtures/realish --output ./output/realish.zh.json --report ./output/replace-report.json --dry-run
```

`run` 和 `apply` 在传入 `--report` 时，会额外生成一份聚合总报告；控制台仍然保留摘要输出。

## Extract Mode

`extract` 现在统一使用：

```bash
--structure single|module-dir
--mode merge|clean
```

默认模式是 `merge`。如果不传 `--output`，默认输出到：

```text
./i18n/zh.json
```

不存在时会自动创建 `i18n` 目录。

两种模式的语义：

- `merge`:
  主流程默认模式。
  `single` 下会全局复用已有 key，为新文本追加新 key，并保留未命中的旧 key。
  `module-dir` 下会仅在当前模块内复用已有 key，为新文本追加当前模块 key，并保留所有旧 key。
- `clean`:
  不读取旧 `zh.json`，从头生成 key，最后覆盖写文件。

适用场景：

- `merge`:
  日常迭代和真实项目长期维护的推荐模式，默认只增不删，更安全。
- `clean`:
  适合第一次初始化或明确想重建 key 的情况。

注意：

- `merge` 是默认模式
- 主流程默认只增不删，不会自动删除旧 key
- `module-dir` 下会从 `./i18n/**/zh.json` 加载旧资源并扁平化复用
- `module-dir` 下旧 key 复用会优先限制在当前模块内，不会跨模块复用
- 当前不支持根据不同原文自动合并 key

## Report

report 统一分成两层：

- `summary`: 面向整次执行的总览统计
- `details`: 面向单文件的明细统计

字段口径：

- `files_scanned`: 本次遍历到的源文件总数，不要求每个文件都有命中
- `candidates_found`: 当前规则下被识别为候选中文文本的数量
- `replaced_count`: 当前命令实际可替换或计划替换的数量；`scan` 和 `extract` 固定为 `0`
- `skipped_count`: 进入 replace 分析但因保守规则被跳过的数量；`scan` 和 `extract` 固定为 `0`
- `skipped_reasons`: 按原因聚合的跳过统计；`scan` 和 `extract` 固定为空对象
- `extractable_count`: 当前命中的候选里，允许进入 extract 的数量
- `replaceable_count`: 当前命中的候选里，命中白名单且允许替换的数量
- `policy_skipped_count`: 当前命中的候选里，进入 report 但被当前策略跳过的数量
- `script_unsupported_count`: 当前命中的候选里，属于 `script_unsupported` 的数量
- `matched_rule_distribution`: 按具体命中规则聚合的分布，例如 `template_el_button_text`、`script_rules_message`、`script_unsupported_confirm_concat`
- `changed_files`: 本次命令会写入或计划写入的文件；`extract` 一般是语言包文件，`replace --dry-run` 是计划变更文件
- `unchanged_files`: 本次命令未产生代码或资源改动的文件列表
- `key_reused_count`: `extract` 或 `replace` 时复用已有 `zh.json` key 的文本数
- `key_created_count`: `extract` 或 `replace` 时新创建 key 的文本数

每个 `details` 条目至少包含：

- `file`: 相对路径
- `candidates_found`: 该文件中识别出的候选数量
- `replaced_count`: 该文件中实际或计划替换数量
- `skipped_count`: 该文件中被跳过的数量
- `skipped_reasons`: 该文件的跳过原因分布
- `extractable_count`: 该文件中允许进入 extract 的数量
- `replaceable_count`: 该文件中命中白名单且允许替换的数量
- `policy_skipped_count`: 该文件中进入 report 但被当前策略跳过的数量
- `matched_rule_distribution`: 该文件中具体命中规则的分布
- `review_priority`: 轻量人工审查优先级，仅有 `high / medium / low`
- `review_notes`: 对优先级的简短说明
- `samples`:
  轻量样本信息，只用于辅助阅读 report，不保证覆盖全部命中

`samples` 的边界：

- 只放少量样本，不做全量 trace
- 每个文件的 `replaced` 和 `skipped` 样本都有限制，当前最多各 `3` 条
- 每条样本尽量提供 `reason`、`text`、`line`、`snippet`，并补充 `context_type`、`matched_rule`、`extractable`、`replaceable`、`skip_reason`
- `snippet` 只是轻量上下文，不保证是完整代码片段
- 没有样本时可以省略 `samples`

如何解读 report：

- 先看 `summary.candidates_found` 和 `summary.replaced_count` 的比例，判断当前规则在这个模块上的可替换覆盖率
- 再看 `summary.skipped_reasons`，判断是日志、对象键名、模板字符串，还是 Vue 模板边界在限制覆盖率
- 最后看 `details`，定位哪些文件值得先人工审查，哪些文件可以先做小范围灰度替换
- 如果某个文件的 `samples.skipped` 主要是 `template_unsupported`，通常说明未来 adapter 优先级更高
- 如果某个文件的 `samples.replaced` 已经覆盖了典型按钮、表单文案或提示消息，这类文件更适合优先灰度替换

`review_priority` 的用途：

- 只用于帮助人工审查排队，不代表绝对安全性
- `high`: 当前规则下替换收益明显、跳过较少，适合优先进入人工审查
- `medium`: 可替换和跳过混合存在，适合结合样本判断
- `low`: 当前文件主要被跳过或受 unsupported 场景影响，通常不适合优先灰度

## Real Module Dry Run

建议对真实业务模块按下面顺序试跑：

```bash
node dist/cli/index.js scan \
  --dir /path/to/your/module \
  --report /path/to/output/i18n.scan.report.json

node dist/cli/index.js extract \
  --dir /path/to/your/module \
  --output /path/to/output/zh.json \
  --report /path/to/output/i18n.extract.report.json

node dist/cli/index.js replace \
  --dir /path/to/your/module \
  --output /path/to/output/zh.json \
  --report /path/to/output/i18n.replace.report.json \
  --dry-run
```

判断是否适合继续人工审查或灰度替换：

- `replaced_count` 明显大于 `skipped_count`，说明当前模块和现有规则匹配度较高
- `changed_files` 集中在少量 UI 文件时，适合先做人工审查后小范围替换
- `details` 中如果某些文件 `skipped_count` 特别高，建议先排除这些文件，不要整模块一次性推进

如何根据 `skipped_reasons` 判断下一步适配优先级：

- `console_call` 多，说明模块里有较多调试或日志文案，优先级通常低
- `object_key` 多，说明配置对象较多，贸然替换风险高，优先级低
- `template_string` 多，说明脚本侧动态文案较多，后续如果要增强，优先级较高
- `template_unsupported` 多，说明 Vue 模板里有纯文本节点或属性值，这通常是前端页面改造的优先入口
- `already_i18n` 多，说明模块已经有部分国际化，不必重复处理

如何识别下一步 adapter 优先级：

- `details` 里多个文件都被同一种 `skipped_reason` 卡住时，说明这是通用适配点
- `samples.skipped` 反复出现同类 Vue 属性值或纯文本节点时，说明优先考虑模板层 adapter
- `samples.skipped` 反复出现模板字符串时，说明脚本层动态文案是后续增强入口
- 如果 `samples.replaced` 已经能覆盖主要 UI 文案，而 `samples.skipped`  mostly 是低价值日志，暂时不需要优先做 adapter

## Recommended Workflow

推荐执行流程：

1. 先新建一个临时分支，再开始国际化试跑
2. 先执行 `i18n run --dir <path>`，确认扫描、提取和 dry-run 替换结果
3. 人工 review `report`、`zh.json` 和终端输出后，再执行 `i18n apply --dir <path>`
4. 如果结果不符合预期，优先使用 Git 回滚，而不是手工逐文件恢复

推荐的 Git 操作：

- 新建分支：`git checkout -b chore/i18n-tryout`
- 恢复单个文件：`git restore <file>`
- 恢复一批文件：`git restore path/to/dir`
- 回到上一个提交状态：`git reset --hard <commit>` 或 `git checkout <commit> -- <path>`

`apply` 的最小安全保护：

- 如果当前目录位于 Git 仓库中，`apply` 执行前会检查工作区是否干净
- `--git-check` 支持三种模式：`warn`、`strict`、`off`
- `warn` 是默认模式：如果发现未提交改动，会输出明确警告，但继续执行
- `strict` 会在发现未提交改动时直接终止 `apply`
- `off` 会完全跳过 Git 检查，不执行 Git 命令
- 后续如果需要，可以在这个位置扩展更严格模式或导出 patch 的备份能力

## Exit Codes

- `0`: 执行成功
- `2`: 参数错误或命令用法错误
- `3`: 预留给未来 `validate` 失败
- `4`: 运行时错误
