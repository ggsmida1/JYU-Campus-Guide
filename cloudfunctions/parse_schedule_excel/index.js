// 云函数 — 解析课表 Excel / CSV
const cloud = require('wx-server-sdk');
const XLSX = require('xlsx');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// ============================================================
// 字段名映射表 — 将教务系统的中文表头映射到我们的字段
// ============================================================
const FIELD_MAP = {
  name: ['课程名称', '课程', '名称', '课程名', '课名'],
  type: ['课程类型', '类型', '修读类型'],
  teacher: ['教师', '授课教师', '老师', '任课教师', '主讲教师'],
  location: ['上课地点', '教室', '地点', '场地', '上课教室'],
  campus: ['校区', '所在校区'],
  weekday: ['星期', '星期几', '周几', '上课星期', 'day'],
  startSlot: ['起始节', '开始节次', '起始节次', '开始节', 'start'],
  endSlot: ['结束节', '结束节次', '终止节次', '结束节', 'end'],
  startWeek: ['起始周', '开始周', '开始周次'],
  endWeek: ['结束周', '终止周', '结束周次'],
  weekMode: ['单双周', '周类型', '周次类型'],
  teachingClass: ['教学班', '教学班级'],
  classGroup: ['教学班组成', '班级组成', '班级'],
  examMethod: ['考核方式', '考试方式'],
  lectureHours: ['讲课学时', '理论学时'],
  labHours: ['实验学时', '上机学时'],
  weeklyHours: ['周学时'],
  totalHours: ['总学时', '总课时'],
  credits: ['学分', '学分绩点'],
  remarks: ['备注', '选课备注', '说明'],
};

// 星期文本映射
const WEEKDAY_MAP = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6, 'sun': 7 };

// ============================================================
// 主入口
// ============================================================
exports.main = async (event, context) => {
  const { fileID } = event;
  if (!fileID) return { success: false, errMsg: '缺少 fileID' };

  try {
    // 1. 下载文件
    console.log('[parse_excel] 下载:', fileID);
    const res = await cloud.downloadFile({ fileID });
    const buf = res.fileContent;

    // 2. 解析工作簿
    const wb = XLSX.read(buf, { type: 'buffer' });
    console.log('[parse_excel] 工作表:', wb.SheetNames);

    // 3. 取第一个工作表
    const wsname = wb.SheetNames[0];
    const ws = wb.Sheets[wsname];

    // 转二维数组
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    console.log('[parse_excel] 行数:', rows.length);

    if (rows.length < 2) {
      return { success: false, errMsg: 'Excel 内容为空或格式不正确' };
    }

    // 4. 判断格式：列表格式 or 网格格式
    const format = detectFormat(rows);
    console.log('[parse_excel] 格式:', format);

    // 5. 解析
    let courses;
    if (format === 'grid') {
      courses = parseGridFormat(rows);
    } else {
      courses = parseListFormat(rows);
    }

    // 6. 提取学期信息
    const semester = extractSemester(rows);

    console.log('[parse_excel] 解析到', courses.length, '门课程');

    return {
      success: true,
      semester,
      totalCourses: courses.length,
      courses,
      format,
    };
  } catch (err) {
    console.error('[parse_excel] 异常:', err.message);
    return { success: false, errMsg: err.message };
  }
};

// ============================================================
// 格式检测
// ============================================================
function detectFormat(rows) {
  if (rows.length === 0) return 'list';
  const header = rows[0].map(c => String(c).trim());

  // 网格格式特征：表头包含星期几
  const dayNames = ['星期一', '周二', '星期', '周一'];
  const hasWeekdays = header.some(h => dayNames.some(d => h.includes(d)));

  // 网格格式特征：第一列是"节次"或数字1-12
  const firstCol = header[0];
  const hasPeriods = /节次|时间|[1-9]/.test(firstCol);

  if (hasWeekdays || (hasPeriods && header.length >= 5)) {
    return 'grid';
  }
  return 'list';
}

// ============================================================
// 列表格式解析（每行 = 一门课，列头 → 字段映射）
// ============================================================
function parseListFormat(rows) {
  // 找到表头行
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const r = rows[i].map(c => String(c).trim());
    if (r.some(c => /课程|教师|星期|教室|学分/.test(c))) {
      headerRowIdx = i;
      break;
    }
  }

  const headers = rows[headerRowIdx].map(c => String(c).trim());
  const colMap = buildColumnMap(headers);
  console.log('[parse_excel] 列映射:', JSON.stringify(colMap));

  const courses = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (isEmptyRow(row)) continue;

    const course = {};
    for (const [field, colIdx] of Object.entries(colMap)) {
      const val = String(row[colIdx] || '').trim();
      if (!val) continue;
      course[field] = parseFieldValue(field, val);
    }

    if (!course.name) continue; // 课程名是必填的

    // 设置默认值
    course.weekday = course.weekday || 1;
    course.startSlot = course.startSlot || 1;
    course.endSlot = course.endSlot || course.startSlot || 2;
    course.startWeek = course.startWeek || 1;
    course.endWeek = course.endWeek || 20;
    course.weekMode = course.weekMode || 'all';
    course.specificWeeks = course.specificWeeks || [];
    course.semester = '';
    course.type = mapCourseType(course.type);
    course.campus = course.campus || '';
    course.teacher = course.teacher || '';
    course.location = course.location || '';

    courses.push(course);
  }

  return courses;
}

/**
 * 建立 列索引 → 字段名 的映射
 */
function buildColumnMap(headers) {
  const map = {};
  headers.forEach((h, idx) => {
    const clean = h.replace(/[\s*#]/g, '');
    for (const [field, names] of Object.entries(FIELD_MAP)) {
      if (names.some(n => clean.includes(n))) {
        if (!(field in map)) map[field] = idx;
        return;
      }
    }
  });
  return map;
}

/**
 * 按字段类型解析值
 */
function parseFieldValue(field, val) {
  switch (field) {
    case 'weekday': return parseWeekday(val);
    case 'startSlot': case 'endSlot': return parseSlot(val);
    case 'startWeek': case 'endWeek': return parseInt(val, 10) || 0;
    case 'lectureHours': case 'labHours': case 'weeklyHours': case 'totalHours':
      return parseInt(val, 10) || 0;
    case 'credits': return parseFloat(val) || 0;
    case 'weekMode': return parseWeekMode(val);
    default: return val;
  }
}

function parseWeekday(val) {
  // "周一" → 1, "星期三" → 3, "3" → 3
  const s = String(val).trim();
  for (const [k, v] of Object.entries(WEEKDAY_MAP)) {
    if (s.includes(k)) return v;
  }
  const n = parseInt(s, 10);
  return (n >= 1 && n <= 7) ? n : 1;
}

function parseSlot(val) {
  const s = String(val).trim();
  // "第3节" → 3, "3-4节" → 取第一个, "3" → 3
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 1;
}

function parseWeekMode(val) {
  const s = String(val).trim();
  if (/单/.test(s)) return 'odd';
  if (/双/.test(s)) return 'even';
  if (/指定/.test(s)) return 'specific';
  return 'all';
}

function mapCourseType(val) {
  const s = String(val || '').trim();
  if (/讲|理论|授/.test(s)) return '讲课';
  if (/实验|实/.test(s)) return '实验';
  if (/实践/.test(s)) return '实践';
  if (/上机/.test(s)) return '上机';
  if (/讨论/.test(s)) return '讨论';
  return s;
}

function isEmptyRow(row) {
  return !row || row.every(c => String(c || '').trim() === '');
}

// ============================================================
// 网格格式解析（类似 PDF 布局：列=星期、行=节次）
// ============================================================
function parseGridFormat(rows) {
  const courses = [];

  // 定位"星期"所在行和列
  let headerRow = -1;
  const dayColMap = {}; // col → weekday

  for (let r = 0; r < Math.min(rows.length, 3); r++) {
    const row = rows[r].map(c => String(c || '').trim());
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      for (const [k, v] of Object.entries(WEEKDAY_MAP)) {
        if (cell.includes('星期' + k) || cell === '周' + k) {
          dayColMap[c] = v;
          headerRow = r;
        }
      }
    }
    if (Object.keys(dayColMap).length > 0) break;
  }

  if (Object.keys(dayColMap).length === 0) {
    // 无法识别，回退到列表格式
    return parseListFormat(rows);
  }

  // 解析数据行（每行对应一个节次范围）
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (isEmptyRow(row)) continue;

    // 第一列通常是时间段/节次信息
    const periodInfo = String(row[0] || '').trim();
    const defaultSlot = parseSlotFromGrid(periodInfo, r, headerRow);

    // 遍历每个星期列
    for (const [colStr, weekday] of Object.entries(dayColMap)) {
      const col = parseInt(colStr, 10);
      const cellText = String(row[col] || '').trim();
      if (!cellText || cellText.length < 3) continue;

      const course = parseCourseCell(cellText, weekday, defaultSlot);
      if (course) courses.push(course);
    }
  }

  return courses;
}

function parseSlotFromGrid(info, rowIdx, headerRow) {
  // "上午 1-2节" → {start:1, end:2}
  const m = info.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (m) return { start: parseInt(m[1], 10), end: parseInt(m[2], 10) };
  const s = info.match(/(\d+)/);
  if (s) {
    const n = parseInt(s[1], 10);
    return { start: n, end: n };
  }
  // 根据行号估算
  const est = (rowIdx - headerRow) * 2 + 1;
  return { start: est, end: est + 1 };
}

/**
 * 解析网格单元格中的课程文本
 */
function parseCourseCell(text, weekday, defaultSlot) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length < 3) return null;

  // 提取课程名和类型标记
  const typeMap = { '★': '讲课', '○': '实验', '●': '实践', '◇': '上机', '◆': '讨论' };
  let name = clean;
  let type = '';
  for (const [mark, label] of Object.entries(typeMap)) {
    const idx = clean.indexOf(mark);
    if (idx > 0) {
      name = clean.substring(0, idx).trim();
      type = label;
      break;
    }
  }

  // 节次
  const slotMatch = clean.match(/\((\d+)-(\d+)节\)/);
  const startSlot = slotMatch ? parseInt(slotMatch[1], 10) : (defaultSlot.start || 1);
  const endSlot = slotMatch ? parseInt(slotMatch[2], 10) : (defaultSlot.end || 2);

  // 周次
  let startWeek = 1, endWeek = 20, weekMode = 'all', specificWeeks = [];

  if (/(\d+)-(\d+)周\s*[（(]单[）)]/.test(clean)) {
    const m = clean.match(/(\d+)-(\d+)周\s*[（(]单[）)]/);
    startWeek = parseInt(m[1], 10); endWeek = parseInt(m[2], 10); weekMode = 'odd';
  } else if (/(\d+)-(\d+)周\s*[（(]双[）)]/.test(clean)) {
    const m = clean.match(/(\d+)-(\d+)周\s*[（(]双[）)]/);
    startWeek = parseInt(m[1], 10); endWeek = parseInt(m[2], 10); weekMode = 'even';
  } else if (/(\d+)周[,，](\d+)周/.test(clean)) {
    const weeks = clean.match(/(\d+)周/g).map(w => parseInt(w, 10));
    specificWeeks = weeks; startWeek = Math.min(...weeks); endWeek = Math.max(...weeks);
    weekMode = 'specific';
  } else if (/(\d+)-(\d+)周/.test(clean)) {
    const m = clean.match(/(\d+)-(\d+)周/);
    startWeek = parseInt(m[1], 10); endWeek = parseInt(m[2], 10);
  }

  const campus = extractField(clean, '校区');
  const location = extractField(clean, '场地');
  const teacher = extractField(clean, '教师');
  const teachingClass = extractField(clean, '教学班');
  const classGroup = extractField(clean, '教学班组成');
  const examMethod = extractField(clean, '考核方式');

  return {
    name, type, teacher, location, campus, weekday,
    startSlot, endSlot, startWeek, endWeek, weekMode, specificWeeks,
    teachingClass, classGroup, examMethod,
    lectureHours: extractNum(clean, '讲课'),
    labHours: extractNum(clean, '实验'),
    weeklyHours: extractNum(clean, '周学时'),
    totalHours: extractNum(clean, '总学时'),
    credits: extractFloat(clean, '学分'),
    semester: '',
  };
}

function extractField(text, key) {
  const m = text.match(new RegExp(key + '[：:]([^/]+)'));
  return m ? m[1].trim() : '';
}
function extractNum(text, key) {
  const m = text.match(new RegExp(key + '[：:](\\d+)'));
  return m ? parseInt(m[1], 10) : 0;
}
function extractFloat(text, key) {
  const m = text.match(new RegExp(key + '[：:]([\\d.]+)'));
  return m ? parseFloat(m[1]) : 0;
}

// ============================================================
// 提取学期信息
// ============================================================
function extractSemester(rows) {
  const allText = rows.flat().map(c => String(c || '')).join(' ');
  const m = allText.match(/(\d{4})-(\d{4})学年[第](\d)学期/);
  if (m) return m[1] + '-' + m[1] + '-' + m[3];

  const m2 = allText.match(/(\d{4})[-\/](\d{4})[第]?(\d)/);
  if (m2) return m2[1] + '-' + m2[2] + '-' + m2[3];

  return '';
}
