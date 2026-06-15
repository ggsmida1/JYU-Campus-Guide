// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const { _id, course_id } = event;
  const targetId = _id || course_id;

  if (!targetId) {
    return { success: false, errMsg: '缺少 _id 或 course_id' };
  }

  try {
    if (_id) {
      // 按提醒 _id 删除
      const existing = await db.collection('reminders').doc(_id).get();
      if (!existing.data || existing.data._openid !== openid) {
        return { success: false, errMsg: '提醒不存在或无权操作' };
      }
      await db.collection('reminders').doc(_id).remove();
    } else {
      // 按 course_id 删除该课程所有提醒
      await db
        .collection('reminders')
        .where({
          _openid: openid,
          course_id,
        })
        .remove();
    }
    return { success: true };
  } catch (err) {
    return { success: false, errMsg: err.message };
  }
};
