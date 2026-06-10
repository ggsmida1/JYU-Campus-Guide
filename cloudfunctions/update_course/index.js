// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

/**
 * 检查课程时间冲突（排除自身）
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
    const weekOverlap = !(course.endWeek < c.startWeek || course.startWeek > c.endWeek);
    if (!weekOverlap) return false;
    const slotOverlap = !(course.endSlot < c.startSlot || course.startSlot > c.endSlot);
    return slotOverlap;
  });
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const { _id } = event;
  if (!_id) {
    return { success: false, errMsg: '缺少课程 _id' };
  }

  // 先验证该课程属于当前用户
  const existing = await db.collection('courses').doc(_id).get();
  if (!existing.data || existing.data._openid !== openid) {
    return { success: false, errMsg: '课程不存在或无权操作' };
  }

  const updateData = {};
  const fields = [
    'name', 'type', 'teacher', 'location', 'campus',
    'weekday', 'startSlot', 'endSlot', 'startWeek', 'endWeek',
    'weekMode', 'specificWeeks', 'semester',
    'teachingClass', 'classGroup', 'examMethod',
    'lectureHours', 'labHours', 'weeklyHours', 'totalHours', 'credits',
    'color', 'remarks', 'importId',
  ];

  fields.forEach((key) => {
    if (event[key] !== undefined) {
      updateData[key] = event[key];
    }
  });

  updateData.updateTime = db.serverDate();

  // 合并后检查冲突
  const merged = { ...existing.data, ...updateData };
  const conflicts = await checkConflict(openid, merged, _id);
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
    await db.collection('courses').doc(_id).update({ data: updateData });
    return { success: true };
  } catch (err) {
    return { success: false, errMsg: err.message };
  }
};
