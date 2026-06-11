// pages/schedule/course-reminder.js
Page({
  data: {
    courseId: '', courseName: '', reminders: [],
    typeOptions: [
      { value: 'class_start', label: '上课提醒' },
      { value: 'assignment', label: '作业提醒' },
      { value: 'custom', label: '自定义' },
    ],
    loading: true,
  },

  onLoad(options) {
    this.setData({
      courseId: decodeURIComponent(options.courseId || ''),
      courseName: decodeURIComponent(options.courseName || ''),
    });
    this.loadReminders();
  },

  loadReminders() {
    this.setData({ loading: true });
    wx.cloud.callFunction({ name: 'get_reminders', data: { course_id: this.data.courseId } })
      .then((res) => {
        if (res.result && res.result.success) {
          const reminders = (res.result.data || []).map(item => {
            const opt = this.data.typeOptions.find(o => o.value === item.type);
            return { ...item, typeLabel: opt ? opt.label : item.type };
          });
          this.setData({ reminders, loading: false });
        } else { this.setData({ loading: false }); }
      }).catch(() => { this.setData({ loading: false }); });
  },

  onToggleReminder(e) {
    const { index } = e.currentTarget.dataset;
    const r = this.data.reminders[index];
    wx.cloud.callFunction({ name: 'upsert_reminder', data: { course_id: r.course_id, type: r.type, advanceMinutes: r.advanceMinutes, enabled: !r.enabled, semester: r.semester } })
      .then((res) => { if (res.result && res.result.success) this.loadReminders(); });
  },

  /** 输入框修改提前分钟 */
  onAdvanceInput(e) {
    const { index } = e.currentTarget.dataset;
    const val = parseInt(e.detail.value, 10) || 15;
    const r = this.data.reminders[index];
    wx.cloud.callFunction({ name: 'upsert_reminder', data: { course_id: r.course_id, type: r.type, advanceMinutes: val, enabled: r.enabled, semester: r.semester } })
      .then((res) => { if (res.result && res.result.success) this.loadReminders(); });
  },

  /** 快捷按钮 */
  onQuickAdvance(e) {
    const min = parseInt(e.currentTarget.dataset.min, 10);
    const { courseId } = this.data;
    wx.cloud.callFunction({ name: 'upsert_reminder', data: { course_id: courseId, type: 'class_start', advanceMinutes: min, enabled: true, semester: '' } })
      .then((res) => {
        if (res.result && res.result.success) {
          wx.showToast({ title: '已设置提前' + min + '分钟', icon: 'success' });
          this.loadReminders();
        }
      });
  },

  onAddReminder() {
    wx.cloud.callFunction({ name: 'upsert_reminder', data: { course_id: this.data.courseId, type: 'class_start', advanceMinutes: 15, enabled: true, semester: '' } })
      .then((res) => { if (res.result && res.result.success) { wx.showToast({ title: '已添加', icon: 'success' }); this.loadReminders(); } });
  },

  onDeleteReminder(e) {
    const { index } = e.currentTarget.dataset;
    const r = this.data.reminders[index];
    wx.showModal({ title: '删除提醒', content: '确定删除？',
      success: (res) => { if (res.confirm) {
        wx.cloud.callFunction({ name: 'remove_reminder', data: { _id: r._id } })
          .then((result) => { if (result.result && result.result.success) { wx.showToast({ title: '已删除', icon: 'success' }); this.loadReminders(); } });
      }},
    });
  },

  onSubscribe() {
    wx.requestSubscribeMessage({
      tmplIds: ['sPZvU2Gkqcb_8tzu-n9R5QyGp0HTF0Z9GX1-Zydpd8g'],
      success: () => { wx.showToast({ title: '授权成功', icon: 'success' }); },
    });
  },
});
