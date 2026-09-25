const { nextMonday, weekPreview } = require('../../utils/week-preview');
Page({
  data: { days: [], selectedDate: '', title: '下周怎么动？', range: '', artFailed: false },
  onLoad() {
    const now = new Date();
    this.setData(weekPreview(nextMonday(now), now));
  },
  selectWeek(event) {
    this.setData(weekPreview(event.detail.value, new Date()));
  },
  onArtError() { this.setData({ artFailed: true }); }
});
