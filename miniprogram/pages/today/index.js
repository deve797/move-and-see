const moodOptions = require('../../utils/mood-options');
const weeklyProgress = require('../../utils/weekly-progress');
Page({
  data: {
    activities: [], date: '', artFailed: {}, periodMarked: false, periodWalk: null,
    weeklyProgress: { completed: 0, total: 0 },
    moodSheetOpen: false, moodPlanId: null,
    moodActivityName: '', moodActivityTime: '', selectedBeforeMood: '',
    beforeMoodNote: '', beforeMoodNoteFocused: false,
    beforeMoodOptions: moodOptions
  },
  onShow() {
    const date = new Date(new Date().getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const periodMarked = (getApp().globalData.periodDays || {})[date] === true;
    const activities = getApp().globalData.plans
      .filter(plan => plan.date === date && !plan.cancelled)
      .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.id - b.id)
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
      weeklyProgress: weeklyProgress(getApp().globalData.plans, getApp().globalData.periodDays || {}, date),
      periodWalk: periodMarked ? (getApp().globalData.periodWalks || {})[date] || null : null,
      moodSheetOpen: false, moodPlanId: null,
      moodActivityName: '', moodActivityTime: '', selectedBeforeMood: '',
      beforeMoodNote: '', beforeMoodNoteFocused: false
    });
  },
  setPeriod(event) {
    const date = new Date(new Date().getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (date !== this.data.date) {
      this.onShow();
      return;
    }
    const marked = event.currentTarget.dataset.marked;
    if (typeof marked !== 'boolean') return;
    const data = getApp().globalData;
    const days = data.periodDays || (data.periodDays = {});
    if (marked) days[date] = true;
    else delete days[date];
    this.onShow();
  },
  choosePeriodWalk() {
    const date = new Date(new Date().getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const data = getApp().globalData;
    if (date === this.data.date && (data.periodDays || {})[date] === true) {
      const walks = data.periodWalks || (data.periodWalks = {});
      if (!walks[date]) walks[date] = { status: 'pending' };
    }
    this.onShow();
  },
  recordPeriodWalk(event) {
    const date = new Date(new Date().getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const data = getApp().globalData;
    const walk = (data.periodWalks || {})[date];
    const status = event.currentTarget.dataset.status;
    if (date === this.data.date && (data.periodDays || {})[date] === true && walk && ['completed', 'incomplete'].includes(status)) {
      walk.status = status;
    }
    this.onShow();
  },
  openBeforeMood(event) {
    if (this.data.moodPlanId !== null) return;
    const activity = this.data.activities.find(item => item.id === Number(event.currentTarget.dataset.id));
    if (!activity) return;
    this.setData({
      moodSheetOpen: true, moodPlanId: activity.id,
      moodActivityName: activity.name, moodActivityTime: activity.time,
      selectedBeforeMood: activity.beforeMood,
      beforeMoodNote: activity.beforeMoodNote, beforeMoodNoteFocused: false
    });
  },
  selectBeforeMood(event) {
    if (!this.data.moodSheetOpen) return;
    const option = this.data.beforeMoodOptions.find(item => item.value === event.currentTarget.dataset.value);
    if (!option) return;
    this.setData({ selectedBeforeMood: option.value });
  },
  inputBeforeMoodNote(event) {
    this.setData({ beforeMoodNote: event.detail.value });
  },
  focusBeforeMoodNote() {
    this.setData({ beforeMoodNoteFocused: true });
  },
  blurBeforeMoodNote() {
    this.setData({ beforeMoodNoteFocused: false });
  },
  confirmBeforeMood() {
    if (!this.data.moodSheetOpen) return;
    const plan = getApp().globalData.plans.find(item => item.id === this.data.moodPlanId && !item.cancelled);
    if (!plan) {
      this.closeBeforeMood();
      return;
    }
    const option = this.data.beforeMoodOptions.find(item => item.value === this.data.selectedBeforeMood);
    plan.beforeMood = option ? option.value : '';
    plan.beforeMoodNote = this.data.beforeMoodNote;
    this.setData({
      activities: this.data.activities.map(item => item.id === plan.id ? Object.assign({}, item, {
        beforeMood: plan.beforeMood, beforeMoodLabel: option ? option.label : '',
        beforeMoodNote: plan.beforeMoodNote
      }) : item),
      moodSheetOpen: false, beforeMoodNoteFocused: false
    });
  },
  closeBeforeMood() {
    this.setData({ moodSheetOpen: false, beforeMoodNoteFocused: false });
  },
  afterMoodLeave() {
    this.setData({ moodSheetOpen: false, moodPlanId: null, beforeMoodNoteFocused: false });
  },
  onArtError(event) {
    this.setData({ ['artFailed.' + event.currentTarget.dataset.kind]: true });
  }
});
