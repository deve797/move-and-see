const weeklyProgress = require('./weekly-progress');

// date 为北京时间日期，周界使用 UTC 日历运算，口径与本周进度相同。
function fourWeekProgress(plans, periodDays, date) {
  const monday = new Date(date + 'T00:00:00Z');
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7 - 21);
  return Array.from({ length: 4 }, (_, index) => {
    const startDate = monday.toISOString().slice(0, 10);
    monday.setUTCDate(monday.getUTCDate() + 6);
    const endDate = monday.toISOString().slice(0, 10);
    monday.setUTCDate(monday.getUTCDate() + 1);
    const progress = weeklyProgress(plans, periodDays, startDate);
    const isCurrent = index === 3;
    // 过去周仅凭现存计划确认有历史；取消、免考核不抹去这份历史。
    const hasData = isCurrent || plans.some(plan => plan.date >= startDate && plan.date <= endDate);
    return {
      startDate, endDate, isCurrent, ...progress,
      rate: progress.total ? Math.round(progress.completed / progress.total * 100) : null,
      emptyLabel: hasData ? '无考核计划' : '无数据'
    };
  });
}

module.exports = fourWeekProgress;
