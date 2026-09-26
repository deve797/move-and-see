const formatRunningPace = require('../../utils/running-pace');
const runningFields = [
  { key: 'durationMinutes', label: '时长', unit: '分钟' },
  { key: 'distanceKm', label: '距离', unit: '公里' },
  { key: 'heartRate', label: '心率', unit: '次/分钟' }
];
function runningValues(source = {}) {
  const values = {};
  runningFields.forEach(field => {
    values[field.key] = source[field.key] === undefined ? '' : String(source[field.key]).trim();
  });
  return values;
}
function runningError(values) {
  for (const field of runningFields) {
    const value = values[field.key];
    if (value !== '' && (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(Number(value)))) {
      return field.label + '请填写非负数字，或留空';
    }
  }
  return '';
}
function canCorrect(plan) {
  return Boolean(plan && !plan.cancelled && plan.result && !plan.result.makeup && ['completed', 'incomplete'].includes(plan.result.status));
}
function todayDate() {
  return new Date(new Date().getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function canMakeup(plan) {
  return Boolean(plan && !plan.cancelled && plan.result && plan.result.status === 'incomplete' && !plan.result.makeup && plan.date <= todayDate());
}
function validMakeupDate(value, planDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= planDate && value <= todayDate();
}
Page({
  data: {
    plan: null, completed: false, canComplete: false, artFailed: false,
    incomplete: false, recordingIncomplete: false, selectedReason: '', canConfirmIncomplete: false,
    replacement: false, recordingReplacement: false, actualActivity: '', canConfirmReplacement: false,
    makeup: null, canMakeup: false, recordingMakeup: false, makeupDate: '', makeupActivity: '',
    makeupActivityIndex: 0, canConfirmMakeup: false, makeupEndDate: '',
    replacementActivities: ['瑜伽', '跑步', '力量训练', '徒步', '网球', '散步'], replacementActivityIndex: 0,
    reasonOptions: ['加班', '下雨', '身体不适', '临时有事', '其他'],
    feelingOptions: ['轻松', '适中', '吃力'], selectedFeeling: '',
    runningFields, isRunning: false, runningData: runningValues(), runningError: '', runningPace: '',
    canCorrect: false, correcting: false, correctionStatus: '', correctionReason: '', canConfirmCorrection: false
  },
  onLoad(query) {
    this.planId = Number(query.planId);
  },
  onShow() { this.refreshPlan(); },
  refreshPlan() {
    const plan = getApp().globalData.plans.find(item => item.id === this.planId && !item.cancelled);
    const result = plan && plan.result;
    const makeup = result && result.status === 'incomplete' ? result.makeup || null : null;
    this.feelingResult = makeup || result;
    this.feelingPlanResult = result;
    this.runningResult = plan && plan.result;
    const runningData = runningValues(plan && plan.activity === '跑步' && plan.result && plan.result.status === 'completed' ? plan.result.runningData : undefined);
    this.setData({
      plan: plan ? { id: plan.id, activity: plan.activity, date: plan.date, startTime: plan.startTime, result: plan.result || null } : null,
      completed: Boolean(plan && plan.result && plan.result.status === 'completed'),
      replacement: Boolean(plan && plan.result && plan.result.status === 'replacement'),
      makeup, canMakeup: canMakeup(plan), recordingMakeup: false, makeupDate: '', makeupActivity: '',
      makeupActivityIndex: 0, canConfirmMakeup: false, makeupEndDate: todayDate(),
      recordingReplacement: false, actualActivity: '', canConfirmReplacement: false, replacementActivityIndex: 0,
      selectedFeeling: (makeup || (result && result.status === 'completed')) && this.data.feelingOptions.includes(this.feelingResult.feeling) ? this.feelingResult.feeling : '',
      canComplete: Boolean(plan && !plan.result),
      isRunning: Boolean(plan && plan.activity === '跑步' && (!plan.result || plan.result.status !== 'replacement')),
      runningData,
      runningPace: formatRunningPace(runningData.durationMinutes, runningData.distanceKm),
      runningError: '',
      incomplete: Boolean(plan && plan.result && plan.result.status === 'incomplete'),
      selectedReason: plan && plan.result && plan.result.status === 'incomplete' ? plan.result.reason : '',
      recordingIncomplete: false, canConfirmIncomplete: false,
      canCorrect: canCorrect(plan), correcting: false, correctionStatus: '', correctionReason: '', canConfirmCorrection: false
    });
  },
  selectFeeling(event) {
    const feeling = event.currentTarget.dataset.feeling;
    if (this.data.correcting || this.data.recordingMakeup || (feeling !== '' && !this.data.feelingOptions.includes(feeling))) return;
    const plan = getApp().globalData.plans.find(item => item.id === this.planId && !item.cancelled);
    const result = plan && plan.result;
    const motion = result && (result.status === 'completed' ? result : result.status === 'incomplete' ? result.makeup : null);
    if (motion && result === this.feelingPlanResult && motion === this.feelingResult) {
      motion.feeling = feeling;
      this.setData({ selectedFeeling: feeling });
      return;
    }
    this.refreshPlan();
  },
  inputRunningData(event) {
    const field = event.currentTarget.dataset.field;
    if (!this.data.isRunning || this.data.recordingReplacement || this.data.recordingIncomplete || this.data.correcting || this.data.incomplete || !runningFields.some(item => item.key === field)) return;
    const values = { ...this.data.runningData, [field]: event.detail.value };
    this.setData({
      runningData: values, runningError: runningError(runningValues(values)),
      runningPace: formatRunningPace(values.durationMinutes, values.distanceKm)
    });
  },
  confirmRunningData() {
    if (this.data.correcting || !this.data.completed) return;
    const plan = getApp().globalData.plans.find(item => item.id === this.planId && !item.cancelled);
    if (!plan || plan.activity !== '跑步' || !plan.result || plan.result.status !== 'completed' || plan.result !== this.runningResult) {
      this.refreshPlan();
      return;
    }
    const values = runningValues(this.data.runningData);
    const error = runningError(values);
    this.setData({ runningError: error });
    if (error) return;
    plan.result.runningData = values;
    this.refreshPlan();
    wx.showToast({ title: '已记下本次跑步数据', icon: 'none' });
  },
  startCorrection() {
    this.refreshPlan();
    if (!this.data.canCorrect) return;
    const result = this.data.plan.result;
    const reason = result.status === 'incomplete' ? result.reason : '';
    this.setData({
      correcting: true, correctionStatus: result.status, correctionReason: reason,
      canConfirmCorrection: result.status === 'completed' || this.data.reasonOptions.includes(reason)
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  selectCorrectionStatus(event) {
    const status = event.currentTarget.dataset.status;
    if (!this.data.correcting || !['completed', 'incomplete'].includes(status) || status === this.data.correctionStatus) return;
    this.setData({ correctionStatus: status, correctionReason: '', canConfirmCorrection: status === 'completed' });
  },
  selectCorrectionReason(event) {
    const reason = event.currentTarget.dataset.reason;
    if (!this.data.correcting || this.data.correctionStatus !== 'incomplete' || !this.data.reasonOptions.includes(reason)) return;
    this.setData({ correctionReason: reason, canConfirmCorrection: true });
  },
  cancelCorrection() { this.refreshPlan(); },
  confirmCorrection() {
    if (!this.data.correcting) return;
    const plan = getApp().globalData.plans.find(item => item.id === this.planId);
    if (!canCorrect(plan)) {
      this.refreshPlan();
      return;
    }
    const status = this.data.correctionStatus;
    const reason = this.data.correctionReason;
    if (status !== 'completed' && !(status === 'incomplete' && this.data.reasonOptions.includes(reason))) return;
    if (status !== plan.result.status || (status === 'incomplete' && reason !== plan.result.reason)) {
      plan.result = status === 'completed' ? { status } : { status, reason };
    }
    this.refreshPlan();
  },
  startIncomplete() {
    this.refreshPlan();
    if (!this.data.canComplete) return;
    this.setData({ recordingIncomplete: true });
  },
  cancelIncomplete() { this.refreshPlan(); },
  selectReason(event) {
    const reason = event.currentTarget.dataset.reason;
    if (!this.data.recordingIncomplete || !this.data.reasonOptions.includes(reason)) return;
    this.setData({ selectedReason: reason, canConfirmIncomplete: true });
  },
  confirmIncomplete() {
    if (!this.data.recordingIncomplete || !this.data.reasonOptions.includes(this.data.selectedReason)) return;
    const plan = getApp().globalData.plans.find(item => item.id === this.planId && !item.cancelled);
    if (plan && !plan.result) plan.result = { status: 'incomplete', reason: this.data.selectedReason };
    this.refreshPlan();
  },
  startMakeup() {
    this.refreshPlan();
    if (!this.data.canMakeup) return;
    this.makeupResult = this.data.plan.result;
    this.makeupReason = this.makeupResult.reason;
    this.setData({ recordingMakeup: true });
  },
  updateMakeupDraft(change) {
    if (!this.data.recordingMakeup) return;
    const date = change.makeupDate === undefined ? this.data.makeupDate : change.makeupDate;
    const activity = change.makeupActivity === undefined ? this.data.makeupActivity : change.makeupActivity;
    this.setData({ ...change, canConfirmMakeup: validMakeupDate(date, this.data.plan.date) && this.data.replacementActivities.includes(activity) });
  },
  selectMakeupDate(event) { this.updateMakeupDraft({ makeupDate: event.detail.value }); },
  selectMakeupActivity(event) {
    const index = Number(event.detail.value);
    const activity = this.data.replacementActivities[index] || '';
    this.updateMakeupDraft({ makeupActivity: activity, makeupActivityIndex: activity ? index : 0 });
  },
  cancelMakeup() { this.refreshPlan(); },
  confirmMakeup() {
    if (!this.data.recordingMakeup) return;
    const plan = getApp().globalData.plans.find(item => item.id === this.planId);
    if (!canMakeup(plan) || plan.result !== this.makeupResult || plan.result.reason !== this.makeupReason) {
      this.refreshPlan();
      return;
    }
    if (!validMakeupDate(this.data.makeupDate, plan.date) || !this.data.replacementActivities.includes(this.data.makeupActivity)) return;
    plan.result.makeup = { date: this.data.makeupDate, actualActivity: this.data.makeupActivity };
    this.refreshPlan();
  },
  startReplacement() {
    this.refreshPlan();
    if (!this.data.canComplete) return;
    this.setData({ recordingReplacement: true });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  cancelReplacement() { this.refreshPlan(); },
  selectReplacementActivity(event) {
    if (!this.data.recordingReplacement) return;
    const index = Number(event.detail.value);
    const actualActivity = this.data.replacementActivities[index] || '';
    this.setData({ actualActivity, replacementActivityIndex: actualActivity ? index : 0, canConfirmReplacement: Boolean(actualActivity) });
  },
  confirmReplacement() {
    if (!this.data.recordingReplacement || !this.data.replacementActivities.includes(this.data.actualActivity)) return;
    const plan = getApp().globalData.plans.find(item => item.id === this.planId && !item.cancelled);
    if (plan && !plan.result) plan.result = { status: 'replacement', actualActivity: this.data.actualActivity };
    this.refreshPlan();
  },
  confirmCompleted() {
    if (this.data.recordingReplacement) return;
    const plan = getApp().globalData.plans.find(item => item.id === this.planId && !item.cancelled);
    if (plan && !plan.result) {
      const values = runningValues(this.data.runningData);
      const error = plan.activity === '跑步' ? runningError(values) : '';
      this.setData({ runningError: error });
      if (error) return;
      plan.result = { status: 'completed' };
      if (plan.activity === '跑步') plan.result.runningData = values;
    }
    this.refreshPlan();
  },
  onArtError() { this.setData({ artFailed: true }); }
});
