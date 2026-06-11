/* data/buildings.js */
// 课表地点 → 地点数据库的映射表
// key: 从课表地点提取的楼名（去数字字母）
// value: 在 site 表 name/aliases 中用于搜索的关键词
// 维护方式：发现课表地点搜不到对应教学楼时，在此补充映射
module.exports = {
  buildingMap: {
    // 江北校区
    '锡科': '锡昌科技大楼',
    '田师': '田家炳师范大楼',
    '活活艺术大楼': '活活艺术中心',
    '活活': '活活艺术中心',
    '公': '公楼',
    '公B': '公楼',
    '公C': '公楼',
    '李小平教育大楼': '李小平教育大楼',
    '百年纪念大楼': '百年纪念大楼',
    '宪梓': '宪梓楼',
    '网络课程超星': '',     // 线上课程，无需导航
    '健美操': '健美操房',

    // 陆续补充...
  },

  /**
   * 根据课表地点返回最佳搜索关键词
   * @param {string} location - 课表地点，如"锡科404"、"公B407"
   * @returns {string} 搜索关键词
   */
  lookup(location) {
    if (!location) return '';
    // 去除末尾数字和字母，得到楼名部分
    const raw = location.replace(/[\dA-Z\-]+/g, '').trim();
    // 查映射表
    if (this.buildingMap[raw]) return this.buildingMap[raw];
    // 尝试匹配前缀（如"活活艺术大楼"→"活活艺术中心"）
    for (const [key, val] of Object.entries(this.buildingMap)) {
      if (val && (raw.includes(key) || key.includes(raw))) return val;
    }
    // 回退：返回原始楼名
    return raw;
  }
};
