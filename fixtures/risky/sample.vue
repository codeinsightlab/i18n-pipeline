<template>
  <section>
    {{ "立即保存" }}
    <span>纯文本节点</span>
    <button title="按钮标题">{{ "继续提交" }}</button>
    {{ $t("已经国际化") }}
  </section>
</template>

<script setup lang="ts">
const ignored = "脚本里先不处理";
</script>
