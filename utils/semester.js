/**
 * utils/semester.js
 * 学期周次计算工具函数
 *
 * 使用说明：
 * - 学期起始日期由用户在 user_settings.semesterStart 中设置
 * - 所有函数均为纯函数，无副作用
 */

/**
 * 计算指定日期所属的教学周
 * @param {string|Date} date - 要计算的日期（默认今天）
 * @param {string} semesterStart - 学期第一天日期，格式 'YYYY-MM-DD'（如 '2026-02-24'）
 * @returns {number} 当前教学周（从 1 开始），如果日期在学期开始前返回 0，超过总周数则返回总周数
 */
function getCurrentWeek(date, semesterStart) {
  const target = date ? new Date(date) : new Date();
  const start = new Date(semesterStart);

  // 去掉时分秒
  const targetDate = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate());

  // 学期第一周从起始日所在周的周一开始
  const startDay = startDate.getDay(); // 0=周日
  const daysToMonday = startDay === 0 ? -6 : -(startDay - 1); // 往前推到周一
  const effectiveStart = new Date(startDate);
  effectiveStart.setDate(startDate.getDate() + daysToMonday);

  const diffMs = targetDate - effectiveStart;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 0;
  return Math.floor(diffDays / 7) + 1;
}

/**
 * 判断指定周次是否为单周
 * @param {number} week - 教学周（从 1 开始）
 * @returns {boolean}
 */
function isOddWeek(week) {
  return week % 2 === 1;
}

/**
 * 判断指定周次是否为双周
 * @param {number} week - 教学周（从 1 开始）
 * @returns {boolean}
 */
function isEvenWeek(week) {
  return week % 2 === 0;
}

/**
 * 检查某门课程在指定周次是否上课
 * @param {Object} course - 课程对象
 * @param {number} course.startWeek - 起始周
 * @param {number} course.endWeek - 结束周
 * @param {string} course.weekMode - 'all' | 'odd' | 'even' | 'specific'
 * @param {number[]} course.specificWeeks - 指定周数组（weekMode='specific' 时使用）
 * @param {number} targetWeek - 要检查的教学周
 * @returns {boolean}
 */
function isCourseActiveInWeek(course, targetWeek) {
  // 指定周模式
  if (course.weekMode === 'specific') {
    return Array.isArray(course.specificWeeks) && course.specificWeeks.includes(targetWeek);
  }

  // 检查周次范围
  if (targetWeek < course.startWeek || targetWeek > course.endWeek) {
    return false;
  }

  // 单双周检查
  if (course.weekMode === 'odd') return isOddWeek(targetWeek);
  if (course.weekMode === 'even') return isEvenWeek(targetWeek);

  // 'all' 模式
  return true;
}

/**
 * 解析周次描述字符串
 * 支持格式：
 *   "1-17周"       → { startWeek:1, endWeek:17, weekMode:'all' }
 *   "1-17周(单)"    → { startWeek:1, endWeek:17, weekMode:'odd' }
 *   "1-17周(双)"    → { startWeek:1, endWeek:17, weekMode:'even' }
 *   "11周,15周"     → { weekMode:'specific', specificWeeks:[11,15] }
 *   "1,3,5,7周"    → { weekMode:'specific', specificWeeks:[1,3,5,7] }
 * @param {string} weekStr - 周次描述字符串
 * @returns {Object} { startWeek, endWeek, weekMode, specificWeeks }
 */
function parseWeekString(weekStr) {
  if (!weekStr || typeof weekStr !== 'string') {
    return { startWeek: 1, endWeek: 1, weekMode: 'all', specificWeeks: [] };
  }

  const cleaned = weekStr.replace(/周/g, '').trim();

  // 单双周模式：1-17周(单) / 1-17周(双)
  const parityMatch = cleaned.match(/^(\d+)-(\d+)[(（]([单双])[)）]$/);
  if (parityMatch) {
    return {
      startWeek: parseInt(parityMatch[1], 10),
      endWeek: parseInt(parityMatch[2], 10),
      weekMode: parityMatch[3] === '单' ? 'odd' : 'even',
      specificWeeks: [],
    };
  }

  // 连续周：1-17周
  const rangeMatch = cleaned.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    return {
      startWeek: parseInt(rangeMatch[1], 10),
      endWeek: parseInt(rangeMatch[2], 10),
      weekMode: 'all',
      specificWeeks: [],
    };
  }

  // 指定周：11周,15周 或 1,3,5,7周
  const specificMatch = cleaned.match(/^\d+(,\d+)*$/);
  if (specificMatch) {
    const weeks = cleaned.split(',').map(w => parseInt(w.trim(), 10)).filter(w => !isNaN(w));
    return {
      startWeek: Math.min(...weeks),
      endWeek: Math.max(...weeks),
      weekMode: 'specific',
      specificWeeks: weeks,
    };
  }

  // 单个周：11周
  const singleMatch = cleaned.match(/^(\d+)$/);
  if (singleMatch) {
    const w = parseInt(singleMatch[1], 10);
    return {
      startWeek: w,
      endWeek: w,
      weekMode: 'specific',
      specificWeeks: [w],
    };
  }

  // 无法解析，返回默认值
  return { startWeek: 1, endWeek: 1, weekMode: 'all', specificWeeks: [] };
}

/**
 * 生成学期标识字符串
 * @param {number} year - 学年起始年份，如 2025
 * @param {number} term - 学期，1 或 2
 * @returns {string} 如 '2025-2026-2'
 */
function getSemesterId(year, term) {
  return `${year}-${year + 1}-${term}`;
}

/**
 * 解析学期标识字符串
 * @param {string} semesterId - 如 '2025-2026-2'
 * @returns {Object} { year: 2025, term: 2, label: '2025-2026学年第二学期' }
 */
function parseSemesterId(semesterId) {
  const parts = semesterId.split('-');
  const year = parseInt(parts[0], 10);
  const term = parseInt(parts[2], 10);
  const termLabel = term === 1 ? '第一学期' : '第二学期';
  return {
    year,
    term,
    label: `${year}-${year + 1}学年${termLabel}`,
  };
}

/**
 * 根据当前日期自动判断学期
 * 假设：第一学期 9月~1月，第二学期 2月~7月
 * @param {Date} [date] - 日期（默认今天）
 * @returns {string} semesterId
 */
function guessCurrentSemester(date) {
  const d = date || new Date();
  const month = d.getMonth() + 1; // 1-12
  const year = d.getFullYear();

  if (month >= 2 && month <= 7) {
    return `${year - 1}-${year}-2`; // 第二学期
  }
  // 8 月视为暑假末期，默认即将进入第一学期
  return `${year}-${year + 1}-1`; // 第一学期
}

/**
 * 获取默认的学期起始日期
 * @param {string} semesterId - 学期标识
 * @returns {string} 预估的学期起始日期 'YYYY-MM-DD'
 */
function getDefaultSemesterStart(semesterId) {
  const { year, term } = parseSemesterId(semesterId);
  if (term === 1) {
    return `${year}-09-01`; // 第一学期约 9 月 1 日
  }
  return `${year + 1}-02-24`; // 第二学期约 2 月下旬（需用户精确设置）
}

module.exports = {
  getCurrentWeek,
  isOddWeek,
  isEvenWeek,
  isCourseActiveInWeek,
  parseWeekString,
  getSemesterId,
  parseSemesterId,
  guessCurrentSemester,
  getDefaultSemesterStart,
};
