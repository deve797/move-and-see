const todayExamples = require('../../utils/today-preview');
Page({
  data: { minutes: 32, activityName: '户外行走', artFailed: false },
  onLoad(query) {
    const index = Number(query.day);
    if (query.source === 'today' && query.day !== undefined && Number.isInteger(index) && todayExamples[index]) {
      const activity = todayExamples[index];
      this.setData({ minutes: parseInt(activity.duration, 10), activityName: activity.name });
    }
  },
  onShow() { this.openingMood = false; },
  onArtError() { this.setData({ artFailed: true }); },
  openMood() {
    if (this.openingMood) return;
    this.openingMood = true;
    wx.navigateTo({
      url: '/pages/mood/index',
      fail: () => {
        this.openingMood = false;
        wx.showToast({ title: '暂时无法打开，请再试一次', icon: 'none' });
      }
    });
  }
});
