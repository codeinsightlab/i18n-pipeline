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

Common Options:
  --dir <path>       Target directory to scan
  --output <file>    Output zh.json path (default: ./i18n/zh.json)
  --structure <type> Resource structure: single | module-dir
  --mode <name>      Resource update mode: merge (default) | clean
  --git-check <mode> Apply Git safety check: warn | strict | off
  --report <file>    Write JSON report to file
  --dry-run          Preview replacements without writing files
  --debug            Print extra debug information
  --help             Show this help message
  --version          Show CLI version

Examples:
  i18n scan --dir ./src
  i18n extract --dir ./src --output ./i18n/zh.json
  i18n extract --dir ./src --output ./i18n/zh.json --structure module-dir
  i18n replace --dir ./src --output ./i18n/zh.json --dry-run
  i18n run --dir ./src
  i18n apply --dir ./src --output ./i18n/zh.json --git-check strict
`;
}
