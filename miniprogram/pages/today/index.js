const examples = require('../../utils/today-preview');
const moodOptions = require('../../utils/mood-options');
Page({
  data: {
    activities: [], date: '', artFailed: {},
    moodSheetOpen: false, moodActivityIndex: -1,
    moodActivityName: '', moodActivityTime: '', selectedBeforeMood: '',
    beforeMoodNote: '', beforeMoodNoteFocused: false,
    beforeMoodOptions: moodOptions
  },
  onLoad() {
    const now = new Date();
    const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    this.setData({ date, activities: examples.map(item => Object.assign({}, item, { beforeMood: '', beforeMoodLabel: '', beforeMoodNote: '' })) });
  },
  openBeforeMood(event) {
    if (this.data.moodActivityIndex !== -1) return;
    const index = Number(event.currentTarget.dataset.index);
    const activity = this.data.activities[index];
    if (!Number.isInteger(index) || !activity) return;
    this.setData({
      moodSheetOpen: true, moodActivityIndex: index,
      moodActivityName: activity.name, moodActivityTime: activity.time,
      selectedBeforeMood: activity.beforeMood,
      beforeMoodNote: activity.beforeMoodNote, beforeMoodNoteFocused: false
    });
  },
  selectBeforeMood(event) {
    if (!this.data.moodSheetOpen) return;
    const option = this.data.beforeMoodOptions.find(item => item.value === event.currentTarget.dataset.value);
    if (!option) return;
    this.setData({ selectedBeforeMood: option.value });
  },
  inputBeforeMoodNote(event) {
    this.setData({ beforeMoodNote: event.detail.value });
  },
  focusBeforeMoodNote() {
    this.setData({ beforeMoodNoteFocused: true });
  },
  blurBeforeMoodNote() {
    this.setData({ beforeMoodNoteFocused: false });
  },
  confirmBeforeMood() {
    if (!this.data.moodSheetOpen) return;
    const option = this.data.beforeMoodOptions.find(item => item.value === this.data.selectedBeforeMood);
    const key = 'activities[' + this.data.moodActivityIndex + ']';
    this.setData({
      [key + '.beforeMood']: option ? option.value : '',
      [key + '.beforeMoodLabel']: option ? option.label : '',
      [key + '.beforeMoodNote']: this.data.beforeMoodNote.trim(),
      moodSheetOpen: false, beforeMoodNoteFocused: false
    });
  },
  closeBeforeMood() {
    this.setData({ moodSheetOpen: false, beforeMoodNoteFocused: false });
  },
  afterMoodLeave() {
    this.setData({ moodSheetOpen: false, moodActivityIndex: -1, beforeMoodNoteFocused: false });
  },
  toggleStatus(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ ['activities[' + index + '].completed']: !this.data.activities[index].completed });
  },
  onArtError(event) {
    this.setData({ ['artFailed.' + event.currentTarget.dataset.kind]: true });
  }
});
