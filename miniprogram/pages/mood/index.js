const moods = require('../../utils/mood-options');

Page({
  data: {
    plan: null,
    isMakeup: false,
    selectedMood: '',
    note: '',
    noteFocused: false,
    moods
  },
  onLoad(query) {
    this.planId = Number(query.planId);
    this.setData({ isMakeup: query.makeup === '1' });
  },
  onShow() {
    const isMakeup = this.data.isMakeup;
    const plan = getApp().globalData.plans.find(item => item.id === this.planId && !item.cancelled && item.result && (isMakeup ? item.result.status === 'incomplete' && item.result.makeup : item.result.status === 'completed'));
    this.originalResult = plan ? plan.result : null;
    this.result = plan ? (isMakeup ? plan.result.makeup : plan.result) : null;
    this.loadedAfterMood = this.result ? this.result.afterMood : undefined;
    this.loadedAfterMoodNote = this.result ? this.result.afterMoodNote : undefined;
    const option = this.result && moods.find(item => item.value === this.result.afterMood);
    this.setData({
      plan: plan ? { id: plan.id, activity: isMakeup ? this.result.actualActivity : plan.activity, date: isMakeup ? this.result.date : plan.date, startTime: isMakeup ? '' : plan.startTime } : null,
      selectedMood: option ? option.value : '',
      note: this.result ? this.result.afterMoodNote || '' : '',
      noteFocused: false
    });
  },
  selectMood(event) {
    const value = event.currentTarget.dataset.value;
    if (!moods.some(item => item.value === value)) return;
    this.setData({ selectedMood: value });
  },
  inputNote(event) {
    this.setData({ note: event.detail.value });
  },
  focusNote() { this.setData({ noteFocused: true }); },
  blurNote() { this.setData({ noteFocused: false }); },
  confirmMood() {
    if (!this.result) return;
    const plan = getApp().globalData.plans.find(item => item.id === this.planId && !item.cancelled);
    const isMakeup = this.data.isMakeup;
    if (!plan || !plan.result || plan.result !== this.originalResult || (isMakeup ? plan.result.status !== 'incomplete' || plan.result.makeup !== this.result : plan.result.status !== 'completed' || plan.result !== this.result)) {
      this.onShow();
      return;
    }
    if (isMakeup && (this.result.afterMood !== this.loadedAfterMood || this.result.afterMoodNote !== this.loadedAfterMoodNote)) {
      this.onShow();
      return;
    }
    const option = moods.find(item => item.value === this.data.selectedMood);
    this.result.afterMood = option ? option.value : '';
    this.result.afterMoodNote = this.data.note;
    this.result = null;
    this.goBack();
  },
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/today/index' });
  }
});
