// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const { _id } = event;
  if (!_id) {
    return { success: false, errMsg: '缺少课程 _id' };
  }

  // 验证该课程属于当前用户
  try {
    const existing = await db.collection('courses').doc(_id).get();
    if (!existing.data || existing.data._openid !== openid) {
      return { success: false, errMsg: '课程不存在或无权操作' };
    }

    // 删除课程
    await db.collection('courses').doc(_id).remove();

    // 级联删除关联的提醒
    await db
      .collection('reminders')
      .where({
        _openid: openid,
        course_id: _id,
      })
      .remove();

    return { success: true };
  } catch (err) {
    return { success: false, errMsg: err.message };
  }
};
