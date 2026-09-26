const { currentMonday, nextMonday, weekPreview } = require('../../utils/week-preview');
Page({
  data: {
    days: [], selectedDate: '', title: '本周计划', range: '', isCurrentWeek: true, isNextWeek: false, artFailed: false,
    adding: false, activities: ['瑜伽', '跑步', '力量训练', '徒步', '网球', '散步'],
    draft: { date: '', activity: '', startTime: '' }, canConfirm: false
  },
  onLoad() {
    this._plans = [];
    const now = new Date();
    this.renderWeek(currentMonday(now), now);
  },
  renderWeek(value, now) {
    const preview = weekPreview(value, now || new Date());
    preview.days = preview.days.map(day => Object.assign({}, day, {
      plans: this._plans.filter(plan => plan.date === day.date)
    }));
    this.setData(preview);
  },
  showCurrentWeek() {
    const now = new Date();
    this.renderWeek(currentMonday(now), now);
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  showNextWeek() {
    const now = new Date();
    this.renderWeek(nextMonday(now), now);
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  selectWeek(event) {
    this.renderWeek(event.detail.value);
  },
  startAdding() {
    this.setData({ adding: true, draft: { date: this.data.selectedDate, activity: '', startTime: '' }, canConfirm: false });
  },
  updateDraft(change) {
    const draft = Object.assign({}, this.data.draft, change);
    const canConfirm = Boolean(draft.date && this.data.activities.includes(draft.activity) && /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.startTime));
    this.setData({ draft, canConfirm });
  },
  selectPlanDate(event) { this.updateDraft({ date: event.detail.value }); },
  selectActivity(event) { this.updateDraft({ activity: this.data.activities[Number(event.detail.value)] || '' }); },
  selectStartTime(event) { this.updateDraft({ startTime: event.detail.value }); },
  cancelAdding() {
    this.setData({ adding: false, draft: { date: '', activity: '', startTime: '' }, canConfirm: false });
  },
  confirmAdding() {
    if (!this.data.adding || !this.data.canConfirm) return;
    const plan = Object.assign({ id: this._plans.length + 1 }, this.data.draft);
    this._plans.push(plan);
    this.cancelAdding();
    this.renderWeek(plan.date);
  },
  onArtError() { this.setData({ artFailed: true }); }
});
