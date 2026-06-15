// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const { course_id, semester } = event;

  const query = { _openid: openid };
  if (course_id) query.course_id = course_id;
  if (semester) query.semester = semester;

  try {
    const result = await db.collection('reminders').where(query).get();
    return {
      success: true,
      data: result.data,
      total: result.data.length,
    };
  } catch (err) {
    return { success: false, errMsg: err.message };
  }
};
