const todaySamples = require('../../utils/today-preview');
const { samples } = require('../../utils/week-preview');
Page({
  data: { activity: null, date: '', returnLabel: '返回周计划', returnUrl: '/pages/week/index' },
  onLoad(query) {
    const isToday = query.source === 'today';
    const list = isToday ? todaySamples : samples;
    if (isToday) this.setData({ returnLabel: '返回今天', returnUrl: '/pages/today/index' });
    const day = Number(query.day);
    if (!Number.isInteger(day) || day < 0 || day >= list.length || query.day === undefined) return;
    this.setData({ activity: list[day], date: /^\d{4}-\d{2}-\d{2}$/.test(query.date || '') ? query.date : '' });
  },
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: this.data.returnUrl });
  }
});
