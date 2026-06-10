// pages/schedule/schedule.js
const app = getApp();
const { getCurrentWeek, isCourseActiveInWeek, guessCurrentSemester, parseSemesterId } = require('../../../utils/semester');
const { assignColor } = require('../../../utils/course-colors');

Page({
  data: {
    // 学期
    semester: '',
    semesterLabel: '',
    semesterStart: '2026-02-24', // 默认值，由 user_settings 覆盖
    totalWeeks: 20,

    // 周次
    currentWeek: 1,
    displayWeek: 1,

    // 课程数据
    courses: [],
    weekCourses: [], // 当前周要显示的课程

    // 节次表（嘉应学院作息时间）
    // 每节课45分钟，课间10分钟；第2-3节间20分钟；午休、晚饭间隔较长
    periodLabels: ['', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
    periodTimes: [
      '',
      '08:00',   // 第1节 08:00-08:45
      '08:55',   // 第2节 08:55-09:40
      '10:00',   // 第3节 10:00-10:45（大课间）
      '10:55',   // 第4节 10:55-11:40
      '14:30',   // 第5节 14:30-15:15（午休后）
      '15:25',   // 第6节 15:25-16:10
      '16:20',   // 第7节 16:20-17:05
      '17:15',   // 第8节 17:15-18:00
      '19:30',   // 第9节 19:30-20:15（晚饭后）
      '20:25',   // 第10节 20:25-21:10
    ],

    // 星期头
    weekdays: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],

    // 状态
    loading: true,
    hasCourses: false,
    semesterOptions: [],
    selectedSemesterIndex: 0,
  },

  onLoad() {
    this.initSemester();
  },

  onShow() {
    // 从其他页面返回时刷新
    if (this.data.semester) {
      this.loadCourses();
      this.loadSettings();
    }
    // 检查是否有从导入页传来的指定学期
    const pages = getCurrentPages();
    const currPage = pages[pages.length - 1];
    if (currPage && currPage.options && currPage.options.semester) {
      const importSemester = currPage.options.semester;
      if (importSemester !== this.data.semester) {
        this.ensureSemesterInOptions(importSemester);
        const idx = this.data.semesterOptions.findIndex(o => o.id === importSemester);
        const { label } = parseSemesterId(importSemester);
        this.setData({
          semester: importSemester,
          semesterLabel: label,
          selectedSemesterIndex: idx >= 0 ? idx : 0,
        });
        this.loadCourses(true);
        this.loadSettings();
      }
    }
  },

  /**
   * 初始化学期信息
   */
  initSemester() {
    const currentSemester = guessCurrentSemester();
    const { label } = parseSemesterId(currentSemester);
    const options = this.generateSemesterOptions();
    const idx = options.findIndex(o => o.id === currentSemester);

    this.setData({
      semester: currentSemester,
      semesterLabel: label,
      semesterOptions: options,
      selectedSemesterIndex: idx >= 0 ? idx : 0,
    });

    this.loadSettings();
    this.loadCourses(true);
  },

  /**
   * 生成学期选项（前后各 3 年）
   */
  generateSemesterOptions() {
    const now = new Date();
    const year = now.getFullYear();
    const options = [];
    for (let y = year - 3; y <= year + 1; y++) {
      options.push({ id: y + '-' + (y + 1) + '-1', label: y + '-' + (y + 1) + ' 第一学期' });
      options.push({ id: y + '-' + (y + 1) + '-2', label: y + '-' + (y + 1) + ' 第二学期' });
    }
    return options;
  },

  /**
   * 确保导入的学期在选项列表中
   */
  ensureSemesterInOptions(semesterId) {
    const options = [...this.data.semesterOptions];
    if (!options.find(o => o.id === semesterId)) {
      const { label } = parseSemesterId(semesterId);
      options.push({ id: semesterId, label });
      options.sort((a, b) => a.id.localeCompare(b.id));
      const idx = options.findIndex(o => o.id === semesterId);
      this.setData({ semesterOptions: options, selectedSemesterIndex: idx });
    }
  },

  /**
   * 加载用户设置
   */
  loadSettings() {
    wx.cloud.callFunction({
      name: 'get_user_settings',
    }).then((res) => {
      let start = '2026-02-24';
      let weeks = 20;
      if (res.result && res.result.success && res.result.data) {
        // data 可能是数组或单个对象
        const settings = Array.isArray(res.result.data) ? res.result.data[0] : res.result.data;
        if (settings) {
          start = settings.semesterStart || start;
          weeks = settings.totalWeeks || weeks;
        }
      }
      const currentWeek = getCurrentWeek(new Date(), start);

      this.setData({
        semesterStart: start,
        totalWeeks: weeks,
        currentWeek: Math.min(currentWeek, weeks),
        displayWeek: Math.min(currentWeek, weeks),
      });
      // 设置完周次后重新过滤
      this.filterWeekCourses();
    }).catch(() => {
      // 使用默认值
      const currentWeek = getCurrentWeek(new Date(), '2026-02-24');
      this.setData({
        currentWeek: Math.min(currentWeek, 20),
        displayWeek: Math.min(currentWeek, 20),
      });
      this.filterWeekCourses();
    });
  },

  /**
   * 加载课程数据
   */
  loadCourses(isRefresh) {
    // 首次加载显示 loading，切换学期时保持旧数据显示避免闪烁
    if (!isRefresh) this.setData({ loading: true });

    const semester = this.data.semester;
    wx.cloud.callFunction({
      name: 'query_courses',
      data: { semester },
    }).then((res) => {
      if (res.result && res.result.success) {
        const courses = res.result.data || [];
        courses.forEach((c) => {
          if (!c.color || !c.color.name) {
            c.color = assignColor(courses);
          }
        });

        this.ensureSemesterInOptions(semester);

        this.setData({
          courses,
          hasCourses: courses.length > 0,
          loading: false,
        });
        this.filterWeekCourses();
      } else {
        this.setData({ loading: false });
      }
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  /**
   * 根据当前显示周次过滤课程，并预计算展示样式
   */
  filterWeekCourses() {
    const { courses, displayWeek } = this.data;
    const weekCourses = courses
      .filter(c => isCourseActiveInWeek(c, displayWeek))
      .map(c => ({
        ...c,
        cardStyle: this.buildCardStyle(c),
      }));
    this.setData({ weekCourses });
  },

  /**
   * 构建课程卡片内联样式（WXML 不能调用函数，只能取 data）
   */
  buildCardStyle(course) {
    const c = course.color || {};
    const bg = c.bg || '#E8E8E8';
    const border = c.border || '#999';
    const text = c.text || '#333';
    const slots = (course.endSlot - course.startSlot + 1) || 1;
    const height = slots * 52; // 每节次 52rpx（含课间比例）
    return `background:${bg};border-left:3px solid ${border};color:${text};height:${height}rpx`;
  },

  /**
   * 切换学期
   */
  onSemesterChange(e) {
    const idx = e.detail.value;
    const option = this.data.semesterOptions[idx];
    const { label } = parseSemesterId(option.id);
    this.setData({
      semester: option.id,
      semesterLabel: label,
      selectedSemesterIndex: idx,
    });
    this.loadCourses(true);
  },

  /**
   * 上一周
   */
  prevWeek() {
    if (this.data.displayWeek > 1) {
      const w = this.data.displayWeek - 1;
      this.setData({ displayWeek: w });
      this.filterWeekCourses();
    }
  },

  /**
   * 下一周
   */
  nextWeek() {
    if (this.data.displayWeek < this.data.totalWeeks) {
      const w = this.data.displayWeek + 1;
      this.setData({ displayWeek: w });
      this.filterWeekCourses();
    }
  },

  /**
   * 回到本周
   */
  goToCurrentWeek() {
    this.setData({ displayWeek: this.data.currentWeek });
    this.filterWeekCourses();
  },

  /**
   * 点击课程卡片 → 详情/编辑
   */
  onCourseTap(e) {
    const course = e.currentTarget.dataset.course;
    wx.navigateTo({
      url: `/pages/schedule/course-editor/course-editor?mode=edit&id=${course._id}`,
    });
  },

  /**
   * 长按课程卡片 → 操作菜单
   */
  onCourseLongPress(e) {
    const course = e.currentTarget.dataset.course;
    wx.showActionSheet({
      itemList: ['编辑课程', '设置提醒', '删除课程'],
      success: (res) => {
        switch (res.tapIndex) {
          case 0:
            wx.navigateTo({
              url: `/pages/schedule/course-editor/course-editor?mode=edit&id=${course._id}`,
            });
            break;
          case 1:
            wx.navigateTo({
              url: `/pages/schedule/course-reminder/course-reminder?courseId=${course._id}&courseName=${course.name}`,
            });
            break;
          case 2:
            this.deleteCourse(course);
            break;
        }
      },
    });
  },

  /**
   * 删除课程
   */
  deleteCourse(course) {
    wx.showModal({
      title: '确认删除',
      content: `确定删除「${course.name}」吗？关联的提醒也会被删除。`,
      success: (res) => {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'remove_course',
            data: { _id: course._id },
          }).then((result) => {
            if (result.result && result.result.success) {
              wx.showToast({ title: '已删除', icon: 'success' });
              this.loadCourses(true);
            } else {
              wx.showToast({ title: '删除失败', icon: 'none' });
            }
          });
        }
      },
    });
  },

  /**
   * 点击添加课程
   */
  onAddCourse() {
    wx.navigateTo({
      url: '/pages/schedule/course-editor/course-editor?mode=add',
    });
  },

  /**
   * 跳转导入页面
   */
  onImportTap() {
    wx.navigateTo({
      url: '/pages/schedule/import/import',
    });
  },

  /**
   * 跳转提醒设置
   */
  onReminderSettingsTap() {
    wx.navigateTo({
      url: '/pages/schedule/reminder-settings/reminder-settings',
    });
  },

  /**
   * 点击学期日期 → 快捷修改
   */
  onAdjustSemester() {
    const that = this;
    wx.showModal({
      title: '修改学期开始日期',
      editable: true,
      placeholderText: '格式：2026-02-24',
      content: that.data.semesterStart,
      success: (res) => {
        if (res.confirm && res.content) {
          const d = res.content.trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
            wx.cloud.callFunction({
              name: 'update_user_settings',
              data: { semesterStart: d },
            }).then(() => {
              const currentWeek = getCurrentWeek(new Date(), d);
              that.setData({
                semesterStart: d,
                currentWeek: Math.min(currentWeek, that.data.totalWeeks),
                displayWeek: Math.min(currentWeek, that.data.totalWeeks),
              });
              that.filterWeekCourses();
              wx.showToast({ title: '已更新为第' + currentWeek + '周', icon: 'success' });
            });
          } else {
            wx.showToast({ title: '日期格式错误', icon: 'none' });
          }
        }
      },
    });
  },

});
