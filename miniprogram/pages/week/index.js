const { currentMonday, nextMonday, weekPreview } = require('../../utils/week-preview');
const { resultCategory, actualExerciseDate } = require('../../utils/exercise-result');
const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
const MINUTES = ['00', '10', '20', '30', '40', '50'];
function isFuture(plan, now) {
  return new Date(plan.date + 'T' + plan.startTime + ':00+08:00').getTime() > now.getTime();
}
function canEdit(plan, now) {
  return Boolean(plan && !plan.cancelled && !plan.result && isFuture(plan, now));
}
Page({
  onShareAppMessage: require('../../utils/share'),
  data: {
    days: [], selectedDate: '', title: '本周计划', range: '', isCurrentWeek: true, isNextWeek: false,
    loading: true, loadError: '', saving: false, saveError: '', saveConflict: false,
    adding: false, activities: ['瑜伽', '跑步', '力量训练', '徒步', '网球', '散步'],
    draft: { date: '', activity: '', startTime: '' }, canConfirm: false, editingId: null, activityIndex: 0,
    draftDateLabel: '', startTimeOptions: [HOURS.map(hour => hour + '时'), MINUTES.map(minute => minute + '分')], startTimeIndex: [0, 0]
  },
  onLoad() {
    this.setData({ selectedDate: currentMonday(new Date()) });
  },
  async onShow() {
    if (this.data.saving) return;
    this.setData({ loading: true, loadError: '' });
    try {
      await getApp().loadData();
      this.renderWeek(this.data.selectedDate);
      this.setData({ saveError: '', saveConflict: false });
    } catch (error) {
      this.setData({ loadError: error.message || '暂时无法读取安排，请重试。' });
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
        this.cancelAdding();
        this._editingPlan = null;
        await this.onShow();
      }
    });
  },
  renderWeek(value, now) {
    now = now || new Date();
    const preview = weekPreview(value, now);
    this._plans = getApp().globalData.plans;
    preview.days = preview.days.map(day => Object.assign({}, day, {
      periodWalk: getApp().getDay(day.date).periodWalk || null,
      plans: this._plans.filter(plan => plan.date === day.date && !plan.cancelled).map(plan => Object.assign({}, plan, {
        resultCategory: resultCategory(plan), actualDate: actualExerciseDate(plan),
        actualActivity: plan.result && (plan.result.makeup ? plan.result.makeup.actualActivity : plan.result.status === 'replacement' ? plan.result.actualActivity : plan.activity),
        editable: canEdit(plan, now),
        periodExempt: (getApp().globalData.periodDays || {})[plan.date] === true,
        pendingRecord: !plan.result && !isFuture(plan, now) && (getApp().globalData.periodDays || {})[plan.date] !== true
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
  selectWeek(event) { this.renderWeek(event.detail.value); },
  startAdding(event) {
    if (this.data.loading || this.data.loadError || this.data.saving) return;
    const day = this.data.days.find(item => item.date === event.currentTarget.dataset.date);
    if (!day) return;
    this._editingPlan = { id: getApp().newPlanId(), version: 0 };
    this.setData({ adding: true, editingId: null, activityIndex: 0, draft: { date: day.date, activity: '', startTime: '' }, draftDateLabel: day.weekday + ' · ' + day.date, startTimeIndex: [0, 0], canConfirm: false, saveError: '', saveConflict: false });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  startEditing(event) {
    if (this.data.saving) return;
    const plan = this._plans.find(item => String(item.id) === String(event.currentTarget.dataset.id));
    if (!canEdit(plan, new Date())) {
      this.renderWeek(this.data.selectedDate);
      return;
    }
    this._editingPlan = JSON.parse(JSON.stringify(plan));
    this._editingPlan._dayVersion = getApp().getDay(plan.date).version;
    this.setData({ adding: true, editingId: plan.id, draft: { date: plan.date, activity: plan.activity, startTime: plan.startTime }, canConfirm: true, saveError: '', saveConflict: false });
    this.updateDraft({});
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  cancelPlan(event) {
    if (this.data.saving) return;
    const plan = this._plans.find(item => String(item.id) === String(event.currentTarget.dataset.id));
    if (!canEdit(plan, new Date())) {
      this.renderWeek(this.data.selectedDate);
      return;
    }
    const proposed = JSON.parse(JSON.stringify(plan));
    proposed._dayVersion = getApp().getDay(plan.date).version;
    wx.showModal({
      title: '取消这条安排？',
      content: plan.date + ' ' + plan.startTime + ' ' + plan.activity + '，取消后将不再显示在计划列表中。',
      confirmText: '取消安排',
      cancelText: '保留安排',
      success: async res => {
        if (!res.confirm || this.data.saving) return;
        const current = getApp().globalData.plans.find(item => String(item.id) === String(proposed.id));
        if (!canEdit(current, new Date())) {
          wx.showToast({ title: '该安排已开始、已有结果或已取消，不能取消', icon: 'none' });
          this.renderWeek(this.data.selectedDate);
          return;
        }
        proposed.cancelled = true;
        if (await this.persistPlan(proposed)) this.renderWeek(this.data.selectedDate);
      }
    });
  },
  updateDraft(change) {
    if (this.data.saving) return;
    const draft = Object.assign({}, this.data.draft, change);
    const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.startTime);
    const canConfirm = Boolean(draft.date && this.data.activities.includes(draft.activity) && validTime && (this.data.editingId === null || isFuture(draft, new Date())));
    const startTimeIndex = validTime ? [Number(draft.startTime.slice(0, 2)), Math.floor(Number(draft.startTime.slice(3)) / 10)] : [0, 0];
    this.setData({ draft, canConfirm, startTimeIndex, activityIndex: Math.max(0, this.data.activities.indexOf(draft.activity)) });
  },
  selectPlanDate(event) {
    if (this.data.saving || this.data.editingId === null) return;
    const date = event.detail.value;
    if (this._editingPlan && this._editingPlan.date !== date) this._draftDayVersion = getApp().getDay(date).version;
    this.updateDraft({ date });
  },
  selectActivity(event) { this.updateDraft({ activity: this.data.activities[Number(event.detail.value)] || '' }); },
  selectStartTime(event) {
    const hour = HOURS[event.detail.value[0]];
    const minute = MINUTES[event.detail.value[1]];
    this.updateDraft({ startTime: hour && minute ? hour + ':' + minute : '' });
  },
  cancelAdding() {
    if (this.data.saving) return;
    this._editingPlan = null;
    this.setData({ adding: false, editingId: null, draft: { date: '', activity: '', startTime: '' }, canConfirm: false, saveError: '', saveConflict: false });
  },
  async persistPlan(plan) {
    if (this.data.saving) return false;
    this.setData({ saving: true, saveError: '', saveConflict: false });
    try {
      await getApp().savePlan(plan);
      return true;
    } catch (error) {
      const message = error.message || '保存失败，请重试。';
      this.setData({ saveError: message, saveConflict: ['VERSION_CONFLICT', 'DAY_VERSION_CONFLICT'].includes(error.code) });
      wx.showToast({ title: message, icon: 'none' });
      return false;
    } finally {
      this.setData({ saving: false });
    }
  },
  async confirmAdding() {
    if (!this.data.adding || !this.data.canConfirm || this.data.saving || !this._editingPlan) return;
    if (this.data.editingId !== null && !canEdit(this._editingPlan, new Date())) {
      wx.showToast({ title: '该安排已开始或已有结果，不能修改', icon: 'none' });
      return;
    }
    this.updateDraft({});
    if (!this.data.canConfirm) return;
    const plan = Object.assign({}, this._editingPlan, this.data.draft);
    if (this.data.editingId !== null && plan.date !== this._editingPlan.date) plan._dayVersion = this._draftDayVersion;
    if (await this.persistPlan(plan)) {
      this.cancelAdding();
      this.renderWeek(plan.date);
    }
  }
});
