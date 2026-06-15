// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    const result = await db
      .collection('user_settings')
      .where({ _openid: openid })
      .get();

    if (result.data.length > 0) {
      return { success: true, data: result.data[0], exists: true };
    }

    // 不存在则返回默认设置
    return {
      success: true,
      data: {
        _openid: openid,
        reminderEnabled: true,
        defaultAdvance: 15,
        quietStart: '22:00',
        quietEnd: '07:00',
        vibrate: true,
      },
      exists: false,
    };
  } catch (err) {
    return { success: false, errMsg: err.message };
  }
};
