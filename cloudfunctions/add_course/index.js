// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

/**
 * 检查课程时间冲突
 * 同一用户、同一学期、同一天、同一时段有课程重叠即视为冲突
 */
async function checkConflict(openid, course, excludeId) {
  const query = {
    _openid: openid,
    semester: course.semester,
    weekday: course.weekday,
  };

  const existing = await db.collection('courses').where(query).get();

  return existing.data.filter((c) => {
    if (excludeId && c._id === excludeId) return false;
    // 周次范围有交集
    const weekOverlap = !(course.endWeek < c.startWeek || course.startWeek > c.endWeek);
    if (!weekOverlap) return false;
    // 单双周还需要精细判断，此处采用宽松策略：周次范围有重叠即提示
    // 节次范围有交集
    const slotOverlap = !(course.endSlot < c.startSlot || course.startSlot > c.endSlot);
    return slotOverlap;
  });
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const {
    name,
    type,
    teacher,
    location,
    campus,
    weekday,
    startSlot,
    endSlot,
    startWeek,
    endWeek,
    weekMode,
    specificWeeks,
    semester,
    teachingClass,
    classGroup,
    examMethod,
    lectureHours,
    labHours,
    weeklyHours,
    totalHours,
    credits,
    color,
    remarks,
    importId,
  } = event;

  // 必填字段校验
  if (!name || !weekday || !startSlot || !endSlot || !semester) {
    return {
      success: false,
      errMsg: '缺少必填字段：name, weekday, startSlot, endSlot, semester',
    };
  }

  const courseData = {
    _openid: openid,
    name,
    type: type || '',
    teacher: teacher || '',
    location: location || '',
    campus: campus || '',
    weekday,
    startSlot,
    endSlot,
    startWeek: startWeek || 1,
    endWeek: endWeek || 20,
    weekMode: weekMode || 'all',
    specificWeeks: specificWeeks || [],
    semester,
    teachingClass: teachingClass || '',
    classGroup: classGroup || '',
    examMethod: examMethod || '',
    lectureHours: lectureHours || 0,
    labHours: labHours || 0,
    weeklyHours: weeklyHours || 0,
    totalHours: totalHours || 0,
    credits: credits || 0,
    color: color || null,
    remarks: remarks || '',
    importId: importId || '',
    createTime: db.serverDate(),
    updateTime: db.serverDate(),
  };

  // 冲突检测
  const conflicts = await checkConflict(openid, courseData, null);
  if (conflicts.length > 0) {
    return {
      success: false,
      errMsg: '课程时间冲突',
      conflicts: conflicts.map(c => ({
        _id: c._id,
        name: c.name,
        weekday: c.weekday,
        startSlot: c.startSlot,
        endSlot: c.endSlot,
      })),
    };
  }

  try {
    const result = await db.collection('courses').add({ data: courseData });
    return {
      success: true,
      _id: result._id,
      data: courseData,
    };
  } catch (err) {
    return {
      success: false,
      errMsg: err.message,
    };
  }
};
