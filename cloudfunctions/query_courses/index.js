// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  const { semester, week } = event;

  // 基础查询条件
  const query = { _openid: openid };
  if (semester) {
    query.semester = semester;
  }

  try {
    // 先获取总数
    const countResult = await db.collection('courses').where(query).count();
    const total = countResult.total;

    // 获取全量数据（单个用户课表数据量不大，全量返回便于前端渲染）
    const MAX_LIMIT = 100;
    const batchTimes = Math.ceil(total / MAX_LIMIT);
    const tasks = [];
    for (let i = 0; i < batchTimes; i++) {
      tasks.push(
        db
          .collection('courses')
          .where(query)
          .orderBy('weekday', 'asc')
          .orderBy('startSlot', 'asc')
          .skip(i * MAX_LIMIT)
          .limit(MAX_LIMIT)
          .get()
      );
    }

    const batches = await Promise.all(tasks);
    const courses = batches.reduce((acc, batch) => acc.concat(batch.data), []);

    // 如果指定了周次，前端可以自行过滤；此处返回全量
    return {
      success: true,
      data: courses,
      total,
      semester: semester || null,
    };
  } catch (err) {
    return {
      success: false,
      errMsg: err.message,
    };
  }
};
