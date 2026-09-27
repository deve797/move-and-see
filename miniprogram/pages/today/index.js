const moodOptions = require('../../utils/mood-options');
const weeklyProgress = require('../../utils/weekly-progress');
function todayDate() {
  return new Date(new Date().getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
Page({
  onShareAppMessage: require('../../utils/share'),
  data: {
    activities: [], date: '', artFailed: {}, periodMarked: false, periodWalk: null,
    loading: true, loadError: '', saving: false, saveError: '', saveConflict: false,
    weeklyProgress: { completed: 0, total: 0 },
    moodSheetOpen: false, moodPlanId: null,
    moodActivityName: '', moodActivityTime: '', selectedBeforeMood: '',
    beforeMoodNote: '', beforeMoodNoteFocused: false,
    beforeMoodOptions: moodOptions
  },
  async onShow() {
    if (this.data.saving) return;
    this.setData({ loading: true, loadError: '' });
    try {
      await getApp().loadData();
      this.renderToday();
      // 重新显示也可能只是从后台回来；保留弹层草稿及其原版本，日期和列表仍刷新。
      if (!this.data.moodSheetOpen) {
        this._moodPlan = null;
        this.setData({ moodPlanId: null, selectedBeforeMood: '', beforeMoodNote: '', beforeMoodNoteFocused: false });
      }
    } catch (error) {
      this.setData({ loadError: error.message || '暂时无法读取记录，请重试。' });
    } finally {
      this.setData({ loading: false });
    }
  },
  retryLoad() { return this.onShow(); },
  reloadAfterConflict() {
    if (!this.data.saveConflict || this.data.saving) return;
    wx.showModal({
      title: '放弃填写并重新读取？',
      content: '当前尚未保存的填写会被清空。读取最新记录后，可以重新填写。',
      confirmText: '重新读取',
      cancelText: '继续填写',
      success: async result => {
        if (!result.confirm || this.data.saving) return;
        this._day = null;
        this._moodPlan = null;
        this.setData({ moodSheetOpen: false, moodPlanId: null, selectedBeforeMood: '', beforeMoodNote: '', beforeMoodNoteFocused: false, saveError: '', saveConflict: false });
        await this.onShow();
      }
    });
  },
  renderToday() {
    const app = getApp();
    const date = todayDate();
    const day = app.getDay(date);
    this._day = day;
    const periodMarked = day.periodMarked === true;
    const activities = app.globalData.plans
      .filter(plan => plan.date === date && !plan.cancelled)
      .sort((a, b) => a.startTime.localeCompare(b.startTime) || String(a.id).localeCompare(String(b.id)))
      .map(plan => {
        const option = moodOptions.find(item => item.value === plan.beforeMood);
        return {
          id: plan.id, name: plan.activity, time: plan.startTime, periodExempt: periodMarked,
          completed: Boolean(plan.result && (['completed', 'replacement'].includes(plan.result.status) || (plan.result.status === 'incomplete' && plan.result.makeup))),
          result: plan.result || null,
          kind: plan.activity === '瑜伽' ? 'yoga' : plan.activity === '跑步' ? 'running' : '',
          beforeMood: option ? option.value : '', beforeMoodLabel: option ? option.label : '',
          beforeMoodNote: plan.beforeMoodNote || ''
        };
      });
    this.setData({
      date, activities, periodMarked,
      weeklyProgress: weeklyProgress(app.globalData.plans, app.globalData.periodDays || {}, date),
      periodWalk: periodMarked ? day.periodWalk || null : null
    });
  },
  async persistDay(day) {
    if (this.data.saving) return;
    this.setData({ saving: true, saveError: '', saveConflict: false });
    try {
      await getApp().saveDay(day);
      this.renderToday();
    } catch (error) {
      const message = error.message || '保存失败，请重试。';
      this.setData({ saveError: message, saveConflict: ['VERSION_CONFLICT', 'DAY_VERSION_CONFLICT'].includes(error.code) });
      wx.showToast({ title: message, icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },
  async setPeriod(event) {
    if (this.data.saving || this.data.loading || this.data.loadError) return;
    if (todayDate() !== this.data.date) return this.onShow();
    const marked = event.currentTarget.dataset.marked;
    if (typeof marked !== 'boolean') return;
    const day = JSON.parse(JSON.stringify(this._day));
    day.periodMarked = marked;
    return this.persistDay(day);
  },
  async choosePeriodWalk() {
    if (this.data.saving || this.data.loading || this.data.loadError) return;
    if (todayDate() !== this.data.date) return this.onShow();
    if (!this._day.periodMarked || this._day.periodWalk) return;
    const day = JSON.parse(JSON.stringify(this._day));
    day.periodWalk = { status: 'pending' };
    return this.persistDay(day);
  },
  async recordPeriodWalk(event) {
    if (this.data.saving || this.data.loading || this.data.loadError) return;
    if (todayDate() !== this.data.date) return this.onShow();
    const status = event.currentTarget.dataset.status;
    if (!this._day.periodMarked || !this._day.periodWalk || !['completed', 'incomplete'].includes(status)) return;
    const day = JSON.parse(JSON.stringify(this._day));
    day.periodWalk.status = status;
    return this.persistDay(day);
  },
  openBeforeMood(event) {
    if (this.data.moodPlanId !== null || this.data.saving || this.data.loading || this.data.loadError) return;
    const activity = this.data.activities.find(item => String(item.id) === String(event.currentTarget.dataset.id));
    const plan = activity && getApp().globalData.plans.find(item => String(item.id) === String(activity.id) && !item.cancelled);
    if (!plan) return;
    this._moodPlan = JSON.parse(JSON.stringify(plan));
    this._moodPlan._dayVersion = getApp().getDay(plan.date).version;
    this.setData({
      moodSheetOpen: true, moodPlanId: activity.id,
      moodActivityName: activity.name, moodActivityTime: activity.time,
      selectedBeforeMood: plan.beforeMood || '',
      beforeMoodNote: plan.beforeMoodNote || '', beforeMoodNoteFocused: false, saveError: '', saveConflict: false
    });
  },
  selectBeforeMood(event) {
    if (!this.data.moodSheetOpen || this.data.saving) return;
    const option = this.data.beforeMoodOptions.find(item => item.value === event.currentTarget.dataset.value);
    if (!option) return;
    this.setData({ selectedBeforeMood: option.value });
  },
  inputBeforeMoodNote(event) {
    if (!this.data.saving) this.setData({ beforeMoodNote: event.detail.value });
  },
  focusBeforeMoodNote() { this.setData({ beforeMoodNoteFocused: true }); },
  blurBeforeMoodNote() { this.setData({ beforeMoodNoteFocused: false }); },
  async confirmBeforeMood() {
    if (!this.data.moodSheetOpen || this.data.saving || this.data.loading || this.data.loadError || !this._moodPlan) return;
    const plan = JSON.parse(JSON.stringify(this._moodPlan));
    const option = this.data.beforeMoodOptions.find(item => item.value === this.data.selectedBeforeMood);
    plan.beforeMood = option ? option.value : '';
    plan.beforeMoodNote = this.data.beforeMoodNote;
    this.setData({ saving: true, saveError: '', saveConflict: false });
    try {
      await getApp().savePlan(plan);
      this.renderToday();
      this.setData({ moodSheetOpen: false, beforeMoodNoteFocused: false });
    } catch (error) {
      const message = error.message || '保存失败，请重试。';
      this.setData({ saveError: message, saveConflict: ['VERSION_CONFLICT', 'DAY_VERSION_CONFLICT'].includes(error.code) });
      wx.showToast({ title: message, icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },
  closeBeforeMood() {
    if (!this.data.saving) this.setData({ moodSheetOpen: false, beforeMoodNoteFocused: false });
  },
  afterMoodLeave() {
    if (this.data.saving) {
      this.setData({ moodSheetOpen: true });
      return;
    }
    this._moodPlan = null;
    this.setData({ moodSheetOpen: false, moodPlanId: null, beforeMoodNoteFocused: false });
  },
  onArtError(event) {
    this.setData({ ['artFailed.' + event.currentTarget.dataset.kind]: true });
  }
});
