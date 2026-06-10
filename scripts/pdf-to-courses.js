/**
 * 课表 PDF 解析器 - 基于表格线网格 + 课程边界正则分割
 */
const fs = require('fs'); const path = require('path'); const PDFParser = require('pdf2json');
const pdfPath = process.argv[2];
if (!pdfPath) { console.log('用法: node scripts/pdf-to-courses.js <课表PDF>'); process.exit(1); }

new PDFParser().on('pdfParser_dataReady', data => {
  const blocks = [];
  for (const pg of data.Pages) {
    if (!pg.Texts) continue;
    for (const t of pg.Texts) { try { blocks.push({ x:t.x, y:t.y, text: decodeURIComponent(t.R[0].T) }); } catch(e) {} }
  }

  // ==== 1. 行/列边界 ====
  const hLineYCounts = {};
  for (const pg of data.Pages) {
    if (pg.HLines) pg.HLines.forEach(l => { const yk = l.y.toFixed(1); hLineYCounts[yk] = (hLineYCounts[yk] || 0) + 1; });
  }
  const rowBounds = Object.entries(hLineYCounts).filter(([,c]) => c >= 4).map(([y]) => parseFloat(y)).sort((a,b) => a - b);

  const allVX = [];
  for (const pg of data.Pages) {
    if (pg.VLines) pg.VLines.forEach(l => { if (l.l > 1.5) allVX.push(l.x); });
  }
  allVX.sort((a,b) => a - b);
  const colBounds = []; allVX.forEach(x => { if (colBounds.length === 0 || x - colBounds[colBounds.length-1] > 1.0) colBounds.push(x); });

  // 表头→星期几
  const headerColMap = {};
  const dayNames = ['星期一','星期二','星期三','星期四','星期五','星期六','星期日'];
  blocks.filter(b => dayNames.some(d => b.text.includes(d))).forEach(b => {
    const idx = dayNames.findIndex(d => b.text.includes(d));
    if (idx >= 0) { for (let c = 0; c < colBounds.length - 1; c++) { if (b.x >= colBounds[c]-0.5 && b.x < colBounds[c+1]+0.5) { headerColMap[idx+1] = c; break; } } }
  });
  const colToWeekday = {}; for (const [w, c] of Object.entries(headerColMap)) colToWeekday[c] = parseInt(w);
  console.log('列映射:', JSON.stringify(headerColMap));

  const raw = blocks.map(b => b.text).join('');
  const isLabeled = /校区[：:]|场地[：:]/.test(raw);
  let semester = ''; const sm = raw.match(/(\d{4})-(\d{4})学年[第](\d)学期/);
  if (sm) semester = sm[1] + '-' + sm[2] + '-' + sm[3];
  console.log('学期:', semester, '|', isLabeled ? '标签' : '无标签');

  // ==== 2. 文本块按列-行分配到网格，每列聚合全部文本 ====
  const colTexts = {}; // {colIdx: fullText}

  for (const b of blocks) {
    if (b.y < 3.8 || b.x < 1 || b.text.trim().length < 1) continue;
    if (/星期|节次|时间段|上午|下午|晚上/.test(b.text)) continue;
    if (/^\d{1,2}$/.test(b.text.trim())) continue;

    let col = -1;
    for (let c = 0; c < colBounds.length - 1; c++) {
      if (b.x >= colBounds[c] && b.x < colBounds[c + 1]) { col = c; break; }
    }
    if (col < 2) continue; // 跳过时间段和节次列

    if (!colTexts[col]) colTexts[col] = '';
    colTexts[col] += b.text;
  }

  // ==== 3. 每列内按课程边界正则分割 ====
  const typeMap = { '★': '讲课', '○': '实验', '●': '实践', '◇': '上机', '◆': '讨论' };
  const courses = [];

  for (const [colStr, fullText] of Object.entries(colTexts)) {
    const col = parseInt(colStr, 10);
    const weekday = colToWeekday[col];
    if (!weekday) continue;

    const clean = fullText.replace(/\s+/g, '');

    // 找所有课程起始边界
    const starts = [];

    // 第一轮：有类型标记的课程 (课程名★/○/●/◇/◆)
    const bRe = /([^★○●◇◆\/:]+)([★○●◇◆])\((\d+)-(\d+)节\)/g;
    let m;
    while ((m = bRe.exec(clean)) !== null) {
      let cname = m[1].trim().replace(/^[\d.]+/, '').trim();
      if (cname.length < 2) continue;
      starts.push({ pos: m.index, name: cname, mk: m[2], startSlot: parseInt(m[3],10), endSlot: parseInt(m[4],10) });
    }

    // 第二轮：无类型标记的课程（如体育-排舞 2）
    const uRe = /([^\(★○●◇◆\/]{2,35})\((\d+)-(\d+)节\)/g;
    while ((m = uRe.exec(clean)) !== null) {
      let cname = m[1].trim().replace(/^[\d.]+/, '').trim();
      const alreadyCovered = starts.some(s => Math.abs(s.pos - m.index) < 10);
      if (alreadyCovered || cname.length < 2) continue;
      if (/学分|学时|安排|备注|组成|方式/.test(cname)) continue;
      starts.push({ pos: m.index, name: cname, mk: '', startSlot: parseInt(m[2],10), endSlot: parseInt(m[3],10) });
    }

    // 按位置排序
    starts.sort((a, b) => a.pos - b.pos);

    if (starts.length === 0) continue;

    // 切分：从每个start到下一个start（或末尾）
    for (let i = 0; i < starts.length; i++) {
      const s = starts[i];
      const end = i + 1 < starts.length ? starts[i + 1].pos : clean.length;
      const cellText = clean.substring(s.pos, end);

      const course = parseCourse(cellText, s.name, typeMap[s.mk] || '', s.startSlot, s.endSlot, weekday, semester, isLabeled);
      if (!course) continue;

      const dup = courses.find(c =>
        c.name === course.name && c.weekday === course.weekday &&
        c.startSlot === course.startSlot && c.type === course.type &&
        c.startWeek === course.startWeek
      );
      if (!dup) courses.push(course);
    }
  }

  console.log('\n=== ' + courses.length + '门 ===');
  courses.forEach((c, i) => {
    const wm = c.weekMode === 'odd' ? '(单)' : c.weekMode === 'even' ? '(双)' :
      c.weekMode === 'specific' ? '(' + c.specificWeeks.join(',') + '周)' : '';
    console.log((i + 1) + '. [' + c.type + '] ' + c.name.padEnd(24) +
      ' 周' + c.weekday + ' ' + c.startSlot + '-' + c.endSlot + '节 ' +
      c.startWeek + '-' + c.endWeek + '周' + wm + ' | ' + (c.location||'') + ' | ' + (c.teacher||''));
  });
  fs.writeFileSync(path.join(__dirname, '..', 'courses_output.json'),
    JSON.stringify({ semester, total: courses.length, courses }, null, 2), 'utf-8');
}).on('pdfParser_dataError', e => console.error(e)).loadPDF(pdfPath);

// ============================================================
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
