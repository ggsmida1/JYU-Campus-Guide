/**
 * 课表 PDF 解析器 v8 — 全局 x 频率峰值定位列中心
 * 基于用户核心想法：列宽一致，跨时段统计频率
 */
const fs = require('fs');
const path = require('path');
const PDFParser = require('pdf2json');

const pdfPath = process.argv[2];
if (!pdfPath) { console.log('用法: node scripts/pdf-to-courses.js <课表PDF>'); process.exit(1); }

new PDFParser().on('pdfParser_dataReady', data => {
  const blocks = [];
  for (const pg of data.Pages) {
    if (!pg.Texts) continue;
    for (const t of pg.Texts) {
      try { blocks.push({ x:t.x, y:t.y, text: decodeURIComponent(t.R[0].T) }); } catch(e) {}
    }
  }

  const raw = blocks.map(b => b.text).join('');
  let semester = '';
  const sm = raw.match(/(\d{4})-(\d{4})学年[第](\d)学期/);
  if (sm) semester = sm[1] + '-' + sm[2] + '-' + sm[3];
  const isLabeled = /校区[：:]|场地[：:]/.test(raw);
  console.log('学期:', semester, '|', isLabeled ? '标签' : '无标签');

  const typeMarks = '★○●◇◆';
  const typeMap = { '★': '讲课', '○': '实验', '●': '实践', '◇': '上机', '◆': '讨论' };

  // ====== 1. 表头保证列数 + 频率精调列中心 ======
  const headerXs = [...new Set(
    blocks.filter(b => /星期一|星期二|星期三|星期四|星期五|星期六|星期日/.test(b.text)).map(b => Math.round(b.x))
  )].sort((a, b) => a - b);

  // 频率桶（精度 0.5）
  const bucketMap = new Map();
  blocks
    .filter(b => b.y > 4 && b.x > 4 && b.text.trim().length > 1 && !/^\d{1,2}$/.test(b.text.trim()) && !/星期/.test(b.text))
    .forEach(b => {
      const key = Math.round(b.x * 2);
      if (!bucketMap.has(key)) bucketMap.set(key, { x: key / 2, c: 0 });
      bucketMap.get(key).c++;
    });

  // 平均列宽
  const avgSpacing = headerXs.length > 1 ? (headerXs[headerXs.length - 1] - headerXs[0]) / (headerXs.length - 1) : 7;

  // 每个表头列 ±0.6倍列宽范围内找频率最高的桶精调位置
  const colCenters = headerXs.map(hx => {
    let best = hx, bestC = 0;
    bucketMap.forEach(b => {
      if (Math.abs(b.x - hx) <= avgSpacing * 0.6 && b.c > bestC) { bestC = b.c; best = b.x; }
    });
    return best;
  });

  console.log(`表头: ${headerXs.join(',')} | 列宽: ${avgSpacing.toFixed(1)}`);
  console.log(`列中心: ${colCenters.map((x,i) => '周'+(i+1)+'@'+x.toFixed(1)).join(' ')}`);

  // ====== 2. 锚点法提取课程 ======
  const slotPositions = [];
  const slotRe = /\((\d+)-(\d+)节\)/g;
  let m;
  while ((m = slotRe.exec(raw)) !== null) {
    slotPositions.push({ pos: m.index, startSlot: parseInt(m[1],10), endSlot: parseInt(m[2],10) });
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

    const mp = markPositions[bestIdx];
    const typeMark = raw[mp];

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
    let foundBlock = null;

    if (isLabeled) {
      // 标签格式：课程名+类型标记块定位准确
      const nameWithMark = name + typeMark;
      foundBlock = blocks.find(b => b.y > 4 && b.text.includes(nameWithMark));
    } else {
      // 无标签格式：字段块在单元格中（节次+教师同时出现唯一确定一门课）
      const slotStr = `(${slot.startSlot}-${slot.endSlot}节)`;
      if (course.teacher) {
        foundBlock = blocks.find(b => b.y > 4 && b.text.includes(slotStr) && b.text.includes(course.teacher));
      }
      if (!foundBlock && course.location) {
        foundBlock = blocks.find(b => b.y > 4 && b.text.includes(slotStr) && b.text.includes(course.location));
      }
      if (!foundBlock) {
        foundBlock = blocks.find(b => b.y > 4 && b.text.includes(slotStr));
      }
      if (!foundBlock) {
        foundBlock = blocks.find(b => b.y > 4 && b.text.includes(name + typeMark));
      }
    }

    const courseX = foundBlock ? foundBlock.x : 0;

    // 找最近的全局列中心
    let bestCol = 0, bestDist = 999;
    colCenters.forEach((cx, i) => {
      const d = Math.abs(courseX - cx);
      if (d < bestDist) { bestDist = d; bestCol = i; }
    });
    course.weekday = bestCol + 1;

    // 去重
    const dup = rawCourses.find(e =>
      e.name === course.name && e.weekday === course.weekday &&
      e.startSlot === course.startSlot && e.type === course.type &&
      e.startWeek === course.startWeek && e.weekMode === course.weekMode
    );
    if (!dup) rawCourses.push(course);
  }

  // 输出
  console.log(`\n=== 结果 (${rawCourses.length}门) ===`);
  rawCourses.forEach((c, i) => {
    const wm = c.weekMode === 'odd' ? '(单)' : c.weekMode === 'even' ? '(双)' :
      c.weekMode === 'specific' ? `(${c.specificWeeks.join(',')}周)` : '';
    console.log(`${i + 1}. [${c.type}] ${c.name.padEnd(24)} 周${c.weekday} ${c.startSlot}-${c.endSlot}节 ${c.startWeek}-${c.endWeek}周${wm} | ${c.location} | ${c.teacher}`);
  });

  fs.writeFileSync(path.join(__dirname, '..', 'courses_output.json'),
    JSON.stringify({ semester, total: rawCourses.length, courses: rawCourses }, null, 2), 'utf-8');
  console.log('\n已保存 courses_output.json');
}).on('pdfParser_dataError', e => console.error(e)).loadPDF(pdfPath);

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
