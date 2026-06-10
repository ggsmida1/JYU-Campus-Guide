// pages/schedule/import.js
Page({
  data: {
    // 文件
    filePath: '',
    fileName: '',
    fileType: '', // 'pdf' | 'excel'

    // 解析状态
    uploading: false,
    parsing: false,
    parseResult: null,
    courses: [],
    semester: '',
    semesterLabel: '',

    // 导入
    importMode: 'replace', // 'replace' | 'append'
    importing: false,
    importDone: false,
    importCount: 0,

    // 星期修正
    weekdayNames: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  },

  /**
   * 选择文件
   */
  onChooseFile() {
    const that = this;
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx', 'xls', 'csv', 'pdf'],
      success(res) {
        const file = res.tempFiles[0];
        const name = file.name || '';
        const ext = name.split('.').pop().toLowerCase();
        const type = (ext === 'pdf') ? 'pdf' : 'excel';

        that.setData({
          filePath: file.path,
          fileName: name,
          fileType: type,
          parseResult: null,
          courses: [],
          importDone: false,
        });
      },
      fail() {
        wx.showToast({ title: '请选择 xlsx / csv / pdf 文件', icon: 'none' });
      },
    });
  },

  /**
   * 上传并解析
   */
  onParsePDF() {
    this.doParse('parse_schedule_pdf');
  },

  onParseExcel() {
    this.doParse('parse_schedule_excel');
  },

  doParse(funcName) {
    if (!this.data.filePath) {
      wx.showToast({ title: '请先选择文件', icon: 'none' });
      return;
    }

    this.setData({ uploading: true, parsing: true });

    const cloudPath = `schedules/${Date.now()}_${this.data.fileName}`;
    wx.cloud.uploadFile({
      cloudPath,
      filePath: this.data.filePath,
      success: (uploadRes) => {
        wx.cloud.callFunction({
          name: funcName,
          data: { fileID: uploadRes.fileID },
        }).then((res) => {
          this.setData({ uploading: false, parsing: false });
          if (res.result && res.result.success) {
            const { courses, semester } = res.result;
            // 给每门课标记原始 weekday 以便修正时高亮
            const stamped = (courses || []).map(c => ({
              ...c,
              _originalWeekday: c.weekday,
            }));
            this.setData({
              parseResult: res.result,
              courses: stamped,
              semester: semester || '',
              semesterLabel: semester || '',
            });
            if ((courses || []).length === 0) {
              wx.showModal({
                title: '未识别到课程',
                content: '文件格式可能不匹配。\n\n列表格式：确保有"课程名称""教师""教室""星期"等列头\n网格格式：确保有"星期一~星期日"列头\n\n也可下载模板填写后导入。',
                showCancel: false,
              });
            } else {
              wx.showToast({ title: `识别到 ${courses.length} 门课程`, icon: 'success' });
            }
          } else {
            wx.showToast({
              title: res.result?.errMsg || '解析失败',
              icon: 'none',
              duration: 3000,
            });
          }
        }).catch((err) => {
          this.setData({ uploading: false, parsing: false });
          wx.showToast({ title: '解析异常，请重试', icon: 'none' });
        });
      },
      fail: () => {
        this.setData({ uploading: false, parsing: false });
        wx.showToast({ title: '文件上传失败', icon: 'none' });
      },
    });
  },

  /**
   * 选择导入模式
   */
  onModeSelect(e) {
    this.setData({ importMode: e.currentTarget.dataset.mode });
  },

  /**
   * 确认导入
   */
  onConfirmImport() {
    const { courses, semester, importMode } = this.data;
    if (!courses.length) return;

    this.setData({ importing: true });
    wx.cloud.callFunction({
      name: 'import_courses',
      data: { courses, semester, mode: importMode },
    }).then((res) => {
      this.setData({ importing: false });
      if (res.result && res.result.success) {
        this.setData({
          importDone: true,
          importCount: res.result.count || courses.length,
        });
        wx.showToast({ title: '导入成功', icon: 'success' });
      } else {
        wx.showToast({ title: res.result?.errMsg || '导入失败', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ importing: false });
      wx.showToast({ title: '网络错误', icon: 'none' });
    });
  },

  /**
   * 修正某门课程的星期
   */
  onWeekdayChange(e) {
    const idx = e.currentTarget.dataset.index;
    const newWeekday = parseInt(e.detail.value, 10) + 1; // 索引→星期
    const courses = [...this.data.courses];
    courses[idx] = { ...courses[idx], weekday: newWeekday };
    this.setData({ courses });
  },

  /**
   * 返回课表页
   */
  onBackToSchedule() {
    wx.navigateBack();
  },
});
