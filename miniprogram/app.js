const cloudEnv = 'xiangqiandong-d9g120h8m6a8ed8da';

App({
  globalData: {
    plans: [], periodDays: {}, periodWalks: {}, dayVersions: {},
    cloudLoaded: false, cloudLoading: false, cloudError: '',
    profile: null, profileLoaded: false
  },
  onLaunch() {
    this.loadData().catch(error => { this.globalData.cloudError = error.message; });
  },
  getStore() {
    if (!this._store) {
      if (!wx.cloud) throw new Error('当前微信版本不支持云开发，请更新微信后重试');
      wx.cloud.init({ env: cloudEnv });
      this._store = require('./utils/cloud-store')(wx.cloud, this.globalData, cloudEnv);
    }
    return this._store;
  },
  getProfileStore() {
    this.getStore();
    if (!this._profileStore) this._profileStore = require('./utils/profile-store')(wx.cloud, this.globalData, cloudEnv);
    return this._profileStore;
  },
  async loadProfile() { return this.getProfileStore().loadProfile(); },
  async saveProfile(profile, expectedVersion) { return this.getProfileStore().saveProfile(profile, expectedVersion); },
  async loadData() { return this.getStore().loadData(); },
  async savePlan(plan) { return this.getStore().savePlan(plan); },
  async saveDay(day) { return this.getStore().saveDay(day); },
  getDay(date) { return this.getStore().getDay(date); },
  newPlanId() { return this.getStore().newPlanId(); }
});
