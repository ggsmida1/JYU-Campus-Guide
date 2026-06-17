// 云函数 — 步行时间预估
// 调用腾讯地图路线规划 API，返回步行时长
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const MAP_KEY = 'ILUBZ-PXBYW-2M2R7-3CHJJ-WFCDV-EGBJX';

/**
 * @param {number} fromLat, fromLng - 起点坐标（用户位置）
 * @param {number} toLat, toLng - 终点坐标（教室）
 * @returns {{ duration: number, distance: number }} 步行分钟数 + 距离（米）
 */
async function getWalkingTime(fromLat, fromLng, toLat, toLng) {
  const https = require('https');
  const params = `from=${fromLat},${fromLng}&to=${toLat},${toLng}&key=${MAP_KEY}`;
  const url = 'https://apis.map.qq.com/ws/direction/v1/walking/?' + params;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status === 0 && json.result && json.result.routes && json.result.routes.length) {
            const route = json.result.routes[0];
            resolve({ duration: Math.ceil(route.duration / 60), distance: route.distance });
          } else {
            reject(new Error(json.message || 'ROUTE_FAIL'));
          }
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

/**
 * 根据地点名称匹配 site 数据库，获取坐标
 */
async function getSiteCoordinates(location) {
  if (!location) return null;
  try {
    const db = cloud.database();
    const clean = location.replace(/[\dA-Z\-]+$/, '').trim(); // "锡科404"→"锡科"
    const res = await db.collection('site').where({
      aliases: db.RegExp({ regexp: clean, options: 'i' })
    }).limit(1).get();
    if (res.data.length > 0) {
      return { lat: res.data[0].latitude, lng: res.data[0].longitude, name: res.data[0].name };
    }
    // 尝试 name 匹配
    const res2 = await db.collection('site').where({
      name: db.RegExp({ regexp: clean, options: 'i' })
    }).limit(1).get();
    if (res2.data.length > 0) {
      return { lat: res2.data[0].latitude, lng: res2.data[0].longitude, name: res2.data[0].name };
    }
  } catch(e) { /* fall through */ }
  return null;
}

exports.main = async (event, context) => {
  const { fromLat, fromLng, toLocation, toLat, toLng } = event;

  try {
    // 确定终点坐标
    let endLat = toLat, endLng = toLng;
    if (!endLat && toLocation) {
      const site = await getSiteCoordinates(toLocation);
      if (!site) return { success: false, errMsg: '未找到教室坐标: ' + toLocation };
      endLat = site.lat; endLng = site.lng;
    }
    if (!endLat || !endLng) return { success: false, errMsg: '缺少终点坐标' };

    // 确定起点坐标
    const sLat = fromLat || 24.315;  // 默认：嘉应学院江北校区
    const sLng = fromLng || 116.128;

    const result = await getWalkingTime(sLat, sLng, endLat, endLng);
    return { success: true, ...result };
  } catch (err) {
    return { success: false, errMsg: err.message };
  }
};
