const rules = {
  title: [
    { required: true, message: "活动标题不能为空", trigger: "blur" }
  ],
  startTime: [
    { required: true, message: "活动开始时间不能为空", trigger: "change" }
  ]
};

function handleAdd() {
  this.title = "添加活动信息";
}

function handleUpdate() {
  this.title = "修改活动信息";
}

function submitForm() {
  this.$modal.msgSuccess("修改成功");
  this.$modal.msgSuccess("新增成功");
  this.$modal.msgSuccess(this.form.title ? "开启成功" : "关闭成功");
}

function handleDelete(row) {
  const ids = row.id || 1;
  this.$modal.confirm('是否确认删除活动信息编号为"' + ids + '"的数据项？');
}
