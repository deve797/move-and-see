App({
  globalData: {
    plans: [], periodDays: {}, periodWalks: {}, dayVersions: {},
    cloudLoaded: false, cloudLoading: false, cloudError: ''
  },
  onLaunch() {
    this.loadData().catch(error => { this.globalData.cloudError = error.message; });
  },
  getStore() {
    if (!this._store) {
      if (!wx.cloud) throw new Error('当前微信版本不支持云开发，请更新微信后重试');
      const env = 'xiangqiandong-d9g120h8m6a8ed8da';
      wx.cloud.init({ env });
      this._store = require('./utils/cloud-store')(wx.cloud, this.globalData, env);
    }
    return this._store;
  },
  async loadData() { return this.getStore().loadData(); },
  async savePlan(plan) { return this.getStore().savePlan(plan); },
  async saveDay(day) { return this.getStore().saveDay(day); },
  getDay(date) { return this.getStore().getDay(date); },
  newPlanId() { return this.getStore().newPlanId(); }
});
