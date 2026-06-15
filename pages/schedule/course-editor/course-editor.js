// pages/schedule/course-editor.js
const { getAllColors } = require('../../../utils/course-colors');

Page({
  data: {
    mode: 'add', // 'add' | 'edit'
    courseId: '',
    semester: '',

    // 表单数据
    form: {
      name: '',
      type: '',
      teacher: '',
      location: '',
      campus: '',
      weekday: 1,
      startSlot: 1,
      endSlot: 2,
      startWeek: 1,
      endWeek: 17,
      weekMode: 'all',
      specificWeeks: [],
      teachingClass: '',
      classGroup: '',
      examMethod: '',
      lectureHours: 0,
      labHours: 0,
      weeklyHours: 0,
      totalHours: 0,
      credits: 0,
      color: null,
      remarks: '',
    },

    // 选项数据
    typeOptions: ['', '讲课', '实验', '实践', '上机', '讨论'],
    weekdayOptions: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    weekModeOptions: [
      { value: 'all', label: '每周' },
      { value: 'odd', label: '单周' },
      { value: 'even', label: '双周' },
      { value: 'specific', label: '指定周' },
    ],
    slotOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    colors: getAllColors(),

    // 派生数据
    weekModeLabel: '每周',
    typeIndex: 0,

    // 冲突信息
    conflictInfo: null,
    saving: false,
  },

  /**
   * 更新派生显示字段（WXML 不支持 .find / => / ?. 语法）
   */
  updateDerived() {
    const { form, weekModeOptions, typeOptions } = this.data;
    const mode = weekModeOptions.find(o => o.value === form.weekMode);
    const typeIdx = typeOptions.indexOf(form.type);
    this.setData({
      weekModeLabel: mode ? mode.label : '每周',
      typeIndex: typeIdx >= 0 ? typeIdx : 0,
    });
  },

  onLoad(options) {
    const mode = options.mode || 'add';
    const courseId = options.id || '';
    // 从上一页获取学期信息
    const pages = getCurrentPages();
    const prevPage = pages[pages.length - 2];
    const semester = prevPage ? prevPage.data.semester : '';

    this.setData({ mode, courseId, semester });
    this.updateDerived();

    if (mode === 'edit' && courseId) {
      this.loadCourse(courseId);
    }
  },

  /**
   * 加载已有课程数据（编辑模式）
   */
  loadCourse(id) {
    wx.cloud.callFunction({
      name: 'query_courses',
      data: {},
    }).then((res) => {
      if (res.result && res.result.success) {
        const course = res.result.data.find(c => c._id === id);
        if (course) {
          this.setData({
            form: { ...course },
            semester: course.semester,
          });
        }
      }
    });
  },

  /**
   * 文本字段变更（input 绑定）
   */
  onFieldChange(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    const form = { ...this.data.form, [field]: value };
    this.setData({ form, conflictInfo: null });
    this.updateDerived();
  },

  /**
   * picker 字段变更（需将索引转为实际值）
   */
  onPickerChange(e) {
    const { field } = e.currentTarget.dataset;
    const idx = parseInt(e.detail.value, 10);
    const form = { ...this.data.form };

    if (field === 'type') {
      form.type = this.data.typeOptions[idx] || '';
    } else if (field === 'weekMode') {
      form.weekMode = this.data.weekModeOptions[idx].value;
    } else if (field === 'weekday') {
      form.weekday = idx + 1; // 索引0→周一(1)
    } else if (field === 'startSlot') {
      form.startSlot = idx + 1; // 索引0→第1节
      if (form.startSlot > form.endSlot) form.endSlot = form.startSlot;
    } else if (field === 'endSlot') {
      form.endSlot = idx + 1;
      if (form.endSlot < form.startSlot) form.startSlot = form.endSlot;
    } else {
      form[field] = idx;
    }

    this.setData({ form, conflictInfo: null });
    this.updateDerived();
  },

  /**
   * 数字字段变更
   */
  onNumberChange(e) {
    const { field } = e.currentTarget.dataset;
    const value = parseInt(e.detail.value, 10) || 0;
    const form = { ...this.data.form, [field]: value };

    // endSlot 自动不小于 startSlot
    if (field === 'startSlot' && value > form.endSlot) {
      form.endSlot = value;
    }
    if (field === 'endSlot' && value < form.startSlot) {
      form.startSlot = value;
    }

    this.setData({ form });
    this.updateDerived();
  },

  /**
   * 颜色选择
   */
  onColorSelect(e) {
    const index = e.currentTarget.dataset.index;
    const form = { ...this.data.form, color: this.data.colors[index] };
    this.setData({ form });
  },

  /**
   * 指定周次输入
   */
  onSpecificWeeksInput(e) {
    const value = e.detail.value;
    const weeks = value
      .split(/[,，]/)
      .map(w => parseInt(w.trim(), 10))
      .filter(w => !isNaN(w) && w > 0);
    const form = { ...this.data.form, specificWeeks: weeks };
    this.setData({ form });
  },

  /**
   * 保存课程
   */
  onSave() {
    const { form, mode, courseId, semester } = this.data;

    // 表单校验
    if (!form.name.trim()) {
      wx.showToast({ title: '请输入课程名称', icon: 'none' });
      return;
    }
    if (!form.weekday) {
      wx.showToast({ title: '请选择星期', icon: 'none' });
      return;
    }

    this.setData({ saving: true });

    const payload = {
      ...form,
      semester,
    };

    // 编辑模式附加 _id
    if (mode === 'edit' && courseId) {
      payload._id = courseId;
    }

    const cloudFunc = mode === 'edit' ? 'update_course' : 'add_course';

    wx.cloud.callFunction({
      name: cloudFunc,
      data: payload,
    }).then((res) => {
      this.setData({ saving: false });
      if (res.result && res.result.success) {
        wx.showToast({ title: mode === 'edit' ? '已更新' : '已添加', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 1500);
      } else {
        if (res.result && res.result.conflicts) {
          this.setData({ conflictInfo: res.result.conflicts });
        }
        wx.showToast({ title: res.result?.errMsg || '保存失败', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ saving: false });
      wx.showToast({ title: '网络错误', icon: 'none' });
    });
  },

  /**
   * 删除（编辑模式）
   */
  onDelete() {
    wx.showModal({
      title: '确认删除',
      content: '确定删除这门课程吗？相关提醒也会被删除。',
      success: (res) => {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'remove_course',
            data: { _id: this.data.courseId },
          }).then((result) => {
            if (result.result && result.result.success) {
              wx.showToast({ title: '已删除', icon: 'success' });
              setTimeout(() => wx.navigateBack(), 1000);
            }
          });
        }
      },
    });
  },
});
