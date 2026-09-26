// date 为北京时间日期；用 UTC 日历运算，避免设备时区改变周界。
function getWeekPlans(plans, periodDays, date) {
  const start = new Date(date + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const startDate = start.toISOString().slice(0, 10);
  start.setUTCDate(start.getUTCDate() + 7);
  const endDate = start.toISOString().slice(0, 10);
  return plans.filter(plan => !plan.cancelled && plan.date >= startDate && plan.date < endDate && periodDays[plan.date] !== true);
}
function weeklyProgress(plans, periodDays, date) {
  const progress = { completed: 0, total: 0 };
  getWeekPlans(plans, periodDays, date).forEach(plan => {
    progress.total += 1;
    const result = plan.result;
    if (result && (['completed', 'replacement'].includes(result.status) || (result.status === 'incomplete' && result.makeup))) {
      progress.completed += 1;
    }
  });
  return progress;
}
module.exports = weeklyProgress;
module.exports.getWeekPlans = getWeekPlans;
