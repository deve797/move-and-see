const moods = require('../../utils/mood-options');

Page({
  data: {
    selectedMood: '',
    note: '',
    noteFocused: false,
    moods
  },
  selectMood(event) {
    const value = event.currentTarget.dataset.value;
    if (!moods.some(item => item.value === value)) return;
    this.setData({ selectedMood: value });
  },
  inputNote(event) {
    this.setData({ note: event.detail.value });
  },
  focusNote() { this.setData({ noteFocused: true }); },
  blurNote() { this.setData({ noteFocused: false }); },
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/record/index' });
  }
});
