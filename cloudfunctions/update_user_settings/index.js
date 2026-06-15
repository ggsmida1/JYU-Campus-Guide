// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const {
    reminderEnabled,
    defaultAdvance,
    quietStart,
    quietEnd,
    semesterStart,
    totalWeeks,
    vibrate,
  } = event;

  const updateData = {};
  if (reminderEnabled !== undefined) updateData.reminderEnabled = reminderEnabled;
  if (defaultAdvance !== undefined) updateData.defaultAdvance = defaultAdvance;
  if (quietStart !== undefined) updateData.quietStart = quietStart;
  if (quietEnd !== undefined) updateData.quietEnd = quietEnd;
  if (semesterStart !== undefined) updateData.semesterStart = semesterStart;
  if (totalWeeks !== undefined) updateData.totalWeeks = totalWeeks;
  if (vibrate !== undefined) updateData.vibrate = vibrate;
  updateData.updateTime = db.serverDate();

  if (Object.keys(updateData).length <= 1) {
    return { success: false, errMsg: '没有需要更新的字段' };
  }

  try {
    const existing = await db
      .collection('user_settings')
      .where({ _openid: openid })
      .get();

    if (existing.data.length > 0) {
      await db
        .collection('user_settings')
        .doc(existing.data[0]._id)
        .update({ data: updateData });
    } else {
      updateData._openid = openid;
      updateData.createTime = db.serverDate();
      await db.collection('user_settings').add({ data: updateData });
    }

    return { success: true };
  } catch (err) {
    return { success: false, errMsg: err.message };
  }
};
