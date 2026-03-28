export function formatHelp(version: string): string {
  return `i18n-pipeline ${version}

Usage:
  i18n <command> [options]

Commands:
  [Main]
  run        Run scan + extract + replace --dry-run
  apply      Run extract + replace
  report     Generate static HTML quality report
  [Debug]
  scan       Scan supported source files for Chinese candidates
  extract    Generate zh.json from scanned candidates
  replace    Replace supported candidates with i18n calls
  init       Shortcut for init-script-rules
  init-script-rules  Generate script rules template JSON

Common Options:
  --dir <path>       Target directory (default: current working directory)
  --output <path>    Output path (default: ./i18n for module-dir, ./i18n/zh.json for single)
  --script-rules <file> Enable external script business rules from JSON
  --structure <type> Resource structure: module-dir (default) | single
  --mode <name>      Resource update mode: merge (default) | clean
  --git-check <mode> Apply Git safety check: warn | strict | off
  --report [file]    Generate HTML report (run/apply/report). Default: ./i18n-report.html
  --report-json [file] Keep JSON report for run/apply. Default: ./i18n-report.json
  --report-source <file> Use existing JSON log/report as report input (for report command)
  --out <path>       Output file or directory (used by init/init-script-rules)
  --dry-run          Preview replacements without writing files
  --debug            Print extra debug information
  --help             Show this help message
  --version          Show CLI version

Notes:
  - Without --script-rules: assignment/call business script rules are disabled.
  - Built-in rules.message remains enabled even without --script-rules.
  - Legacy compatibility: run/apply "--report <xxx.json>" still means JSON-only (not recommended).
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
  i18n apply --dir ./src --output ./i18n --git-check strict --report
  i18n apply --dir ./src --output ./i18n --report ./output/apply-report.html --report-json
  i18n report --dir ./src --report
  i18n report --dir ./src --report-source ./output/apply-report.json --report ./output/apply-report.html
`;
}
