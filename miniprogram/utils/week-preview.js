// 仅用于前端示例展示，不代表真实计划，不做持久化。
const samples = [
  { weekday: '周一', name: '瑜伽', duration: '30 分钟', tone: 'sage', col: 0, row: 0 },
  { weekday: '周二', name: '休息一下', duration: '', tone: 'rest', col: 1, row: 0 },
  { weekday: '周三', name: '跑步', duration: '40 分钟', tone: 'orange', col: 2, row: 0 },
  { weekday: '周四', name: '力量训练', duration: '30 分钟', tone: 'sage', col: 3, row: 0 },
  { weekday: '周五', name: '自由安排', duration: '', tone: 'rest', col: 0, row: 1 },
  { weekday: '周六', name: '户外活动', duration: '60 分钟', tone: 'orange', col: 1, row: 1 },
  { weekday: '周日', name: '休息一下', duration: '', tone: 'rest', col: 2, row: 1 }
];
function dateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
function parseDate(value) {
  const parts = value.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], 12);
}
function monday(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  return start;
}
function nextMonday(now) {
  const start = monday(now);
  start.setDate(start.getDate() + 7);
  return dateKey(start);
}
function weekPreview(value, now) {
  const start = monday(parseDate(value));
  const days = samples.map((sample, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return Object.assign({}, sample, { id: index, date: dateKey(date), shortDate: (date.getMonth() + 1) + '/' + date.getDate() });
  });
  const key = dateKey(start);
  const title = key === nextMonday(now) ? '下周怎么动？' : key === dateKey(monday(now)) ? '这周怎么动？' : '这一周怎么动？';
  return { days, selectedDate: key, title, range: days[0].shortDate + ' — ' + days[6].shortDate };
}
module.exports = { samples, nextMonday, weekPreview };
