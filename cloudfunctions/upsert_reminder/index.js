// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

/**
 * 提醒设置 - 新增或更新
 * 一个用户对同一门课程的同一种提醒类型只保留一条记录
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const { course_id, type, advanceMinutes, enabled, semester } = event;

  if (!course_id || !type) {
    return { success: false, errMsg: '缺少必填字段：course_id, type' };
  }

  const reminderData = {
    _openid: openid,
    course_id,
    type,
    advanceMinutes: advanceMinutes || 15,
    enabled: enabled !== undefined ? enabled : true,
    semester: semester || '',
    createTime: db.serverDate(),
    updateTime: db.serverDate(),
  };

  try {
    // 查找是否已存在
    const existing = await db
      .collection('reminders')
      .where({
        _openid: openid,
        course_id,
        type,
      })
      .get();

    if (existing.data.length > 0) {
      // 更新
      await db
        .collection('reminders')
        .doc(existing.data[0]._id)
        .update({
          data: {
            advanceMinutes: reminderData.advanceMinutes,
            enabled: reminderData.enabled,
            semester: reminderData.semester,
            updateTime: db.serverDate(),
          },
        });
      return {
        success: true,
        _id: existing.data[0]._id,
        action: 'updated',
      };
    }

    // 新增
    const result = await db.collection('reminders').add({ data: reminderData });
    return {
      success: true,
      _id: result._id,
      action: 'created',
    };
  } catch (err) {
    return { success: false, errMsg: err.message };
  }
};
