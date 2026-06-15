/**
 * utils/course-colors.js
 * 课表课程展示色预设
 *
 * 12 种柔和配色，确保相邻课程颜色差异足够大
 * 颜色选择参考了色相环均匀分布 + 柔化饱和度
 */

const COURSE_COLORS = [
  { name: '蓝', bg: '#D6EAF8', border: '#85C1E9', text: '#1A5276' },
  { name: '绿', bg: '#D5F5E3', border: '#82E0AA', text: '#1E8449' },
  { name: '橙', bg: '#FDEBD0', border: '#F8C471', text: '#B9770E' },
  { name: '紫', bg: '#E8DAEF', border: '#C39BD3', text: '#6C3483' },
  { name: '红', bg: '#FADBD8', border: '#F1948A', text: '#922B21' },
  { name: '青', bg: '#D1F2EB', border: '#76D7C4', text: '#117A65' },
  { name: '黄', bg: '#FCF3CF', border: '#F9E79F', text: '#9A7D0A' },
  { name: '粉', bg: '#F5EEF8', border: '#D7BDE2', text: '#7D3C98' },
  { name: '灰蓝', bg: '#D4E6F1', border: '#85C1E9', text: '#2E86C1' },
  { name: '草绿', bg: '#E9F7EF', border: '#A9DFBF', text: '#1D8348' },
  { name: '浅棕', bg: '#FAE5D3', border: '#EDBB99', text: '#A04000' },
  { name: '靛蓝', bg: '#E8EAF6', border: '#9FA8DA', text: '#283593' },
];

/**
 * 为新课程自动分配颜色
 * 使用轮询策略，保证同一用户的课程颜色尽量分散
 * @param {Array} existingCourses - 当前用户已有课程数组
 * @param {number} [colorIndex] - 手动指定颜色索引（可选）
 * @returns {Object} 颜色对象 { name, bg, border, text }
 */
function assignColor(existingCourses, colorIndex) {
  // 手动指定
  if (typeof colorIndex === 'number' && colorIndex >= 0 && colorIndex < COURSE_COLORS.length) {
    return COURSE_COLORS[colorIndex];
  }

  // 自动轮询：找到使用次数最少的颜色
  if (existingCourses && existingCourses.length > 0) {
    const colorUsage = new Array(COURSE_COLORS.length).fill(0);
    existingCourses.forEach((course) => {
      if (course.color && course.color.name) {
        const idx = COURSE_COLORS.findIndex(c => c.name === course.color.name);
        if (idx >= 0) colorUsage[idx]++;
      }
    });
    const minUsage = Math.min(...colorUsage);
    const leastUsedIndices = colorUsage
      .map((count, i) => (count === minUsage ? i : -1))
      .filter(i => i >= 0);
    // 在最少使用的颜色中随机选一个
    const pick = leastUsedIndices[Math.floor(leastUsedIndices.length * Math.random())];
    return COURSE_COLORS[pick];
  }

  // 没有已有课程，随机分配
  const randomIndex = Math.floor(Math.random() * COURSE_COLORS.length);
  return COURSE_COLORS[randomIndex];
}

/**
 * 获取所有可用颜色（供颜色选择器使用）
 * @returns {Array} 颜色数组
 */
function getAllColors() {
  return COURSE_COLORS;
}

/**
 * 根据颜色名获取颜色对象
 * @param {string} name
 * @returns {Object|undefined}
 */
function getColorByName(name) {
  return COURSE_COLORS.find(c => c.name === name);
}

module.exports = {
  COURSE_COLORS,
  assignColor,
  getAllColors,
  getColorByName,
};
