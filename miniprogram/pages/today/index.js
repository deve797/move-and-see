const moodOptions = require('../../utils/mood-options');
Page({
  data: {
    activities: [], date: '', artFailed: {},
    moodSheetOpen: false, moodPlanId: null,
    moodActivityName: '', moodActivityTime: '', selectedBeforeMood: '',
    beforeMoodNote: '', beforeMoodNoteFocused: false,
    beforeMoodOptions: moodOptions
  },
  onShow() {
    const date = new Date(new Date().getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const activities = getApp().globalData.plans
      .filter(plan => plan.date === date && !plan.cancelled)
      .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.id - b.id)
      .map(plan => {
        const option = moodOptions.find(item => item.value === plan.beforeMood);
        return {
          id: plan.id, name: plan.activity, time: plan.startTime,
          completed: Boolean(plan.result && (['completed', 'replacement'].includes(plan.result.status) || (plan.result.status === 'incomplete' && plan.result.makeup))),
          result: plan.result || null,
          kind: plan.activity === '瑜伽' ? 'yoga' : plan.activity === '跑步' ? 'running' : '',
          beforeMood: option ? option.value : '', beforeMoodLabel: option ? option.label : '',
          beforeMoodNote: plan.beforeMoodNote || ''
        };
      });
    this.setData({
      date, activities, moodSheetOpen: false, moodPlanId: null,
      moodActivityName: '', moodActivityTime: '', selectedBeforeMood: '',
      beforeMoodNote: '', beforeMoodNoteFocused: false
    });
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
