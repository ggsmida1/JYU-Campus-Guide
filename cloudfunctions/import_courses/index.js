// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

/**
 * 课表批量导入
 *
 * 参数：
 *   courses: Array - 课程数组
 *   semester: string - 学期标识
 *   mode: 'replace' | 'append' - 导入模式
 *     replace: 删除同 semester 的旧数据，写入新批次
 *     append: 保留旧数据，追加新批次（默认）
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const { courses, semester, mode } = event;

  if (!courses || !Array.isArray(courses) || courses.length === 0) {
    return { success: false, errMsg: '课程数组不能为空' };
  }

  if (!semester) {
    return { success: false, errMsg: '缺少学期标识 semester' };
  }

  const importId = `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    // 覆盖模式：先删除同一学期、同一用户的旧课程
    if (mode === 'replace') {
      const oldCourses = await db
        .collection('courses')
        .where({
          _openid: openid,
          semester,
        })
        .get();

      // 分批删除（云数据库一次最多删 100 条，实际课表远不到，但做保护）
      for (let i = 0; i < oldCourses.data.length; i += 100) {
        const batch = oldCourses.data.slice(i, i + 100);
        const deleteTasks = batch.map(c => db.collection('courses').doc(c._id).remove());
        await Promise.all(deleteTasks);
      }

      // 同时删除旧提醒
      const oldReminders = await db
        .collection('reminders')
        .where({
          _openid: openid,
          semester,
        })
        .get();

      for (let i = 0; i < oldReminders.data.length; i += 100) {
        const batch = oldReminders.data.slice(i, i + 100);
        const deleteTasks = batch.map(r => db.collection('reminders').doc(r._id).remove());
        await Promise.all(deleteTasks);
      }
    }

    // 批量写入新课程
    const addResults = [];
    for (const course of courses) {
      const courseData = {
        _openid: openid,
        name: course.name || '',
        type: course.type || '',
        teacher: course.teacher || '',
        location: course.location || '',
        campus: course.campus || '',
        weekday: course.weekday,
        startSlot: course.startSlot,
        endSlot: course.endSlot,
        startWeek: course.startWeek || 1,
        endWeek: course.endWeek || 20,
        weekMode: course.weekMode || 'all',
        specificWeeks: course.specificWeeks || [],
        semester,
        teachingClass: course.teachingClass || '',
        classGroup: course.classGroup || '',
        examMethod: course.examMethod || '',
        lectureHours: course.lectureHours || 0,
        labHours: course.labHours || 0,
        weeklyHours: course.weeklyHours || 0,
        totalHours: course.totalHours || 0,
        credits: course.credits || 0,
        color: course.color || null,
        remarks: course.remarks || '',
        importId,
        createTime: db.serverDate(),
        updateTime: db.serverDate(),
      };

      const result = await db.collection('courses').add({ data: courseData });
      addResults.push({ _id: result._id, name: courseData.name });
    }

    return {
      success: true,
      importId,
      mode,
      count: addResults.length,
      results: addResults,
      semester,
    };
  } catch (err) {
    return {
      success: false,
      errMsg: err.message,
    };
  }
};
