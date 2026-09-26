const { currentMonday, nextMonday, weekPreview } = require('../../utils/week-preview');
function isFuture(plan, now) {
  return new Date(plan.date + 'T' + plan.startTime + ':00+08:00').getTime() > now.getTime();
}
function canEdit(plan, now) {
  return Boolean(plan && !plan.cancelled && !plan.result && isFuture(plan, now));
}
Page({
  data: {
    days: [], selectedDate: '', title: '本周计划', range: '', isCurrentWeek: true, isNextWeek: false, artFailed: false,
    adding: false, activities: ['瑜伽', '跑步', '力量训练', '徒步', '网球', '散步'],
    draft: { date: '', activity: '', startTime: '' }, canConfirm: false, editingId: null, activityIndex: 0
  },
  onLoad() {
    this._plans = getApp().globalData.plans;
    const now = new Date();
    this.renderWeek(currentMonday(now), now);
  },
  onShow() {
    this.renderWeek(this.data.selectedDate);
  },
  renderWeek(value, now) {
    now = now || new Date();
    const preview = weekPreview(value, now);
    preview.days = preview.days.map(day => Object.assign({}, day, {
      plans: this._plans.filter(plan => plan.date === day.date && !plan.cancelled).map(plan => Object.assign({}, plan, {
        editable: canEdit(plan, now),
        pendingRecord: !plan.result && !isFuture(plan, now)
      }))
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
    this.setData({ adding: true, editingId: null, activityIndex: 0, draft: { date: this.data.selectedDate, activity: '', startTime: '' }, canConfirm: false });
  },
  startEditing(event) {
    const plan = this._plans.find(item => item.id === Number(event.currentTarget.dataset.id));
    if (!canEdit(plan, new Date())) {
      this.renderWeek(this.data.selectedDate);
      return;
    }
    this.setData({ adding: true, editingId: plan.id, draft: { date: plan.date, activity: plan.activity, startTime: plan.startTime }, canConfirm: true });
    this.updateDraft({});
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  cancelPlan(event) {
    const id = Number(event.currentTarget.dataset.id);
    const plan = this._plans.find(item => item.id === id);
    if (!canEdit(plan, new Date())) {
      this.renderWeek(this.data.selectedDate);
      return;
    }
    wx.showModal({
      title: '取消这条安排？',
      content: plan.date + ' ' + plan.startTime + ' ' + plan.activity + '，取消后将不再显示在计划列表中。',
      confirmText: '取消安排',
      cancelText: '保留安排',
      success: res => {
        if (!res.confirm) return;
        const current = this._plans.find(item => item.id === id);
        if (!canEdit(current, new Date())) {
          wx.showToast({ title: '该安排已开始、已有结果或已取消，不能取消', icon: 'none' });
          this.renderWeek(this.data.selectedDate);
          return;
        }
        current.cancelled = true;
        this.renderWeek(this.data.selectedDate);
      }
    });
  },
  updateDraft(change) {
    const draft = Object.assign({}, this.data.draft, change);
    const canConfirm = Boolean(draft.date && this.data.activities.includes(draft.activity) && /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.startTime) && (this.data.editingId === null || isFuture(draft, new Date())));
    this.setData({ draft, canConfirm, activityIndex: Math.max(0, this.data.activities.indexOf(draft.activity)) });
  },
  selectPlanDate(event) { this.updateDraft({ date: event.detail.value }); },
  selectActivity(event) { this.updateDraft({ activity: this.data.activities[Number(event.detail.value)] || '' }); },
  selectStartTime(event) { this.updateDraft({ startTime: event.detail.value }); },
  cancelAdding() {
    this.setData({ adding: false, editingId: null, draft: { date: '', activity: '', startTime: '' }, canConfirm: false });
  },
  confirmAdding() {
    if (!this.data.adding || !this.data.canConfirm) return;
    if (this.data.editingId !== null) {
      const plan = this._plans.find(item => item.id === this.data.editingId);
      if (!canEdit(plan, new Date())) {
        wx.showToast({ title: '该安排已开始或已有结果，不能修改', icon: 'none' });
        this.cancelAdding();
        this.renderWeek(this.data.selectedDate);
        return;
      }
      this.updateDraft({});
      if (!this.data.canConfirm) return;
      Object.assign(plan, this.data.draft);
      this.cancelAdding();
      this.renderWeek(plan.date);
      return;
    }
    const plan = Object.assign({ id: this._plans.length + 1 }, this.data.draft);
    this._plans.push(plan);
    this.cancelAdding();
    this.renderWeek(plan.date);
  },
  onArtError() { this.setData({ artFailed: true }); }
});
