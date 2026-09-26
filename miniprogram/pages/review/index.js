Page({
  // 概念图中的固定示例，不读取或统计真实运动记录。
  data: {
    weeks: [
      { label: '第1周', count: 2 },
      { label: '第2周', count: 3 },
      { label: '第3周', count: 4 },
      { label: '第4周', count: 5 }
    ],
    thisWeekCount: 5,
    moreThanLastWeek: 1,
    betterMoodCount: 3,
    moodNotesExpanded: false,
    moodTextSummary: '这周的文字里，运动前提到过“有点累”“不太想出门”；运动后写下了“轻松了一些”“脑袋清楚了”。也有一次，运动后仍然觉得“还是有点累”。',
    // 与上方文字总结对应的虚构原话，仅用于展示展开形式。
    moodNotes: [
      { id: 'mon-yoga', date: '9月21日 · 周一', activity: '瑜伽', before: '今天有点累，想先慢慢活动。', after: '做完伸展，身体轻松了一些。' },
      { id: 'tue-running', date: '9月22日 · 周二', activity: '跑步', before: '下班后不太想出门，先走一会儿看看。', after: '吹了风，脑袋清楚了。' },
      { id: 'thu-strength', date: '9月24日 · 周四', activity: '力量训练', before: '今天状态一般，按自己的节奏练。', after: '练完感觉不错，心情也松了一点。' },
      { id: 'fri-walking', date: '9月25日 · 周五', activity: '散步', before: '', after: '走完还是有点累，今晚想早点休息。' }
    ],
    artFailed: false
  },
  onArtError() { this.setData({ artFailed: true }); },
  toggleMoodNotes() {
    if (this.data.moodNotesExpanded) this.collapseMoodNotes();
    else this.setData({ moodNotesExpanded: true });
  },
  collapseMoodNotes() {
    this.setData({ moodNotesExpanded: false }, () => {
      wx.pageScrollTo({ selector: '#mood-summary', duration: 0 });
    });
  },
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/today/index' });
  }
});
