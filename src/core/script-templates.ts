import type { ScriptTemplate } from "./types.js";

export const DEFAULT_SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    id: "modal_msg_success",
    callee: "this.$modal.msgSuccess",
    args: [
      { index: 0, pattern: "string_literal" }
    ]
  },
  {
    id: "modal_msg_success_ternary",
    callee: "this.$modal.msgSuccess",
    args: [
      { index: 0, pattern: "ternary_string" }
    ]
  },
  {
    id: "modal_confirm_concat",
    callee: "this.$modal.confirm",
    args: [
      { index: 0, pattern: "concat_string_var_string" }
    ]
  }
];
