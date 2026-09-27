Page({
  onShareAppMessage: require('../../utils/share'),
  data: { artFailed: false },
  onShow() { this.openingToday = false; },
  onArtError() { this.setData({ artFailed: true }); },
  openToday() {
    if (this.openingToday) return;
    this.openingToday = true;
    wx.navigateTo({
      url: '/pages/today/index',
      fail: () => {
        this.openingToday = false;
        wx.showToast({ title: '暂时无法打开，请再试一次', icon: 'none' });
      }
    });
  }
});
