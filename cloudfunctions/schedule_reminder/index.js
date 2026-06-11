// 云函数 — 定时提醒触发器
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const PERIOD_TIMES = [
  { slot:1, start:'08:00' },{ slot:2, start:'08:55' },{ slot:3, start:'10:00' },
  { slot:4, start:'10:55' },{ slot:5, start:'14:30' },{ slot:6, start:'15:25' },
  { slot:7, start:'16:20' },{ slot:8, start:'17:15' },{ slot:9, start:'19:30' },{ slot:10, start:'20:25' },
  { slot:11, start:'21:15' },
];

function getUpcoming(now, maxAdv) {
  const cur = now.getHours()*60+now.getMinutes();
  return PERIOD_TIMES.map(p => {
    const [h,m] = p.start.split(':').map(Number);
    let diff = h*60+m - cur;
    if (diff < 0) diff += 24*60; // 跨天：考虑明天
    return { ...p, diff };
  }).filter(p => p.diff <= maxAdv);
}

function getWeekday(now) { const d = now.getDay(); return d===0?7:d; }
function isQuiet(qs,qe,now) {
  if (!qs && !qe) return false;
  const cur = now.getHours()*60+now.getMinutes();
  const [sh,sm]=(qs||'22:00').split(':').map(Number);
  const [eh,em]=(qe||'07:00').split(':').map(Number);
  const s=sh*60+sm, e=eh*60+em;
  return s>e ? (cur>=s||cur<e) : (cur>=s&&cur<e);
}

const TMPL_ID = 'sPZvU2Gkqcb_8tzu-n9R5QyGp0HTF0Z9GX1-Zydpd8g';

exports.main = async (event, context) => {
  const force = event && event.force;
  const utc = new Date();
  const now = new Date(utc.getTime() + 8 * 3600000);
  const wd = getWeekday(now);
  console.log('[reminder]', force?'TEST':'','周'+wd, now.toTimeString().slice(0,5));

  try {
    let settingsList = [];
    const sr = await db.collection('user_settings').where({ reminderEnabled: true }).limit(500).get();
    if (sr.data.length > 0) {
      settingsList = sr.data;
    } else {
      const rr = await db.collection('reminders').where({ enabled: true }).limit(500).get();
      if (!rr.data.length) return { success: true, sent: 0, msg: '无提醒数据' };
      const seen = new Set();
      rr.data.forEach(r => { if (!seen.has(r._openid)) { seen.add(r._openid); settingsList.push({ _openid: r._openid, reminderEnabled: true, defaultAdvance: 15, quietStart: null, quietEnd: null }); } });
    }

    let sent = 0, diag = [];
    for (const settings of settingsList) {
      try {
        if (isQuiet(settings.quietStart, settings.quietEnd, now)) continue;
        const reminders = await db.collection('reminders').where({ _openid: settings._openid, enabled: true }).get();

        let courseList = [];
        if (reminders.data.length > 0) {
          // 有单独提醒：获取关联课程
          const cids = [...new Set(reminders.data.map(r => r.course_id))];
          const cr = await db.collection('courses').where({ _openid: settings._openid, _id: db.command.in(cids) }).get();
          courseList = force ? cr.data : cr.data.filter(c => c.weekday === wd);
        } else {
          // 无单独提醒但有全局设置：今天所有课都提醒
          const cr = force
            ? await db.collection('courses').where({ _openid: settings._openid }).get()
            : await db.collection('courses').where({ _openid: settings._openid, weekday: wd }).get();
          courseList = cr.data;
          // 为每门课构造虚拟提醒
          courseList.forEach(c => {
            reminders.data.push({ _id: 'v_' + c._id, course_id: c._id, advanceMinutes: settings.defaultAdvance || 15, enabled: true });
          });
        }
        if (!courseList.length) { diag.push('today_no_courses'); continue; }

        const maxAdv = force ? 1440 : Math.max(60, ...reminders.data.map(r => r.advanceMinutes || 15));
        diag.push('courses:' + courseList.length + ' advMax:' + maxAdv);
        const upcoming = getUpcoming(now, maxAdv);
        if (!upcoming.length) continue;

        for (const reminder of reminders.data) {
          const course = courseList.find(c => c._id === reminder.course_id);
          if (!course) continue;
          const adv = reminder.advanceMinutes || settings.defaultAdvance || 15;
          const matched = force
            ? upcoming.find(s => s.slot >= +course.startSlot && s.slot <= +course.endSlot)
            : upcoming.find(s => s.slot >= +course.startSlot && s.slot <= +course.endSlot && s.diff <= adv);
          if (!matched) continue;

          try {
            // 楼名映射（课表缩写→数据库名称）
            const BUILDING_MAP = {
              '锡科':'锡昌科技大楼', '田师':'田家炳师范大楼', '活活艺术大楼':'活活艺术中心',
              '活活':'活活艺术中心', '公':'公楼', '公B':'公楼', '公C':'公楼',
              '李小平教育大楼':'李小平教育大楼', '百年纪念大楼':'百年纪念大楼',
              '宪梓':'宪梓楼', '健美操':'健美操房',
            };
            const loc = course.location || '';
            const raw = loc.replace(/[\dA-Z\-]+/g, '').trim();
            // 先查映射表，没命中则用原始楼名
            let building = BUILDING_MAP[raw] || raw;
            // 前缀模糊匹配（如"活活艺术大楼A102"→"活活艺术中心"）
            if (building === raw) {
              for (const [k, v] of Object.entries(BUILDING_MAP)) {
                if (v && (raw.includes(k) || k.includes(raw))) { building = v; break; }
              }
            }
            const sendParams = {
              touser: settings._openid, templateId: TMPL_ID, lang: 'zh_CN',
              miniprogramState: 'developer',
              data: {
                thing8: { value: (course.name || '课程').slice(0, 20) },
                time15: { value: matched.start || '00:00' },
                thing4: { value: loc.slice(0, 20) },
                thing14: { value: (course.teacher || '').slice(0, 20) },
                thing5: { value: building ? '点击查看教室位置' : '按时上课' },
              },
            };
            // 仅有效地点才附加导航跳转
            if (building && loc !== '未排地点') {
              sendParams.page = 'pages/map/search/search?keyword=' + encodeURIComponent(building);
            }
            await cloud.openapi.subscribeMessage.send(sendParams);
            sent++;
          } catch(e) {
            console.log('[reminder] send err:', e.errCode, e.message.slice(0,60));
          }
        }
      } catch(ue) { console.log('[reminder] user err:', ue.message); }
    }
    console.log('[reminder] sent:', sent);
    return { success: true, sent, diag: diag.join(';') };
  } catch(err) {
    console.error('[reminder] crash:', err.message);
    return { success: false, errMsg: err.message };
  }
};
