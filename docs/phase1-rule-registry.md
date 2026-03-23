# i18n-pipeline Phase 1 规则注册表（Rule Registry）

> 目的：作为 Phase 1 的唯一事实源（single source of truth），用于验收、回归和排查。  
> 范围：仅描述当前已落地能力，不包含未来规划。

## 1) 已支持规则（Phase 1）

| rule_id | category | matched_rule | 匹配场景 | 替换行为 | 故意不支持边界 | skip 典型场景 | 示例（输入 -> 输出） | stage |
|---|---|---|---|---|---|---|---|---|
| `template_label_attr` | template | `template_label_attr` | 任意标签的 `label="中文"`（`el-table-column` 除外） | `label="中文"` -> `:label="$t('...')"` | 不处理 `title/alt/content/...` 等非白名单属性 | `title="中文"`、`alt="中文"` | `<el-form-item label="活动标题">` -> `<el-form-item :label="$t('...')">` | Phase 1 |
| `template_placeholder_attr` | template | `template_placeholder_attr` | 任意标签 `placeholder="中文"` | `placeholder="中文"` -> `:placeholder="$t('...')"` | 不处理 `start-placeholder/end-placeholder` | `start-placeholder="开始日期"` | `<el-input placeholder="请输入标题" />` -> `<el-input :placeholder="$t('...')" />` | Phase 1 |
| `template_el_button_text` | template | `template_el_button_text` | `<el-button>中文</el-button>` 文本节点 | `中文` -> `{{ $t("...") }}` | 仅 `el-button`，不扩到 `span/p/div/...` | `<span>中文</span>` | `<el-button>新增</el-button>` -> `<el-button>{{ $t("...") }}</el-button>` | Phase 1 |
| `template_el_table_column_label` | template | `template_el_table_column_label` | `<el-table-column label="中文" />` | `label="中文"` -> `:label="$t('...')"` | 仅 table-column 的 `label` 特判 | `el-table-column` 以外按通用 label 规则 | `<el-table-column label="操作" />` -> `<el-table-column :label="$t('...')" />` | Phase 1 |
| `script_rules_message` | script | `script_rules_message` | `rules` 语义邻域内的 `message: "中文"` | `"中文"` -> `t("...")` | 普通对象里的 `message` 不保证命中 | `const x={message:"中文"}` | `{ required:true, message:"活动标题不能为空" }` -> `{ ..., message:t("...") }` | Phase 1 |
| `script_this_title` | script | `script_this_title` | `this.title = "中文"` | `"中文"` -> `t("...")` | 不支持泛化 `dialogTitle/title:` 等 | `dialogTitle="中文"` | `this.title = "添加活动信息"` -> `this.title = t("...")` | Phase 1 |
| `script_modal_msgsuccess` | script | `modal_msg_success` | `this.$modal.msgSuccess("中文")` | `"中文"` -> `t("...")` | 仅 `$modal.msgSuccess`，不扩 `$message.*` / `msgError` | `this.$message.success("中文")` | `this.$modal.msgSuccess("修改成功")` -> `this.$modal.msgSuccess(t("..."))` | Phase 1 |
| `script_modal_msgsuccess_ternary` | script | `modal_msg_success_ternary` | `this.$modal.msgSuccess(cond ? "中文" : "中文")` | 两侧字符串分别替换为 `t("...")` | 不支持嵌套三元；不支持三元分支内拼接 | `cond ? "开"+x : "关"` | `msgSuccess(flag ? "开启成功":"关闭成功")` -> `msgSuccess(flag ? t("..."):t("..."))` | Phase 1 |
| `script_modal_confirm_concat` | script | `modal_confirm_concat` | `this.$modal.confirm("中文" + var + "中文")`（2/3 段） | 字符串片段替换为 `t("...")`，变量保留 | 仅 `$modal.confirm`，仅顶层 2/3 段拼接 | `"中"+a+b+"中"` / 非 confirm API | `confirm("确认删除" + id + "吗")` -> `confirm(t("...") + id + t("..."))` | Phase 1 |

## 2) 策略性未覆盖项（非 bug）

- template 非白名单属性：`title`、`alt`、`content`、`empty-text`、`start-placeholder`、`end-placeholder` 等。
- template 普通标签文本：`<span>/<p>/<div>/<label>/<button>` 等文本节点。
- script 非白名单 API：`this.$message.success/error`、`this.$modal.msgError`、泛 `title` 赋值、对象普通字符串。
- script 模板字符串、复杂拼接、复杂三元、嵌套表达式。

## 3) 不支持的典型 script/template 形态

- script:
  - `this.$message.success("中文")`
  - `this.$modal.msgError("中文")`
  - `const map = { 1: "成功", 2: "失败" }`
  - `` `欢迎${name}` ``
  - `this.$modal.confirm("中" + a + b + "中")`（超过受控边界）
- template:
  - `<img alt="头像" />`
  - `<el-date-picker start-placeholder="开始日期" end-placeholder="结束日期" />`
  - `<span>普通文案</span>`
  - `<el-tooltip content="提示文案" />`

## 4) 备注

- 本注册表对应代码口径：`src/core/rules.ts`、`src/scanner/scan.ts`、`src/replacer/replace.ts`。  
- `matched_rule` 是 report 统计主键；`rule_id` 仅用于文档层可读命名。  
- 当前阶段：**Phase 1（已收口）**。
