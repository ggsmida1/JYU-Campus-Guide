// pages/schedule/reminder-settings.js
Page({
  data: {
    settings: {
      reminderEnabled: true,
      defaultAdvance: 15,
      quietStart: '22:00',
      quietEnd: '07:00',
      semesterStart: '2026-02-24',
      totalWeeks: 20,
      vibrate: true,
    },
    advanceOptions: [
      { value: 5, label: '提前 5 分钟' },
      { value: 10, label: '提前 10 分钟' },
      { value: 15, label: '提前 15 分钟' },
      { value: 20, label: '提前 20 分钟' },
      { value: 30, label: '提前 30 分钟' },
    ],
    loading: true,
    saving: false,
  },

  onLoad() {
    this.loadSettings();
  },

  loadSettings() {
    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'get_user_settings',
    }).then((res) => {
      if (res.result && res.result.success && res.result.data) {
        const settings = { ...this.data.settings, ...res.result.data };
        this.setData({ settings, loading: false });
      } else {
        this.setData({ loading: false });
      }
    }).catch(() => {
      this.setData({ loading: false });
    });
  },

  // 开关类字段
  onSwitchChange(e) {
    const field = e.currentTarget.dataset.field;
    const settings = { ...this.data.settings, [field]: e.detail.value };
    this.setData({ settings });
    this.saveSettings({ [field]: e.detail.value });
  },

  // 选择器字段
  onPickerChange(e) {
    const field = e.currentTarget.dataset.field;
    const idx = e.detail.value;
    let value;
    if (field === 'defaultAdvance') {
      value = this.data.advanceOptions[idx].value;
    }
    const settings = { ...this.data.settings, [field]: value };
    this.setData({ settings });
    this.saveSettings({ [field]: value });
  },

  // 输入字段
  onInputChange(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    const settings = { ...this.data.settings, [field]: value };
    this.setData({ settings });
  },

  // 失去焦点时保存
  onInputBlur(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.saveSettings({ [field]: value });
  },

  // 数字字段
  onNumberBlur(e) {
    const field = e.currentTarget.dataset.field;
    const value = parseInt(e.detail.value, 10) || 20;
    const settings = { ...this.data.settings, [field]: value };
    this.setData({ settings });
    this.saveSettings({ [field]: value });
  },

  saveSettings(partial) {
    this.setData({ saving: true });
    wx.cloud.callFunction({
      name: 'update_user_settings',
      data: partial,
    }).then((res) => {
      this.setData({ saving: false });
      if (!res.result || !res.result.success) {
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ saving: false });
    });
  },

  /**
   * 请求订阅消息授权
   */
  onSubscribeMessage() {
    wx.requestSubscribeMessage({
      tmplIds: ['sPZvU2Gkqcb_8tzu-n9R5QyGp0HTF0Z9GX1-Zydpd8g'],
      success: () => {
        wx.showToast({ title: '授权成功', icon: 'success' });
      },
      fail: (err) => {
        if (err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '授权失败', icon: 'none' });
        }
      },
    });
  },
});
