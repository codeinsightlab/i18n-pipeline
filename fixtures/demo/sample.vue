<template>
  <div class="app-container">
    <el-form>
      <!-- 已命中：template 静态属性 -->
      <el-form-item label="活动标题" prop="title">
        <el-input
          v-model="queryParams.title"
          placeholder="请输入活动标题"
          clearable
          @keyup.enter.native="handleQuery"
        />
      </el-form-item>

      <!-- 应命中但当前大概率漏网：静态属性 -->
      <el-form-item label="活动标题">
        <el-input placeholder="请输入活动标题" />
      </el-form-item>

      <!-- 应命中但当前大概率漏网：静态文本 -->
      <el-form-item>
        <el-button>新增</el-button>
        <el-button>修改</el-button>
        <el-button>删除</el-button>
        <el-button>导出</el-button>
      </el-form-item>
    </el-form>

    <el-table :data="list">
      <!-- 已命中 -->
      <el-table-column label="活动ID" align="center" prop="id" />

      <!-- 应命中但当前大概率漏网 -->
      <el-table-column label="前置动作" prop="activeBefore" />
      <el-table-column label="活动状态" prop="activityStatus" />
      <el-table-column label="操作">
        <template slot-scope="scope">
          <el-button type="text" @click="handleUpdate(scope.row)">修改</el-button>
          <el-button type="text" @click="handleDelete(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog :title="title" :visible.sync="open">
      <el-form :model="form" :rules="rules">
        <el-form-item label="活动标题" prop="title">
          <el-input v-model="form.title" placeholder="请输入活动标题" />
        </el-form-item>
        <el-form-item label="活动开始时间" prop="startTime">
          <el-date-picker placeholder="请选择活动开始时间" />
        </el-form-item>
      </el-form>

      <div slot="footer">
        <el-button type="primary" @click="submitForm">确 定</el-button>
        <el-button @click="cancel">取 消</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script>
export default {
  name: "ActivityI18nMini",
  data() {
    return {
      open: false,
      title: "",
      list: [],
      form: {
        title: null,
        startTime: null
      },
      rules: {
        title: [
          { required: true, message: "活动标题不能为空", trigger: "blur" }
        ],
        startTime: [
          { required: true, message: "活动开始时间不能为空", trigger: "change" }
        ]
      }
    };
  },
  methods: {
    handleAdd() {
      this.open = true;
      this.title = "添加活动信息";
    },
    handleUpdate(row) {
      this.open = true;
      this.title = "修改活动信息";
    },
    submitForm() {
      this.$modal.msgSuccess("修改成功");
      this.$modal.msgSuccess("新增成功");
      this.$modal.msgSuccess(this.form.title ? "开启成功" : "关闭成功");
    },
    handleDelete(row) {
      const ids = row.id || 1;
      this.$modal
        .confirm('是否确认删除活动信息编号为"' + ids + '"的数据项？')
        .then(() => {
          this.$modal.msgSuccess("删除成功");
        });
    },
    cancel() {
      this.open = false;
    }
  }
};
</script>
