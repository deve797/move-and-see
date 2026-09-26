const { currentMonday, nextMonday, weekPreview } = require('../../utils/week-preview');
Page({
  data: { days: [], selectedDate: '', title: '本周计划', range: '', isCurrentWeek: true, isNextWeek: false, artFailed: false },
  onLoad() {
    const now = new Date();
    this.setData(weekPreview(currentMonday(now), now));
  },
  showCurrentWeek() {
    const now = new Date();
    this.setData(weekPreview(currentMonday(now), now));
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  showNextWeek() {
    const now = new Date();
    this.setData(weekPreview(nextMonday(now), now));
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  selectWeek(event) {
    this.setData(weekPreview(event.detail.value, new Date()));
  },
  onArtError() { this.setData({ artFailed: true }); }
});
