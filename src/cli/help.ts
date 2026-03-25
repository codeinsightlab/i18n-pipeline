export function formatHelp(version: string): string {
  return `i18n-pipeline ${version}

Usage:
  i18n <command> [options]

Commands:
  scan       Scan supported source files for Chinese candidates
  extract    Generate zh.json from scanned candidates
  replace    Replace supported candidates with i18n calls
  run        Run scan + extract + replace --dry-run
  apply      Run extract + replace
  init       Shortcut for init-script-rules
  init-script-rules  Generate script rules template JSON

Common Options:
  --dir <path>       Target directory (required for scan/extract/replace/run/apply)
  --output <file>    Output zh.json path (default: ./i18n/zh.json)
  --script-rules <file> Enable external script business rules from JSON
  --structure <type> Resource structure: single | module-dir
  --mode <name>      Resource update mode: merge (default) | clean
  --git-check <mode> Apply Git safety check: warn | strict | off
  --report <file>    Write JSON report to file
  --out <path>       Output file or directory (used by init/init-script-rules)
  --dry-run          Preview replacements without writing files
  --debug            Print extra debug information
  --help             Show this help message
  --version          Show CLI version

Notes:
  - Without --script-rules: assignment/call business script rules are disabled.
  - Built-in rules.message remains enabled even without --script-rules.
  - Use "i18n init ./", "i18n init --out ./", or
    "i18n init-script-rules --out ./i18n/script-rules.json" to bootstrap a rules file.

Examples:
  i18n scan --dir ./src
  i18n extract --dir ./src --output ./i18n/zh.json
  i18n extract --dir ./src --output ./i18n/zh.json --structure module-dir
  i18n replace --dir ./src --output ./i18n/zh.json --dry-run
  i18n apply --dir ./src --script-rules ./i18n/script-rules.json
  i18n init ./
  i18n init --out ./
  i18n init-script-rules --out ./i18n/script-rules.json
  i18n run --dir ./src
  i18n apply --dir ./src --output ./i18n/zh.json --git-check strict
`;
}
