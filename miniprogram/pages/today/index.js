const examples = require('../../utils/today-preview');
Page({
  data: { activities: [], date: '', artFailed: {} },
  onLoad() {
    const now = new Date();
    const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    this.setData({ date, activities: examples.map(item => Object.assign({}, item)) });
  },
  toggleStatus(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ ['activities[' + index + '].completed']: !this.data.activities[index].completed });
  },
  onArtError(event) {
    this.setData({ ['artFailed.' + event.currentTarget.dataset.kind]: true });
  }
});
