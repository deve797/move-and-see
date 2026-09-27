const weeklyProgress = require('../../utils/weekly-progress');
const fourWeekProgress = require('../../utils/four-week-progress');
const moods = require('../../utils/mood-options');
const { resultCategory, actualExerciseDate } = require('../../utils/exercise-result');
Page({
  onShareAppMessage: require('../../utils/share'),
  data: {
    cloudLoading: true, cloudError: '',
    weeklyProgress: { completed: 0, total: 0 }, resultGroups: [], hasResults: false, reasonGroups: [],
    moodComparison: { improved: 0, same: 0, declined: 0, total: 0 },
    weeks: [],
    moodNotesExpanded: false,
    moodNotes: [],
    artFailed: false
  },
  async onShow() {
    this.setData({ cloudLoading: true, cloudError: '' });
    try {
      await getApp().loadData();
      this.renderReview();
    } catch (error) {
      this.setData({ cloudError: error.message || '记录加载失败，请重试' });
    } finally {
      this.setData({ cloudLoading: false });
    }
  },
  retryLoad() { return this.onShow(); },
  renderReview() {
    const date = new Date(new Date().getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const data = getApp().globalData;
    const plans = weeklyProgress.getWeekPlans(data.plans, {}, date)
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || String(a.id).localeCompare(String(b.id)));
    const resultGroups = [
      { key: 'completed', label: '按计划完成', plans: [] },
      { key: 'replacement', label: '替代完成', plans: [] },
      { key: 'makeup', label: '补做', plans: [] },
      { key: 'incomplete', label: '仍未完成', plans: [] }
    ];
    const reasonGroups = [];
    plans.forEach(plan => {
      if (!plan.result) return;
      if (plan.result.status === 'incomplete' && plan.result.reason) {
        let reasonGroup = reasonGroups.find(item => item.reason === plan.result.reason);
        if (!reasonGroup) {
          reasonGroup = { reason: plan.result.reason, count: 0, makeupCount: 0 };
          reasonGroups.push(reasonGroup);
        }
        reasonGroup.count += 1;
        if (plan.result.makeup) reasonGroup.makeupCount += 1;
      }
      if ((data.periodDays || {})[plan.date] === true) return;
      const key = resultCategory(plan);
      const group = resultGroups.find(item => item.key === key);
      if (group) group.plans.push(Object.assign({}, plan, {
        actualDate: actualExerciseDate(plan),
        actualActivity: plan.result.makeup ? plan.result.makeup.actualActivity : plan.result.status === 'replacement' ? plan.result.actualActivity : plan.activity
      }));
    });
    const moodComparison = { improved: 0, same: 0, declined: 0, total: 0 };
    // 沿用原计划周范围；免考核不影响实际运动的心情比较。
    weeklyProgress.getWeekPlans(data.plans, {}, date).forEach(plan => {
      const result = plan.result;
      if (!result) return;
      const motion = result.status === 'incomplete' ? result.makeup : ['completed', 'replacement'].includes(result.status) ? result : null;
      if (!motion) return;
      // 替代和补做只取实际运动自身的感受，不与原计划的心情拼接。
      const sameDayCompleted = result.status === 'completed' && (!result.actualDate || result.actualDate === plan.date);
      const beforeMood = sameDayCompleted ? plan.beforeMood : motion.beforeMood;
      const before = moods.findIndex(item => item.value === beforeMood);
      const after = moods.findIndex(item => item.value === motion.afterMood);
      if (before < 0 || after < 0) return;
      moodComparison[after > before ? 'improved' : after === before ? 'same' : 'declined'] += 1;
      moodComparison.total += 1;
    });
    const moodNotes = [];
    plans.forEach(plan => {
      const result = plan.result;
      const before = plan.beforeMoodNote || '';
      const sameDayCompleted = result && result.status === 'completed' && (!result.actualDate || result.actualDate === plan.date);
      const after = sameDayCompleted ? result.afterMoodNote || '' : '';
      if (before || after) moodNotes.push({
        id: plan.id + '-plan', date: plan.date, startTime: plan.startTime,
        activity: plan.activity, context: '原计划 · ' + plan.startTime, before, after
      });
      // 原计划前备注不与替代或补做的实际运动拼接。
      const motion = result && (result.status === 'incomplete' ? result.makeup : result.status === 'replacement' || result.status === 'completed' && !sameDayCompleted ? result : null);
      if (!motion || (!motion.beforeMoodNote && !motion.afterMoodNote)) return;
      const isMakeup = resultCategory(plan) === 'makeup';
      const actualDate = actualExerciseDate(plan);
      moodNotes.push({
        id: plan.id + '-motion', date: actualDate || plan.date,
        startTime: actualDate || isMakeup ? '' : plan.startTime, activity: result.status === 'completed' ? plan.activity : motion.actualActivity,
        context: (isMakeup ? '补做' : '替代完成') + ' · 原计划 ' + plan.date + ' ' + plan.startTime + ' ' + plan.activity,
        before: motion.beforeMoodNote || '', after: motion.afterMoodNote || ''
      });
    });
    moodNotes.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
    this.setData({
      weeklyProgress: weeklyProgress(data.plans, data.periodDays || {}, date),
      weeks: fourWeekProgress(data.plans, data.periodDays || {}, date),
      resultGroups, hasResults: resultGroups.some(group => group.plans.length > 0), reasonGroups, moodComparison, moodNotes
    });
  },
  onArtError() { this.setData({ artFailed: true }); },
  toggleMoodNotes() {
    if (this.data.moodNotesExpanded) this.collapseMoodNotes();
    else this.setData({ moodNotesExpanded: true });
  },
  collapseMoodNotes() {
    this.setData({ moodNotesExpanded: false }, () => {
      wx.pageScrollTo({ selector: '#mood-summary', duration: 0 });
    });
  },
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/today/index' });
  }
});
