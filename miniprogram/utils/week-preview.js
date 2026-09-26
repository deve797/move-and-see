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
  return date.toISOString().slice(0, 10);
}
// 日期选择器的值是北京时间日期，使用 UTC 日历运算，避免设备时区影响。
function parseDate(value) {
  return new Date(value + 'T00:00:00Z');
}
function monday(date) {
  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  return start;
}
function nextMonday(now) {
  const start = parseDate(currentMonday(now));
  start.setUTCDate(start.getUTCDate() + 7);
  return dateKey(start);
}
function currentMonday(now) {
  return dateKey(monday(new Date(now.getTime() + 8 * 60 * 60 * 1000)));
}
function weekPreview(value, now) {
  const start = monday(parseDate(value));
  const days = samples.map((sample, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return Object.assign({}, sample, { id: index, date: dateKey(date), shortDate: (date.getUTCMonth() + 1) + '/' + date.getUTCDate() });
  });
  const key = dateKey(start);
  const isCurrentWeek = key === currentMonday(now);
  const isNextWeek = key === nextMonday(now);
  const title = isCurrentWeek ? '本周计划' : isNextWeek ? '下周怎么动？' : '这一周的计划';
  return { days, selectedDate: key, title, isCurrentWeek, isNextWeek, range: days[0].shortDate + ' — ' + days[6].shortDate };
}
module.exports = { samples, currentMonday, nextMonday, weekPreview };
