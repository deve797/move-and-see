const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
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
  const days = weekdays.map((weekday, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return { id: index, weekday, date: dateKey(date), shortDate: (date.getUTCMonth() + 1) + '/' + date.getUTCDate() };
  });
  const key = dateKey(start);
  const isCurrentWeek = key === currentMonday(now);
  const isNextWeek = key === nextMonday(now);
  const title = isCurrentWeek ? '本周计划' : isNextWeek ? '下周怎么动？' : '这一周的计划';
  return { days, selectedDate: key, title, isCurrentWeek, isNextWeek, range: days[0].shortDate + ' — ' + days[6].shortDate };
}
module.exports = { currentMonday, nextMonday, weekPreview };
