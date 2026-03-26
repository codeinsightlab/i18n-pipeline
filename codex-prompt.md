你现在是我的代码实现搭档，负责继续维护和验证 `i18n-pipeline`。
它属于我的长期技术资产仓库 `lixin-forge`。

当前阶段不是重新设计产品，也不是扩展成翻译平台，而是进入：

1. 真实项目试跑阶段
2. 保守规则收口阶段
3. 小步增强阶段

请把“稳定、可验证、低误伤”放在第一优先级。

---

## 一、当前定位

`i18n-pipeline` 是一个基于 Node.js + TypeScript 的 CLI 工具，用于帮助旧项目做国际化改造前的：

- 中文扫描
- 文本提取
- 资源生成
- 保守替换
- 试跑报告输出

它当前不是 AST 工具，不是翻译服务，不是 UI 管理平台。

---

## 二、必须遵守的总原则

1. 不引入 AST
2. 默认行为必须简单稳定
3. key 稳定性优先
4. append-only，不自动删除旧 key
5. 不做语义 key 自动生成
6. 不做翻译服务
7. 不过度设计
8. 优先真实项目收益
9. 宁可漏，不可错替换
10. 不要轻易扩大替换场景

---

## 二点五、最新口径覆盖（优先级最高）

> 如果本文后续旧描述与本节冲突，以本节为准。

### 1) script 规则启用口径

- `rules.message` 为内置能力（不传 `--script-rules` 也可生效）。
- `assignment/call` 业务规则默认不启用，必须显式传：
  - `--script-rules <path>`

### 2) 初始化命令（简化）

当前可用（等价）：

- `i18n init ./`
- `i18n init --out ./`
- `i18n init-script-rules --out ./i18n/script-rules.json`

说明：

- `init` 是 `init-script-rules` 的快捷别名。
- `--out` 可传目录或文件。
- 导出的规则模板为“文件头注释 + 默认模板（中英分段说明）”。
- 带 `//` 注释的规则文件可被正常解析。

### 3) module-dir key 规则（收敛口径）

核心原则：

- 命中什么结构，就归什么分组（先分组，再字段）。
- 不以“冲突后补救”决定分组。
- 跨分组同字段不得复用 key（例如 `form.userId`、`table.userId`、`rules.userId` 必须是不同 key）。

分组优先级（稳定锚点）：

1. `el-table-column[prop]` -> `<module>.table.<field>`
2. `el-form-item[prop]` -> `<module>.form.<field>`
3. `rules.message`（可稳定提取 field）-> `<module>.rules.<field>`
4. 表单类 `v-model` fallback：
   - 根为 `query/queryParams` -> `<module>.query.<field>`
   - 根为 `form/ruleForm/formData` -> `<module>.form.<field>`
5. 无稳定锚点 -> `<module>.auto_xxx`

组合表单场景（固定规则）：

- 外层 `label + prop`：`<module>.form.<field>`
- 同字段内层 `placeholder`：`<module>.form.<field>Placeholder`
- 不再生成：
  - `<module>.form.<field>.label`
  - `<module>.form.<field>.placeholder`

### 4) module-dir 资源落盘口径

- 模块前缀由文件路径承载（按模块文件拆分）。
- 模块文件内部保存“相对 key”的嵌套 JSON。
  - 例如完整 key：`order.transactions.form.userId`
  - 落盘：`{ "form": { "userId": "..." } }`
- 写入使用深度 merge（不覆盖整个父节点）。
- 路径冲突（叶子/对象冲突）必须可解释报错，不能静默覆盖。

### 5) append-only 与历史兼容

- 保持 append-only：不自动重命名历史 key。
- 历史 key 迁移若需要，必须作为显式迁移动作，不在主流程自动执行。

---

## 三、当前已完成能力（精简版）

### 1) CLI 命令

- `i18n scan`
- `i18n extract`
- `i18n replace`
- `i18n run`
- `i18n apply`
- `i18n init`
- `i18n init-script-rules`

### 2) 常用参数

- `--dir <path>`
- `--output <file>`
- `--report <file>`
- `--structure single|module-dir`
- `--mode merge|clean`
- `--script-rules <file>`
- `--git-check warn|strict|off`
- `--dry-run`

### 3) 报告与安全

- `scan/extract/replace/run/apply` 均可输出 report。
- `apply` 支持 `git-check` 执行前安全控制。
- 主流程保持 append-only（默认按 `merge` 理解）。

---

## 四、扫描/替换边界（当前口径）

### 1) 文件与注释

- 支持：`.js/.ts/.jsx/.tsx/.vue`
- 注释过滤：`//`、`/* */`、`<!-- -->` 均不进入候选

### 2) template 支持

- `label="中文"`
- `placeholder="中文"`
- `<el-button>中文</el-button>`
- `<el-table-column label="中文" />`
- `{{ "中文" }}` 简单插值

### 3) script 支持

- 内置：`rules.message`（结构语义邻域内）
- 外部规则：仅在显式传 `--script-rules` 后生效
  - `assignment`
  - `call`

### 4) 明确不支持（保持保守）

- AST 与复杂表达式替换
- 任意 script 中文字符串的泛化替换
- 白名单外 template 属性/标签文本
- 自动注入 import/useI18n
- 翻译服务与语义 key 系统

---

## 五、key 与资源规则（当前口径）

### 1) single

- 保持稳定复用 + `auto_xxx` 回退策略

### 2) module-dir

- 分组优先：`form/table/rules/query/auto`
- 跨分组同字段不复用
- 组合表单固定规则：
  - `form.<field>`
  - `form.<field>Placeholder`
- 模块文件为嵌套 JSON，相对 key 落盘，深度 merge
- 叶子/对象路径冲突：必须报可解释错误

---

## 八、当前 CLI 使用方式

### 推荐日常试跑

```bash
i18n run --dir /path/to/module
```

说明：

- 执行 `scan`
- 执行 `extract`（仅内存，不写资源）
- 执行 `replace --dry-run`
- 不修改资源文件

### 推荐正式写入

```bash
i18n apply --dir /path/to/module --git-check strict
```

说明：

- 先提取并写资源
- 再执行代码替换
- 建议要求 Git 工作区干净

### 查看资源输出

```bash
i18n extract --dir /path/to/module
```

### 预演替换

```bash
i18n replace --dir /path/to/module --dry-run
```

### 推荐真实项目试跑方式

优先先跑小模块，不要一上来扫整个仓库根目录。

推荐顺序：

1. 新建分支
2. `i18n run --dir <模块目录> --report <文件>`
3. review report
4. 确认后再 `i18n apply --dir <模块目录> --git-check strict`

---

## 九、当前阶段最重要的工作方式

如果你在新会话中继续工作，请严格按以下顺序推进：

1. 先读取代码和现有测试
2. 先确认当前边界，不要直接扩能力
3. 先分析真实项目漏替换原因
4. 只补“明确静态、明确白名单、明确低风险”的场景
5. 每补一类规则，必须补最小测试
6. 不要破坏现有 key 稳定性和 append-only 语义

---

## 十、当前阶段明确不该做的事

本阶段不要做：

- AST
- validate 命令大扩展
- rollback / snapshot / patch 系统
- 翻译服务
- 语义 key 体系重构
- 自动 import 注入
- 自动 `useI18n` 注入
- 扩大到任意 script 中文替换
- 扩大到复杂 template 表达式替换
- 复杂插件系统
- 前端展示页面

---

## 十一、关于 key 的后续轻量方案

当前存在 `module.auto_xxx` 前缀偏粗的问题，但本阶段不要迁移历史 key，也不要推翻现有资源结构。

只允许做这种轻量思路：

- 后续新增 key 可以考虑更细的 `modulePrefix`
- 但不能影响历史 key
- 不能影响当前 replace 稳定性

---

## 十二、下一会话的默认输出要求

请按这个顺序输出：

1. 你对当前项目状态的理解
2. 当前已完成能力与严格边界
3. 本轮准备处理的最小范围
4. 每类修改点的实现方案
5. 风险点与跳过策略
6. 测试用例设计
7. 明确哪些内容故意不做

如果本轮用户让你开始改代码：

- 先读相关文件
- 再给出简短收口说明
- 然后直接改代码
- 最后跑测试并汇报结果

不要把范围擅自扩出去。
