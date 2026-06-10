// pages/schedule/course-reminder.js
Page({
  data: {
    courseId: '',
    courseName: '',
    reminders: [],
    typeOptions: [
      { value: 'class_start', label: '上课提醒' },
      { value: 'assignment', label: '作业提醒' },
      { value: 'custom', label: '自定义' },
    ],
    advanceOptions: [
      { value: 5, label: '5 分钟前' },
      { value: 10, label: '10 分钟前' },
      { value: 15, label: '15 分钟前' },
      { value: 20, label: '20 分钟前' },
      { value: 30, label: '30 分钟前' },
      { value: 60, label: '1 小时前' },
    ],
    loading: true,
  },

  onLoad(options) {
    const { courseId, courseName } = options;
    this.setData({
      courseId: decodeURIComponent(courseId || ''),
      courseName: decodeURIComponent(courseName || ''),
    });
    this.loadReminders();
  },

  loadReminders() {
    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'get_reminders',
      data: { course_id: this.data.courseId },
    }).then((res) => {
      if (res.result && res.result.success) {
        // 注入预计算的 typeLabel（WXML 不支持 .find() 语法）
        const reminders = (res.result.data || []).map(item => {
          const opt = this.data.typeOptions.find(o => o.value === item.type);
          return { ...item, typeLabel: opt ? opt.label : item.type };
        });
        this.setData({ reminders, loading: false });
      } else {
        this.setData({ loading: false });
      }
    }).catch(() => {
      this.setData({ loading: false });
    });
  },

  /**
   * 切换提醒开关
   */
  onToggleReminder(e) {
    const { index } = e.currentTarget.dataset;
    const reminder = this.data.reminders[index];
    wx.cloud.callFunction({
      name: 'upsert_reminder',
      data: {
        course_id: reminder.course_id,
        type: reminder.type,
        advanceMinutes: reminder.advanceMinutes,
        enabled: !reminder.enabled,
        semester: reminder.semester,
      },
    }).then((res) => {
      if (res.result && res.result.success) {
        this.loadReminders();
      }
    });
  },

  /**
   * 修改提前时间
   */
  onAdvanceChange(e) {
    const { index } = e.currentTarget.dataset;
    const advanceIdx = e.detail.value;
    const reminder = this.data.reminders[index];
    const advanceMinutes = this.data.advanceOptions[advanceIdx].value;

    wx.cloud.callFunction({
      name: 'upsert_reminder',
      data: {
        course_id: reminder.course_id,
        type: reminder.type,
        advanceMinutes,
        enabled: reminder.enabled,
        semester: reminder.semester,
      },
    }).then((res) => {
      if (res.result && res.result.success) {
        this.loadReminders();
      }
    });
  },

  /**
   * 添加新提醒
   */
  onAddReminder() {
    const { courseId, courseName } = this.data;
    // 默认添加上课提醒
    wx.cloud.callFunction({
      name: 'upsert_reminder',
      data: {
        course_id: courseId,
        type: 'class_start',
        advanceMinutes: 15,
        enabled: true,
        semester: '',
      },
    }).then((res) => {
      if (res.result && res.result.success) {
        wx.showToast({ title: '已添加', icon: 'success' });
        this.loadReminders();
      }
    });
  },

  /**
   * 删除提醒
   */
  onDeleteReminder(e) {
    const { index } = e.currentTarget.dataset;
    const reminder = this.data.reminders[index];

    wx.showModal({
      title: '删除提醒',
      content: '确定删除这个提醒设置吗？',
      success: (res) => {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'remove_reminder',
            data: { _id: reminder._id },
          }).then((result) => {
            if (result.result && result.result.success) {
              wx.showToast({ title: '已删除', icon: 'success' });
              this.loadReminders();
            }
          });
        }
      },
    });
  },

  /**
   * 请求订阅消息授权
   */
  onSubscribe() {
    wx.requestSubscribeMessage({
      tmplIds: ['sPZvU2Gkqcb_8tzu-n9R5QyGp0HTF0Z9GX1-Zydpd8g'],
      success: () => {
        wx.showToast({ title: '授权成功', icon: 'success' });
      },
    });
  },
});
