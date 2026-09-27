const formatRunningPace = require('../../utils/running-pace');
const { resultCategory, actualExerciseDate } = require('../../utils/exercise-result');
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
function isPeriodExempt(plan) {
  return Boolean(plan && !plan.cancelled && (getApp().globalData.periodDays || {})[plan.date] === true);
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
  onShareAppMessage: require('../../utils/share'),
  data: {
    plan: null, completed: false, canComplete: false, artFailed: false, periodExempt: false,
    loading: true, loadError: '', saving: false, saveError: '', saveConflict: false,
    incomplete: false, recordingIncomplete: false, selectedReason: '', canConfirmIncomplete: false,
    replacement: false, recordingReplacement: false, actualActivity: '', canConfirmReplacement: false,
    actualDate: '', actualDateChosen: false, actualDateValid: false, needsActualDate: false,
    resultActualDate: '', isLateCompletion: false, futurePlan: false,
    makeup: null, canMakeup: false, recordingMakeup: false, makeupDate: '', makeupActivity: '',
    makeupActivityIndex: 0, canConfirmMakeup: false, makeupEndDate: '',
    replacementActivities: ['瑜伽', '跑步', '力量训练', '徒步', '网球', '散步'], replacementActivityIndex: 0,
    reasonOptions: ['加班', '下雨', '身体不适', '临时有事', '其他'],
    feelingOptions: ['轻松', '适中', '吃力'], selectedFeeling: '',
    runningFields, isRunning: false, runningData: runningValues(), runningError: '', runningPace: '',
    canCorrect: false, correcting: false, correctionStatus: '', correctionReason: '', canConfirmCorrection: false
  },
  onLoad(query) { this.planId = String(query.planId); },
  async onShow() {
    if (this.data.saving) return;
    this.setData({ loading: true, loadError: '' });
    try {
      await getApp().loadData();
      const result = this._plan && this._plan.result;
      const savedRunning = runningValues(this._plan && this._plan.activity === '跑步' && result && result.status === 'completed' ? result.runningData : undefined);
      const keepDraft = this._plan && (this.data.saveError || this.data.recordingIncomplete || this.data.recordingReplacement || this.data.recordingMakeup || this.data.correcting ||
        (this.data.actualDateChosen && this.data.actualDate !== (result && result.actualDate || '')) ||
        runningFields.some(field => this.data.runningData[field.key] !== savedRunning[field.key]));
      // 保留输入对应的旧版本；返回时若云端已更新，提交仍需通过版本校验。
      if (!keepDraft) this.refreshPlan();
      else this.syncActualDateState();
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
        this._plan = null;
        this.setData({
          plan: null, recordingIncomplete: false, selectedReason: '', canConfirmIncomplete: false,
          recordingReplacement: false, actualActivity: '', canConfirmReplacement: false,
          recordingMakeup: false, makeupDate: '', makeupActivity: '', canConfirmMakeup: false,
          correcting: false, correctionStatus: '', correctionReason: '', canConfirmCorrection: false,
          actualDate: '', actualDateChosen: false,
          runningData: runningValues(), runningError: '', runningPace: '', saveError: '', saveConflict: false
        });
        await this.onShow();
      }
    });
  },
  refreshPlan() {
    if (this.data.saving) return;
    const source = getApp().globalData.plans.find(item => String(item.id) === this.planId && !item.cancelled);
    const plan = source ? JSON.parse(JSON.stringify(source)) : null;
    if (plan) plan._dayVersion = getApp().getDay(plan.date).version;
    this._plan = plan;
    const result = plan && plan.result;
    const makeup = result && result.status === 'incomplete' ? result.makeup || null : null;
    const motion = makeup || result;
    const runningData = runningValues(plan && plan.activity === '跑步' && result && result.status === 'completed' ? result.runningData : undefined);
    this.setData({
      plan: plan ? { id: plan.id, activity: plan.activity, date: plan.date, startTime: plan.startTime, result: result || null } : null,
      periodExempt: isPeriodExempt(plan),
      completed: Boolean(result && result.status === 'completed'),
      replacement: Boolean(result && result.status === 'replacement'),
      resultActualDate: actualExerciseDate(plan),
      isLateCompletion: Boolean(result && !makeup && resultCategory(plan) === 'makeup'),
      actualDate: result && result.actualDate || (plan && plan.date === todayDate() ? todayDate() : ''),
      actualDateChosen: Boolean(result && result.actualDate),
      makeup, canMakeup: canMakeup(plan), recordingMakeup: false, makeupDate: '', makeupActivity: '',
      makeupActivityIndex: 0, canConfirmMakeup: false, makeupEndDate: todayDate(),
      recordingReplacement: false, actualActivity: '', canConfirmReplacement: false, replacementActivityIndex: 0,
      selectedFeeling: (makeup || (result && result.status === 'completed')) && this.data.feelingOptions.includes(motion.feeling) ? motion.feeling : '',
      canComplete: Boolean(plan && !result && plan.date <= todayDate()),
      isRunning: Boolean(plan && plan.activity === '跑步' && (!result || result.status !== 'replacement')),
      runningData,
      runningPace: formatRunningPace(runningData.durationMinutes, runningData.distanceKm),
      runningError: '', saveError: '', saveConflict: false,
      incomplete: Boolean(result && result.status === 'incomplete'),
      selectedReason: result && result.status === 'incomplete' ? result.reason || '' : '',
      recordingIncomplete: false, canConfirmIncomplete: false,
      canCorrect: canCorrect(plan), correcting: false, correctionStatus: '', correctionReason: '', canConfirmCorrection: false
    });
    this.syncActualDateState();
  },
  syncActualDateState(change = {}) {
    const plan = this.data.plan;
    const today = todayDate();
    const result = plan && plan.result;
    const chosen = change.actualDateChosen === undefined ? this.data.actualDateChosen : change.actualDateChosen;
    const needsActualDate = Boolean(plan && plan.date < today);
    let actualDate = change.actualDate === undefined ? this.data.actualDate : change.actualDate;
    if (needsActualDate && !chosen) actualDate = '';
    if (!chosen && plan && plan.date === today) actualDate = today;
    const actualDateValid = Boolean(plan && validMakeupDate(actualDate, plan.date));
    const needsCorrectionDate = result && (result.status !== 'completed' || result.actualDate || chosen);
    this.setData({
      ...change, actualDate, actualDateChosen: chosen, actualDateValid, needsActualDate,
      makeupEndDate: today, futurePlan: Boolean(plan && plan.date > today),
      canComplete: Boolean(plan && !result && plan.date <= today),
      canConfirmReplacement: Boolean(this.data.actualActivity && actualDateValid),
      canConfirmCorrection: this.data.correctionStatus === 'completed'
        ? !needsCorrectionDate || actualDateValid
        : this.data.periodExempt || this.data.reasonOptions.includes(this.data.correctionReason)
    });
  },
  selectActualDate(event) {
    if (this.data.saving) return;
    this.syncActualDateState({ actualDate: event.detail.value, actualDateChosen: true });
  },
  draftPlan() {
    return this._plan && !this.data.saving && !this.data.loading && !this.data.loadError ? JSON.parse(JSON.stringify(this._plan)) : null;
  },
  async persistPlan(plan) {
    if (!plan || this.data.saving) return false;
    this.setData({ saving: true, saveError: '', saveConflict: false });
    let saved = false;
    try {
      await getApp().savePlan(plan);
      saved = true;
    } catch (error) {
      const message = error.message || '保存失败，请重试。';
      this.setData({ saveError: message, saveConflict: ['VERSION_CONFLICT', 'DAY_VERSION_CONFLICT'].includes(error.code) });
      wx.showToast({ title: message, icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
    if (saved) this.refreshPlan();
    return saved;
  },
  async selectFeeling(event) {
    const feeling = event.currentTarget.dataset.feeling;
    if (this.data.correcting || this.data.recordingMakeup || (feeling !== '' && !this.data.feelingOptions.includes(feeling))) return;
    const plan = this.draftPlan();
    const result = plan && plan.result;
    const motion = result && (result.status === 'completed' ? result : result.status === 'incomplete' ? result.makeup : null);
    if (!motion) return;
    motion.feeling = feeling;
    const runningDraft = { runningData: { ...this.data.runningData }, runningError: this.data.runningError, runningPace: this.data.runningPace };
    if (await this.persistPlan(plan)) this.setData(runningDraft);
  },
  inputRunningData(event) {
    const field = event.currentTarget.dataset.field;
    if (this.data.saving || !this.data.isRunning || this.data.recordingReplacement || this.data.recordingIncomplete || this.data.correcting || this.data.incomplete || !runningFields.some(item => item.key === field)) return;
    const values = { ...this.data.runningData, [field]: event.detail.value };
    this.setData({
      runningData: values, runningError: runningError(runningValues(values)),
      runningPace: formatRunningPace(values.durationMinutes, values.distanceKm)
    });
  },
  async confirmRunningData() {
    if (this.data.correcting || !this.data.completed) return;
    const plan = this.draftPlan();
    if (!plan || plan.activity !== '跑步' || !plan.result || plan.result.status !== 'completed') return;
    const values = runningValues(this.data.runningData);
    const error = runningError(values);
    this.setData({ runningError: error });
    if (error) return;
    plan.result.runningData = values;
    if (await this.persistPlan(plan)) wx.showToast({ title: '已保存本次跑步数据', icon: 'none' });
  },
  startCorrection() {
    if (this.data.saving) return;
    this.refreshPlan();
    if (!this.data.canCorrect) return;
    const result = this.data.plan.result;
    const reason = result.status === 'incomplete' ? result.reason || '' : '';
    this.setData({
      correcting: true, correctionStatus: result.status, correctionReason: reason,
      canConfirmCorrection: result.status === 'completed' || this.data.periodExempt || this.data.reasonOptions.includes(reason)
    });
    this.syncActualDateState();
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  selectCorrectionStatus(event) {
    const status = event.currentTarget.dataset.status;
    if (this.data.saving || !this.data.correcting || !['completed', 'incomplete'].includes(status) || status === this.data.correctionStatus) return;
    this.setData({ correctionStatus: status, correctionReason: '', canConfirmCorrection: status === 'completed' || this.data.periodExempt });
    this.syncActualDateState();
  },
  selectCorrectionReason(event) {
    const reason = event.currentTarget.dataset.reason;
    if (this.data.saving || !this.data.correcting || this.data.correctionStatus !== 'incomplete' || !this.data.reasonOptions.includes(reason)) return;
    this.setData({ correctionReason: reason, canConfirmCorrection: true });
  },
  cancelCorrection() { this.refreshPlan(); },
  async confirmCorrection() {
    if (!this.data.correcting) return;
    const plan = this.draftPlan();
    if (!canCorrect(plan)) return;
    const status = this.data.correctionStatus;
    const reason = this.data.correctionReason;
    this.syncActualDateState();
    if (!this.data.canConfirmCorrection) return;
    if (status !== 'completed' && !(status === 'incomplete' && (this.data.reasonOptions.includes(reason) || (this.data.periodExempt && reason === '')))) return;
    if (status !== plan.result.status || (status === 'incomplete' && reason !== plan.result.reason)) {
      plan.result = status === 'completed' ? { status, actualDate: this.data.actualDate } : { status, reason };
    } else if (status === 'completed' && this.data.actualDateChosen) {
      plan.result.actualDate = this.data.actualDate;
    }
    if (plan.result.status === 'completed' && plan.result.actualDate) this.setData({ actualDateChosen: true });
    await this.persistPlan(plan);
  },
  startIncomplete() {
    if (this.data.saving) return;
    this.refreshPlan();
    if (!this.data.canComplete || this.data.periodExempt) return;
    this.setData({ recordingIncomplete: true });
  },
  cancelIncomplete() { this.refreshPlan(); },
  selectReason(event) {
    const reason = event.currentTarget.dataset.reason;
    if (this.data.saving || !this.data.recordingIncomplete || !this.data.reasonOptions.includes(reason)) return;
    this.setData({ selectedReason: reason, canConfirmIncomplete: true });
  },
  async confirmIncomplete() {
    if (!this.data.recordingIncomplete || this.data.periodExempt || !this.data.reasonOptions.includes(this.data.selectedReason)) return;
    const plan = this.draftPlan();
    if (!plan || plan.result || plan.date > todayDate()) return;
    plan.result = { status: 'incomplete', reason: this.data.selectedReason };
    await this.persistPlan(plan);
  },
  startMakeup() {
    if (this.data.saving) return;
    this.refreshPlan();
    if (!this.data.canMakeup) return;
    this.setData({ recordingMakeup: true });
  },
  updateMakeupDraft(change) {
    if (this.data.saving || !this.data.recordingMakeup) return;
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
  async confirmMakeup() {
    if (!this.data.recordingMakeup) return;
    const plan = this.draftPlan();
    if (!canMakeup(plan) || !validMakeupDate(this.data.makeupDate, plan.date) || !this.data.replacementActivities.includes(this.data.makeupActivity)) return;
    plan.result.makeup = { date: this.data.makeupDate, actualActivity: this.data.makeupActivity };
    await this.persistPlan(plan);
  },
  startReplacement() {
    if (this.data.saving) return;
    const dateDraft = { actualDate: this.data.actualDate, actualDateChosen: this.data.actualDateChosen };
    this.refreshPlan();
    if (!this.data.canComplete) return;
    this.setData({ recordingReplacement: true });
    if (dateDraft.actualDateChosen) this.syncActualDateState(dateDraft);
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  cancelReplacement() { this.refreshPlan(); },
  selectReplacementActivity(event) {
    if (this.data.saving || !this.data.recordingReplacement) return;
    const index = Number(event.detail.value);
    const actualActivity = this.data.replacementActivities[index] || '';
    this.setData({ actualActivity, replacementActivityIndex: actualActivity ? index : 0, canConfirmReplacement: Boolean(actualActivity) });
    this.syncActualDateState();
  },
  async confirmReplacement() {
    if (!this.data.recordingReplacement || !this.data.replacementActivities.includes(this.data.actualActivity)) return;
    const plan = this.draftPlan();
    if (!plan || plan.result) return;
    this.syncActualDateState();
    if (!this.data.actualDateValid) return;
    this.setData({ actualDateChosen: true });
    plan.result = { status: 'replacement', actualActivity: this.data.actualActivity, actualDate: this.data.actualDate };
    await this.persistPlan(plan);
  },
  async confirmCompleted() {
    if (this.data.recordingReplacement || this.data.recordingIncomplete || this.data.correcting || this.data.recordingMakeup) return;
    const plan = this.draftPlan();
    if (!plan || plan.result) return;
    this.syncActualDateState();
    if (!this.data.actualDateValid) {
      wx.showToast({ title: this.data.futurePlan ? '当天才可记录结果' : '请选择实际运动日期', icon: 'none' });
      return;
    }
    const values = runningValues(this.data.runningData);
    const error = plan.activity === '跑步' ? runningError(values) : '';
    this.setData({ runningError: error });
    if (error) return;
    this.setData({ actualDateChosen: true });
    plan.result = { status: 'completed', actualDate: this.data.actualDate };
    if (plan.activity === '跑步') plan.result.runningData = values;
    await this.persistPlan(plan);
  },
  onArtError() { this.setData({ artFailed: true }); }
});
