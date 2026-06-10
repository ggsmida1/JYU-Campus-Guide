// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

/**
 * 定时提醒触发器
 * 由云函数定时触发器每分钟调用一次
 *
 * 流程：
 * 1. 计算当前时间对应的教学周、星期几、当前节次
 * 2. 查询所有启用了提醒的用户设置
 * 3. 对每个用户：查询接下来 advanceMinutes 内要上课的课程
 * 4. 过滤免打扰时段
 * 5. 发送订阅消息
 */

/**
 * 根据当前时间计算节次
 * 常用节次时间表（嘉应学院）：
 *   第1节 08:00-08:40  第2节 08:50-09:30
 *   第3节 09:50-10:30  第4节 10:40-11:20
 *   第5节 14:30-15:10  第6节 15:20-16:00
 *   第7节 16:10-16:50  第8节 17:00-17:40
 *   第9节 19:30-20:10  第10节 20:20-21:00
 */
const PERIOD_TIMES = [
  { slot: 1, start: '08:00', end: '08:40' },
  { slot: 2, start: '08:50', end: '09:30' },
  { slot: 3, start: '09:50', end: '10:30' },
  { slot: 4, start: '10:40', end: '11:20' },
  { slot: 5, start: '14:30', end: '15:10' },
  { slot: 6, start: '15:20', end: '16:00' },
  { slot: 7, start: '16:10', end: '16:50' },
  { slot: 8, start: '17:00', end: '17:40' },
  { slot: 9, start: '19:30', end: '20:10' },
  { slot: 10, start: '20:20', end: '21:00' },
];

/**
 * 获取当前时间在接下来 N 分钟内将开始的节次列表
 * @param {Date} now - 当前时间
 * @param {number} advanceMinutes - 提前分钟数
 * @returns {Array} [{ slot, startTime }]
 */
function getUpcomingSlots(now, advanceMinutes) {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const upcoming = [];

  for (const period of PERIOD_TIMES) {
    const [h, m] = period.start.split(':').map(Number);
    const periodMinutes = h * 60 + m;
    const diff = periodMinutes - currentMinutes;

    // 上课时间在未来 [0, advanceMinutes] 分钟内
    if (diff >= 0 && diff <= advanceMinutes) {
      upcoming.push({ slot: period.slot, startTime: period.start, diffMinutes: diff });
    }
  }

  return upcoming;
}

/**
 * 获取当前星期几（1-7）
 */
function getCurrentWeekday(now) {
  const day = now.getDay();
  return day === 0 ? 7 : day; // 周日=7
}

/**
 * 检查是否在免打扰时段内
 * @param {string} quietStart - '22:00'
 * @param {string} quietEnd - '07:00'
 * @param {Date} now
 * @returns {boolean}
 */
function isInQuietHours(quietStart, quietEnd, now) {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [sh, sm] = (quietStart || '22:00').split(':').map(Number);
  const [eh, em] = (quietEnd || '07:00').split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  // 跨夜免打扰（如 22:00 ~ 07:00）
  if (startMin > endMin) {
    return currentMinutes >= startMin || currentMinutes < endMin;
  }
  // 同日免打扰（如 12:00 ~ 13:30）
  return currentMinutes >= startMin && currentMinutes < endMin;
}

exports.main = async (event, context) => {
  const now = new Date();
  const weekday = getCurrentWeekday(now);

  // 由于定时触发器每分钟执行，需要获取云函数的调用时间
  // event.time 是触发器提供的时间戳
  const triggerTime = event.time ? new Date(event.time) : now;

  console.log(`[schedule_reminder] 触发时间: ${triggerTime.toISOString()}, 星期${weekday}`);

  const sentLogs = [];

  try {
    // 1. 获取所有启用了全局提醒的用户设置
    const MAX_USERS = 500;
    const settingsResult = await db
      .collection('user_settings')
      .where({ reminderEnabled: true })
      .limit(MAX_USERS)
      .get();

    if (settingsResult.data.length === 0) {
      console.log('[schedule_reminder] 无用户启用提醒');
      return { success: true, sent: 0, message: '无用户启用提醒' };
    }

    console.log(`[schedule_reminder] 共 ${settingsResult.data.length} 个用户启用提醒`);

    // 2. 遍历每个用户
    for (const settings of settingsResult.data) {
      try {
        // 免打扰检查
        if (isInQuietHours(settings.quietStart, settings.quietEnd, triggerTime)) {
          continue;
        }

        const defaultAdvance = settings.defaultAdvance || 15;

        // 获取该用户即将开始的节次
        const upcomingSlots = getUpcomingSlots(triggerTime, defaultAdvance);
        if (upcomingSlots.length === 0) continue;

        // 获取用户所有启用的提醒
        const reminders = await db
          .collection('reminders')
          .where({
            _openid: settings._openid,
            enabled: true,
          })
          .get();

        if (reminders.data.length === 0) continue;

        // 获取关联的课程
        const courseIds = [...new Set(reminders.data.map(r => r.course_id))];
        const coursesResult = await db
          .collection('courses')
          .where({
            _openid: settings._openid,
            _id: db.command.in(courseIds),
          })
          .get();

        const activeCourses = coursesResult.data.filter((course) => {
          // 匹配星期几
          if (course.weekday !== weekday) return false;

          // 匹配即将开始的节次
          return upcomingSlots.some(
            (s) => s.slot >= course.startSlot && s.slot <= course.endSlot
          );
        });

        // 3. 对每门即将上课的课程发送提醒
        for (const course of activeCourses) {
          const courseReminders = reminders.data.filter(
            (r) => r.course_id === course._id
          );

          for (const reminder of courseReminders) {
            // 检查该提醒的提前时间与即将上课时间是否匹配
            const matchedSlot = upcomingSlots.find(
              (s) => s.slot >= course.startSlot && s.slot <= course.endSlot
            );
            if (!matchedSlot) continue;

            // 发送订阅消息
            try {
              await cloud.openapi.subscribeMessage.send({
                touser: settings._openid,
                templateId: event.templateId || 'sPZvU2Gkqcb_8tzu-n9R5QyGp0HTF0Z9GX1-Zydpd8g', // 需在微信公众平台申请
                data: {
                  thing1: { value: course.name.slice(0, 20) }, // 课程名称
                  time2: { value: `${matchedSlot.startTime}` }, // 上课时间
                  thing3: { value: course.location || '待定' }, // 上课地点
                  thing4: { value: course.teacher || '待定' }, // 授课教师
                },
                page: 'pages/schedule/schedule',
              });

              // 记录发送日志
              await db.collection('subscription_logs').add({
                data: {
                  _openid: settings._openid,
                  course_id: course._id,
                  template_id: event.templateId || 'sPZvU2Gkqcb_8tzu-n9R5QyGp0HTF0Z9GX1-Zydpd8g',
                  sent: true,
                  sentTime: db.serverDate(),
                },
              });

              sentLogs.push({
                openid: settings._openid.slice(0, 8) + '...',
                course: course.name,
                slot: matchedSlot.slot,
              });
            } catch (sendErr) {
              // 订阅消息发送失败（用户未授权、模板不存在等）
              console.log(`[schedule_reminder] 发送失败: ${sendErr.message}`);

              await db.collection('subscription_logs').add({
                data: {
                  _openid: settings._openid,
                  course_id: course._id,
                  template_id: event.templateId || 'sPZvU2Gkqcb_8tzu-n9R5QyGp0HTF0Z9GX1-Zydpd8g',
                  sent: false,
                  error: sendErr.message,
                  sentTime: db.serverDate(),
                },
              });
            }
          }
        }
      } catch (userErr) {
        console.log(`[schedule_reminder] 用户处理异常: ${userErr.message}`);
        // 单个用户失败不影响其他用户
      }
    }

    console.log(`[schedule_reminder] 完成，发送 ${sentLogs.length} 条提醒`);
    return {
      success: true,
      sent: sentLogs.length,
      logs: sentLogs.slice(0, 20), // 只返回前 20 条日志
      time: triggerTime.toISOString(),
    };
  } catch (err) {
    console.error(`[schedule_reminder] 异常: ${err.message}`);
    return { success: false, errMsg: err.message };
  }
};
