// pages/schedule/import.js
Page({
  data: {
    filePath: '', fileName: '',
    uploading: false, parsing: false,
    parseResult: null, courses: [], semester: '', semesterLabel: '',
    importMode: 'replace', importing: false, importDone: false, importCount: 0, skipCount: 0,
    weekdayNames: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    existingCourses: [], // 已有课程（用于冲突检测）
  },

  onChooseFile() {
    const that = this;
    wx.chooseMessageFile({
      count: 1, type: 'file', extension: ['pdf'],
      success(res) {
        const file = res.tempFiles[0];
        that.setData({ filePath: file.path, fileName: file.name || '课表.pdf',
          parseResult: null, courses: [], importDone: false, existingCourses: [] });
      },
      fail() { wx.showToast({ title: '请选择 PDF 文件', icon: 'none' }); },
    });
  },

  onParsePDF() {
    if (!this.data.filePath) return;
    this.setData({ uploading: true, parsing: true });
    const cloudPath = 'schedules/' + Date.now() + '_' + this.data.fileName;

    wx.cloud.uploadFile({ cloudPath, filePath: this.data.filePath,
      success: (uploadRes) => {
        wx.cloud.callFunction({ name: 'parse_schedule_pdf', data: { fileID: uploadRes.fileID } })
          .then((res) => {
            this.setData({ uploading: false, parsing: false });
            if (res.result && res.result.success) {
              const { courses, semester } = res.result;
              const stamped = (courses || []).map(c => ({
                ...c, _originalWeekday: c.weekday, _replace: true
              }));
              this.setData({ parseResult: res.result, courses: stamped, semester: semester || '', semesterLabel: semester || '' });
              if (stamped.length === 0) wx.showModal({ title: '未识别到课程', content: 'PDF 格式可能不匹配', showCancel: false });
              else { wx.showToast({ title: '识别到 ' + stamped.length + ' 门课程', icon: 'success' }); this.checkConflicts(); }
            } else {
              wx.showToast({ title: res.result?.errMsg || '解析失败', icon: 'none', duration: 3000 });
            }
          }).catch(() => { this.setData({ uploading: false, parsing: false }); });
      },
      fail: () => { this.setData({ uploading: false, parsing: false }); },
    });
  },

  /** 检测冲突：已有课程中同日同时段的标记为冲突 */
  checkConflicts() {
    const { semester } = this.data;
    wx.cloud.callFunction({ name: 'query_courses', data: { semester } }).then((res) => {
      if (res.result && res.result.success) {
        const existing = res.result.data || [];
        const courses = this.data.courses.map(c => {
          const conflict = existing.find(e =>
            e.weekday === c.weekday && e.startSlot === c.startSlot &&
            !(c.endSlot < e.startSlot || c.startSlot > e.endSlot)
          );
          return { ...c, _conflict: conflict ? conflict.name : '', _conflictId: conflict ? conflict._id : '' };
        });
        this.setData({ existingCourses: existing, courses });
      }
    }).catch(() => {});
  },

  onWeekdayChange(e) {
    const idx = e.currentTarget.dataset.index;
    const newWeekday = parseInt(e.detail.value, 10) + 1;
    const courses = [...this.data.courses];
    courses[idx] = { ...courses[idx], weekday: newWeekday };
    this.setData({ courses });
    this.checkConflicts();
  },

  /** 切换单门课的导入开关（跳过/覆盖） */
  onToggleCourse(e) {
    const idx = e.currentTarget.dataset.index;
    const courses = [...this.data.courses];
    courses[idx] = { ...courses[idx], _replace: !courses[idx]._replace };
    this.setData({ courses });
  },

  onModeSelect(e) { this.setData({ importMode: e.currentTarget.dataset.mode }); },

  onConfirmImport() {
    const { courses, semester, importMode } = this.data;
    const conflicts = courses.filter(c => c._conflict);

    // 追加模式有冲突时确认
    if (conflicts.length > 0 && importMode === 'append') {
      wx.showModal({
        title: '课程冲突',
        content: `${conflicts.length} 门课与现有课表时间冲突，追加后将同时保留。\n确定继续？`,
        success: (r) => { if (r.confirm) this.doImport(courses, importMode); },
      });
      return;
    }

    // 智能合并：冲突的覆盖、无冲突追加
    if (importMode === 'merge') {
      const toDel = [...new Set(conflicts.filter(c => c._replace).map(c => c._conflictId).filter(Boolean))];
      const toAdd = courses.filter(c => c._replace);
      this.doImport(toAdd, 'append', toDel);
      return;
    }

    // 覆盖模式：替换全部
    const toImport = courses.filter(c => c._replace);
    if (toImport.length === 0) {
      wx.showToast({ title: '没有需要导入的课程', icon: 'none' });
      return;
    }
    this.doImport(toImport, importMode, null);
  },

  doImport(list, mode, preDeleteIds) {
    const { courses } = this.data;
    this.setData({ importing: true });

    const delTask = preDeleteIds && preDeleteIds.length > 0
      ? Promise.all(preDeleteIds.map(id => wx.cloud.callFunction({ name: 'remove_course', data: { _id: id } })))
      : Promise.resolve();

    delTask.then(() => {
      wx.cloud.callFunction({ name: 'import_courses', data: { courses: list, semester: this.data.semester, mode } })
        .then((res) => {
          this.setData({ importing: false });
          if (res.result && res.result.success) {
            const skipped = courses.filter(c => !c._replace).length;
            this.setData({ importDone: true, importCount: res.result.count || list.length, skipCount: skipped });
            wx.showToast({ title: '导入成功', icon: 'success' });
          } else { wx.showToast({ title: res.result?.errMsg || '导入失败', icon: 'none' }); }
        }).catch(() => { this.setData({ importing: false }); });
    }).catch(() => { this.setData({ importing: false }); wx.showToast({ title: '操作失败', icon: 'none' }); });
  },

  onBackToSchedule() { wx.navigateBack(); },
});
