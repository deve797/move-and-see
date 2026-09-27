const moods = require('../../utils/mood-options');
const { actualExerciseDate } = require('../../utils/exercise-result');

Page({
  onShareAppMessage: require('../../utils/share'),
  data: {
    plan: null, loading: true, loadError: '', saving: false, saveError: '', saveConflict: false,
    isMakeup: false,
    selectedMood: '',
    note: '',
    noteFocused: false,
    moods
  },
  onLoad(query) {
    this.planId = String(query.planId);
    this.setData({ isMakeup: query.makeup === '1' });
  },
  async onShow() {
    if (this.data.saving) return;
    this.setData({ loading: true, loadError: '' });
    try {
      await getApp().loadData();
      const result = this._plan && (this.data.isMakeup ? this._plan.result.makeup : this._plan.result);
      const keepDraft = result && (this.data.saveError || this.data.selectedMood !== (result.afterMood || '') || this.data.note !== (result.afterMoodNote || ''));
      // 未确认内容保留原计划版本，不能在刷新时静默覆盖另一端已保存的感受。
      if (!keepDraft) this.renderMood();
    } catch (error) {
      this.setData({ loadError: error.message || '暂时无法读取感受，请重试。' });
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
        this.setData({ plan: null, selectedMood: '', note: '', noteFocused: false, saveError: '', saveConflict: false });
        await this.onShow();
      }
    });
  },
  renderMood() {
    const isMakeup = this.data.isMakeup;
    const source = getApp().globalData.plans.find(item => String(item.id) === this.planId && !item.cancelled && item.result && (isMakeup ? item.result.status === 'incomplete' && item.result.makeup : item.result.status === 'completed'));
    const plan = source ? JSON.parse(JSON.stringify(source)) : null;
    if (plan) plan._dayVersion = getApp().getDay(plan.date).version;
    this._plan = plan;
    const result = plan ? (isMakeup ? plan.result.makeup : plan.result) : null;
    const option = result && moods.find(item => item.value === result.afterMood);
    this.setData({
      plan: plan ? { id: plan.id, activity: isMakeup ? result.actualActivity : plan.activity, date: actualExerciseDate(plan) || plan.date, startTime: isMakeup || actualExerciseDate(plan) ? '' : plan.startTime } : null,
      selectedMood: option ? option.value : '',
      note: result ? result.afterMoodNote || '' : '',
      noteFocused: false, saveError: '', saveConflict: false
    });
  },
  selectMood(event) {
    const value = event.currentTarget.dataset.value;
    if (this.data.saving || !moods.some(item => item.value === value)) return;
    this.setData({ selectedMood: value });
  },
  inputNote(event) {
    if (!this.data.saving) this.setData({ note: event.detail.value });
  },
  focusNote() { this.setData({ noteFocused: true }); },
  blurNote() { this.setData({ noteFocused: false }); },
  async confirmMood() {
    if (!this._plan || this.data.saving || this.data.loading || this.data.loadError) return;
    const plan = JSON.parse(JSON.stringify(this._plan));
    const result = this.data.isMakeup ? plan.result.makeup : plan.result;
    const option = moods.find(item => item.value === this.data.selectedMood);
    result.afterMood = option ? option.value : '';
    result.afterMoodNote = this.data.note;
    this.setData({ saving: true, saveError: '', saveConflict: false });
    let saved = false;
    try {
      await getApp().savePlan(plan);
      this._plan = null;
      saved = true;
    } catch (error) {
      const message = error.message || '保存失败，请重试。';
      this.setData({ saveError: message, saveConflict: ['VERSION_CONFLICT', 'DAY_VERSION_CONFLICT'].includes(error.code) });
      wx.showToast({ title: message, icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
    if (saved) this.goBack();
  },
  goBack() {
    if (this.data.saving) return;
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/today/index' });
  }
});
