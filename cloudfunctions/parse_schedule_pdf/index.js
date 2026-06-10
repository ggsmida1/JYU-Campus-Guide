// 云函数 — 课表 PDF 解析器
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  const { fileID } = event;
  if (!fileID) return { success: false, errMsg: '缺少 fileID' };

  try {
    const res = await cloud.downloadFile({ fileID });
    const pdfBuffer = res.fileContent;
    const PDFParser = require('pdf2json');
    const fs = require('fs'); const path = require('path');

    const data = await new Promise((resolve, reject) => {
      const p = new PDFParser();
      p.on('pdfParser_dataReady', resolve);
      p.on('pdfParser_dataError', reject);
      try { p.parseBuffer(pdfBuffer); } catch(e) {
        const tmp = path.join('/tmp','s_'+Date.now()+'.pdf');
        fs.writeFileSync(tmp, pdfBuffer); p.loadPDF(tmp);
      }
    });

    const blocks = [];
    for (const pg of data.Pages) {
      if (!pg.Texts) continue;
      for (const t of pg.Texts) {
        try { blocks.push({ x:t.x, y:t.y, text:decodeURIComponent(t.R[0].T) }); } catch(e) {}
      }
    }

    // 列边界
    const allVX = [];
    for (const pg of data.Pages) {
      if (pg.VLines) pg.VLines.forEach(l => { if (l.l > 1.5) allVX.push(l.x); });
    }
    allVX.sort((a,b) => a - b);
    const colBounds = []; allVX.forEach(x => { if (colBounds.length === 0 || x - colBounds[colBounds.length-1] > 1.0) colBounds.push(x); });

    const dayNames = ['星期一','星期二','星期三','星期四','星期五','星期六','星期日'];
    const headerColMap = {};
    blocks.filter(b => dayNames.some(d => b.text.includes(d))).forEach(b => {
      const idx = dayNames.findIndex(d => b.text.includes(d));
      if (idx >= 0) {
        for (let c = 0; c < colBounds.length - 1; c++) {
          if (b.x >= colBounds[c]-0.5 && b.x < colBounds[c+1]+0.5) { headerColMap[idx+1] = c; break; }
        }
      }
    });
    const colToWeekday = {}; for (const [w,c] of Object.entries(headerColMap)) colToWeekday[c] = parseInt(w);

    // 每列聚合文本
    const colTexts = {};
    for (const b of blocks) {
      if (b.y < 3.8 || b.x < 1 || b.text.trim().length < 1) continue;
      if (/星期|节次|时间段|上午|下午|晚上/.test(b.text)) continue;
      if (/^\d{1,2}$/.test(b.text.trim())) continue;
      let col = -1;
      for (let c = 0; c < colBounds.length - 1; c++) {
        if (b.x >= colBounds[c] && b.x < colBounds[c+1]) { col = c; break; }
      }
      if (col < 2) continue;
      if (!colTexts[col]) colTexts[col] = '';
      colTexts[col] += b.text;
    }

    const raw = blocks.map(b => b.text).join('');
    const isLabeled = /校区[：:]|场地[：:]/.test(raw);
    let semester = ''; const sm = raw.match(/(\d{4})-(\d{4})学年[第](\d)学期/);
    if (sm) semester = sm[1] + '-' + sm[2] + '-' + sm[3];

    const typeMap = { '★': '讲课', '○': '实验', '●': '实践', '◇': '上机', '◆': '讨论' };
    const courses = [];

    for (const [colStr, fullText] of Object.entries(colTexts)) {
      const col = parseInt(colStr, 10);
      const wd = colToWeekday[col];
      if (!wd) continue;

      const clean = fullText.replace(/\s+/g, '');
      const starts = [];

      // 有类型标记
      const bRe = /([^★○●◇◆\/:]+)([★○●◇◆])\((\d+)-(\d+)节\)/g;
      let m;
      while ((m = bRe.exec(clean)) !== null) {
        let cname = m[1].trim().replace(/^[\d.]+/, '').trim();
        if (cname.length < 2) continue;
        starts.push({ pos: m.index, name: cname, mk: m[2], startSlot: parseInt(m[3],10), endSlot: parseInt(m[4],10) });
      }

      // 无类型标记（体育课等）
      const uRe = /([^\(★○●◇◆\/]{2,35})\((\d+)-(\d+)节\)/g;
      while ((m = uRe.exec(clean)) !== null) {
        let cname = m[1].trim().replace(/^[\d.]+/, '').trim();
        if (starts.some(s => Math.abs(s.pos - m.index) < 10) || cname.length < 2) continue;
        if (/学分|学时|安排|备注|组成|方式/.test(cname)) continue;
        starts.push({ pos: m.index, name: cname, mk: '', startSlot: parseInt(m[2],10), endSlot: parseInt(m[3],10) });
      }

      starts.sort((a,b) => a.pos - b.pos);

      for (let i = 0; i < starts.length; i++) {
        const s = starts[i];
        const end = i + 1 < starts.length ? starts[i + 1].pos : clean.length;
        const cellText = clean.substring(s.pos, end);
        const course = parseCourse(cellText, s.name, typeMap[s.mk]||'', s.startSlot, s.endSlot, wd, semester, isLabeled);
        if (!course) continue;
        const dup = courses.find(c => c.name === course.name && c.weekday === course.weekday && c.startSlot === course.startSlot && c.type === course.type && c.startWeek === course.startWeek);
        if (!dup) courses.push(course);
      }
    }

    console.log('[pdf] 课程数:', courses.length);
    return { success: true, semester, totalCourses: courses.length, courses };
  } catch (err) {
    console.error('[pdf] 异常:', err.message);
    return { success: false, errMsg: err.message };
  }
};

function parseCourse(clean, name, type, startSlot, endSlot, weekday, semester, isLabeled) {
  if (!name || clean.length < 10) return null;
  let sw = 1, ew = 20, wm = 'all', spec = [];
  if (/周[（(]单[）)]/.test(clean)) { const m = clean.match(/(\d+)-(\d+)周/); if (m) { sw = parseInt(m[1],10); ew = parseInt(m[2],10); wm = 'odd'; } }
  else if (/周[（(]双[）)]/.test(clean)) { const m = clean.match(/(\d+)-(\d+)周/); if (m) { sw = parseInt(m[1],10); ew = parseInt(m[2],10); wm = 'even'; } }
  else if (/(\d+)周[,，](\d+)周/.test(clean)) { const weeks = clean.match(/(\d+)周/g).map(w=>parseInt(w,10)); spec=weeks; sw=Math.min(...weeks); ew=Math.max(...weeks); wm='specific'; }
  else { const m = clean.match(/(\d+)-(\d+)周/); if (m) { sw = parseInt(m[1],10); ew = parseInt(m[2],10); } }
  let teacher = '', location = '';
  if (isLabeled) { teacher = ex(clean, '教师'); location = ex(clean, '场地'); }
  else { const aw = clean.replace(/.+?周\//, ''); const parts = aw.split('/'); if (parts.length >= 6) { location = parts[0]||''; teacher = parts[1]||''; } }
  if (/^\d/.test(teacher) || teacher === '无' || teacher === '未安排') teacher = '';
  if (location === '未排地点') location = '';
  return { name, type, weekday, startSlot, endSlot, startWeek:sw, endWeek:ew, weekMode:wm, specificWeeks:spec, teacher, location, semester };
}
function ex(t, k) { const m = t.match(new RegExp(k + '[：:]([^/]+)')); return m ? m[1].trim() : ''; }
