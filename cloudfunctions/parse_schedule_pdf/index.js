// 云函数 — 课表 PDF 解析器 v8
// 全局 x 频率统计定位列中心 + 类型特定课程名匹配
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  const { fileID } = event;
  if (!fileID) return { success: false, errMsg: '缺少 fileID' };

  try {
    const res = await cloud.downloadFile({ fileID });
    const pdfBuffer = res.fileContent;
    const PDFParser = require('pdf2json');
    const fs = require('fs');
    const path = require('path');

    const blocks = await new Promise((resolve, reject) => {
      const p = new PDFParser();
      const result = [];
      p.on('pdfParser_dataReady', (data) => {
        for (const pg of data.Pages) {
          if (!pg.Texts) continue;
          for (const t of pg.Texts) {
            try { result.push({ x:t.x, y:t.y, text:decodeURIComponent(t.R[0].T) }); } catch(e) {}
          }
        }
        resolve(result);
      });
      p.on('pdfParser_dataError', reject);
      try { p.parseBuffer(pdfBuffer); } catch(e) {
        const tmp = path.join('/tmp','s_'+Date.now()+'.pdf');
        fs.writeFileSync(tmp, pdfBuffer);
        p.loadPDF(tmp);
      }
    });

    console.log('[pdf] 文本块:', blocks.length);

    const raw = blocks.map(b => b.text).join('');
    let semester = '';
    const sm = raw.match(/(\d{4})-(\d{4})学年[第](\d)学期/);
    if (sm) semester = sm[1] + '-' + sm[2] + '-' + sm[3];
    const isLabeled = /校区[：:]|场地[：:]/.test(raw);

    const typeMarks = '★○●◇◆';
    const typeMap = { '★': '讲课', '○': '实验', '●': '实践', '◇': '上机', '◆': '讨论' };

    // ====== 1. 表头保证列数 + 频率精调列中心 ======
    const headerXs = [...new Set(
      blocks.filter(b => /星期一|星期二|星期三|星期四|星期五|星期六|星期日/.test(b.text)).map(b => Math.round(b.x))
    )].sort((a, b) => a - b);

    const bucketMap = new Map();
    blocks
      .filter(b => b.y > 4 && b.x > 4 && b.text.trim().length > 1 && !/^\d{1,2}$/.test(b.text.trim()) && !/星期/.test(b.text))
      .forEach(b => {
        const key = Math.round(b.x * 2);
        if (!bucketMap.has(key)) bucketMap.set(key, { x: key / 2, c: 0 });
        bucketMap.get(key).c++;
      });

    const avgSpacing = headerXs.length > 1 ? (headerXs[headerXs.length - 1] - headerXs[0]) / (headerXs.length - 1) : 7;

    const colCenters = headerXs.map(hx => {
      let best = hx, bestC = 0;
      bucketMap.forEach(b => {
        if (Math.abs(b.x - hx) <= avgSpacing * 0.6 && b.c > bestC) { bestC = b.c; best = b.x; }
      });
      return best;
    });
    console.log('[pdf] 列中心:', colCenters.map((x, i) => '周' + (i + 1) + '@' + x.toFixed(1)).join(' '));

    // ====== 2. 锚点法提取课程 ======
    const slotPositions = [];
    const slotRe = /\((\d+)-(\d+)节\)/g;
    let m;
    while ((m = slotRe.exec(raw)) !== null) {
      slotPositions.push({ pos: m.index, startSlot: parseInt(m[1], 10), endSlot: parseInt(m[2], 10) });
    }

    const markPositions = [];
    for (let i = 0; i < raw.length; i++) {
      if (typeMarks.includes(raw[i])) markPositions.push(i);
    }

    const rawCourses = [];
    let claimed = 0;

    for (const slot of slotPositions) {
      let bestIdx = -1;
      for (let t = markPositions.length - 1; t >= 0; t--) {
        if (markPositions[t] < slot.pos && t >= claimed && slot.pos - markPositions[t] < 150) {
          bestIdx = t; break;
        }
      }
      if (bestIdx < 0) continue;

      const mp = markPositions[bestIdx]; const typeMark = raw[mp];
      let ns = mp - 1;
      while (ns >= 0) {
        const ch = raw[ns];
        if (typeMarks.includes(ch) || ch === '(' || ch === ')') break;
        if (ch === '/' && mp - ns > 20) break;
        if (/\d/.test(ch) && mp - ns > 1) break;
        ns--;
      }
      ns++;
      let name = raw.substring(ns, mp).trim().replace(/[一二三四五六日]/g, '').trim();
      if (name.length < 2 || /课表|学号|打印时间|时间段|节次|星期|上午|下午|晚上|体育课|艺术课|课内实践|教学质量/.test(name)) continue;
      claimed = bestIdx + 1;

      let fe = slot.pos + 300;
      const nextSlot = slotPositions.find(s => s.pos > slot.pos);
      if (nextSlot) fe = Math.min(fe, nextSlot.pos);
      const ci = raw.indexOf('学分', slot.pos);
      if (ci > 0 && ci < fe) fe = ci + 30;

      const clean = (name + typeMark + raw.substring(slot.pos, Math.min(fe, raw.length))).replace(/\s+/g, '');
      const course = parseFields(clean, name, typeMap[typeMark], slot.startSlot, slot.endSlot, semester, isLabeled);
      if (!course) continue;

      // ====== 3. 格式决定定位策略 → 最近列中心 → weekday ======
      let fb = null;
      if (isLabeled) {
        const nameWithMark = name + typeMark;
        fb = blocks.find(b => b.y > 4 && b.text.includes(nameWithMark));
        if (!fb) {
          const cs = blocks.filter(b => b.y > 4 && b.text.includes(name.substring(0, 4))).sort((a, b) => a.y - b.y);
          fb = cs[0] || null;
        }
      } else {
        const slotStr = '(' + slot.startSlot + '-' + slot.endSlot + '节)';
        if (course.teacher) {
          fb = blocks.find(b => b.y > 4 && b.text.includes(slotStr) && b.text.includes(course.teacher));
        }
        if (!fb && course.location) {
          fb = blocks.find(b => b.y > 4 && b.text.includes(slotStr) && b.text.includes(course.location));
        }
        if (!fb) {
          fb = blocks.find(b => b.y > 4 && b.text.includes(slotStr));
        }
        if (!fb) {
          fb = blocks.find(b => b.y > 4 && b.text.includes(name + typeMark));
        }
      }

      if (fb && colCenters.length > 0) {
        let best = 0, bestD = 999;
        colCenters.forEach((cx, i) => { const d = Math.abs(fb.x - cx); if (d < bestD) { bestD = d; best = i; } });
        course.weekday = best + 1;
      } else {
        course.weekday = 1;
      }

      const dup = rawCourses.find(e =>
        e.name === course.name && e.weekday === course.weekday &&
        e.startSlot === course.startSlot && e.type === course.type &&
        e.startWeek === course.startWeek && e.weekMode === course.weekMode
      );
      if (!dup) rawCourses.push(course);
    }

    console.log('[pdf] 课程数:', rawCourses.length);
    return { success: true, semester, totalCourses: rawCourses.length, courses: rawCourses };
  } catch (err) {
    console.error('[pdf] 异常:', err.message);
    return { success: false, errMsg: err.message };
  }
};

function parseFields(clean, name, type, startSlot, endSlot, semester, isLabeled) {
  let sw = 1, ew = 20, wm = 'all', spec = [];
  if (/周[（(]单[）)]/.test(clean)) { const m = clean.match(/(\d+)-(\d+)周/); if (m) { sw = parseInt(m[1], 10); ew = parseInt(m[2], 10); wm = 'odd'; } }
  else if (/周[（(]双[）)]/.test(clean)) { const m = clean.match(/(\d+)-(\d+)周/); if (m) { sw = parseInt(m[1], 10); ew = parseInt(m[2], 10); wm = 'even'; } }
  else if (/(\d+)周[,，](\d+)周/.test(clean)) { const weeks = clean.match(/(\d+)周/g).map(w => parseInt(w, 10)); spec = weeks; sw = Math.min(...weeks); ew = Math.max(...weeks); wm = 'specific'; }
  else { const m = clean.match(/(\d+)-(\d+)周/); if (m) { sw = parseInt(m[1], 10); ew = parseInt(m[2], 10); } }
  let teacher = '', location = '';
  if (isLabeled) { teacher = ex(clean, '教师'); location = ex(clean, '场地'); }
  else { const aw = clean.replace(/.+?周\//, ''); const parts = aw.split('/'); if (parts.length >= 6) { location = parts[0] || ''; teacher = parts[1] || ''; } }
  if (/^\d/.test(teacher) || teacher === '无' || teacher === '未安排') teacher = '';
  if (location === '未排地点') location = '';
  return { name, type, weekday: 0, startSlot, endSlot, startWeek: sw, endWeek: ew, weekMode: wm, specificWeeks: spec, teacher, location, semester };
}
function ex(t, k) { const m = t.match(new RegExp(k + '[：:]([^/]+)')); return m ? m[1].trim() : ''; }
