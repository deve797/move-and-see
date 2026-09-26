const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

// UTC 周日 16:30 已是北京时间周一，覆盖跨周与北京时间日期边界。
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-09-27T16:30:00Z'])); }
}
const app = { globalData: { plans: [
  { id: 1, date: '2026-09-25', activity: '跑步', startTime: '19:00', beforeMood: 'low', beforeMoodNote: '原运动前感受', result: { status: 'incomplete', reason: '下雨' } },
  { id: 2, date: '2026-09-28', activity: '跑步', startTime: '07:00', result: { status: 'incomplete', reason: '加班' } },
  { id: 3, date: '2026-09-28', activity: '瑜伽', startTime: '09:00' },
  { id: 4, date: '2026-09-25', activity: '散步', startTime: '20:00', cancelled: true, result: { status: 'incomplete', reason: '临时有事' } },
  { id: 5, date: '2026-09-25', activity: '跑步', startTime: '21:00', result: { status: 'completed', feeling: '适中', afterMood: 'good' } },
  { id: 6, date: '2026-09-25', activity: '网球', startTime: '09:00', result: { status: 'replacement', actualActivity: '散步' } }
] } };
function mount(name, query = {}) {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  const navigation = [];
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => app,
    getCurrentPages: () => [{}, {}],
    Page(value) { definition = value; },
    wx: {
      pageScrollTo() {}, showToast() {}, showModal() {},
      navigateBack() { navigation.push({ type: 'back' }); },
      reLaunch(options) { navigation.push({ type: 'reLaunch', url: options.url }); }
    }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)), navigation,
    setData(value) { Object.assign(this.data, value); }
  });
  if (page.onLoad) page.onLoad(query);
  if (page.onShow) page.onShow();
  return page;
}
const snapshot = () => JSON.stringify(app.globalData.plans);
const plain = value => JSON.parse(JSON.stringify(value));
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
const date = (page, value) => page.selectMakeupDate({ detail: { value } });
const activity = (page, value) => page.selectMakeupActivity({ detail: { value: String(value) } });
const choose = (page, value) => page.selectMood(event('value', value));
const note = (page, value) => page.inputNote({ detail: { value } });
const original = snapshot();
const originalPlan = plain(app.globalData.plans[0]);
const others = JSON.stringify(app.globalData.plans.slice(1));
const originalResult = app.globalData.plans[0].result;
const record = mount('record', { planId: '1' });
const staleConfirmation = mount('record', { planId: '1' });
const staleCorrection = mount('record', { planId: '1' });
staleCorrection.startCorrection();
staleCorrection.selectCorrectionStatus(event('status', 'completed'));
assert.equal(record.data.makeup, null);
assert.equal(record.data.canMakeup, true);
record.startMakeup();
assert.equal(record.data.recordingMakeup, true);
assert.equal(record.data.makeupEndDate, '2026-09-28');
assert.equal(record.data.makeupDate, '');
assert.equal(record.data.makeupActivity, '');
assert.equal(record.data.canConfirmMakeup, false);
record.confirmMakeup();
assert.equal(snapshot(), original);
date(record, '2026-09-28');
assert.equal(record.data.canConfirmMakeup, false);
activity(record, 5);
assert.equal(record.data.makeupActivity, '散步');
assert.equal(record.data.canConfirmMakeup, true);
assert.equal(snapshot(), original); // 选择只改草稿。
for (const value of ['', 'invalid', '2026-9-28', '2026-09-31', '2026-09-24', '2026-09-29']) {
  date(record, value);
  assert.equal(record.data.canConfirmMakeup, false);
  record.confirmMakeup();
  assert.equal(snapshot(), original);
}
date(record, '2026-09-28');
for (const index of [-1, 99, 1.5, 'invalid']) {
  activity(record, index);
  assert.equal(record.data.canConfirmMakeup, false);
  record.confirmMakeup();
  assert.equal(snapshot(), original);
}
record.setData({ makeupDate: '2026-09-28', makeupActivity: '不存在的项目', canConfirmMakeup: true });
record.confirmMakeup();
assert.equal(snapshot(), original); // 确认重新验证，不相信按钮状态。
record.setData({ makeupDate: '2026-09-29', makeupActivity: '散步', canConfirmMakeup: true });
record.confirmMakeup();
assert.equal(snapshot(), original);
record.cancelMakeup();
record.confirmMakeup();
assert.equal(record.data.recordingMakeup, false);
assert.equal(snapshot(), original);
record.startMakeup();
date(record, '2026-09-28');
activity(record, 5);
record.onShow();
record.confirmMakeup();
assert.equal(record.data.recordingMakeup, false);
assert.equal(record.data.makeupDate, '');
assert.equal(record.data.makeupActivity, '');
assert.equal(snapshot(), original); // 离页返回放弃草稿。
staleConfirmation.startMakeup();
date(staleConfirmation, '2026-09-26');
activity(staleConfirmation, 0);
record.startMakeup();
date(record, '2026-09-28');
activity(record, 5);
record.confirmMakeup();
const makeup = originalResult.makeup;
assert.deepEqual(plain(makeup), { date: '2026-09-28', actualActivity: '散步' });
assert.equal(app.globalData.plans[0].result, originalResult);
assert.deepEqual(plain({ ...app.globalData.plans[0], result: { ...originalResult, makeup: undefined } }), originalPlan);
assert.equal(JSON.stringify(app.globalData.plans.slice(1)), others);
assert.equal(app.globalData.plans.length, 6);
assert.equal(record.data.canMakeup, false);
assert.equal(record.data.canCorrect, false);
assert.equal(record.data.makeup.actualActivity, '散步');
staleCorrection.confirmCorrection();
assert.equal(app.globalData.plans[0].result, originalResult);
assert.equal(originalResult.reason, '下雨');
assert.equal(originalResult.makeup, makeup);
const confirmed = snapshot();
record.confirmMakeup();
record.startMakeup();
date(record, '2026-09-26');
activity(record, 0);
record.confirmMakeup();
staleConfirmation.confirmMakeup();
const reopened = mount('record', { planId: '1' });
assert.equal(reopened.data.makeup.date, '2026-09-28');
assert.equal(reopened.data.makeup.actualActivity, '散步');
assert.equal(reopened.data.plan.date, '2026-09-25');
assert.equal(reopened.data.plan.activity, '跑步');
assert.equal(reopened.data.plan.startTime, '19:00');
assert.equal(reopened.data.plan.result.reason, '下雨');
reopened.confirmMakeup();
reopened.startCorrection();
reopened.confirmCorrection();
reopened.confirmCompleted();
reopened.confirmIncomplete();
reopened.confirmReplacement();
reopened.confirmRunningData();
assert.equal(snapshot(), confirmed);
assert.equal(originalResult.makeup, makeup); // 连点、旧页、重进、原修正入口不能产生第二份补做。

const week = mount('week');
week.selectWeek({ detail: { value: '2026-09-25' } });
const selectedWeek = week.data.selectedDate;
const shownWeek = week.data.days.flatMap(day => day.plans).find(item => item.id === 1);
assert.equal(week.data.days.find(day => day.plans.some(item => item.id === 1)).date, '2026-09-25');
assert.equal(shownWeek.activity, '跑步');
assert.equal(shownWeek.result.status, 'incomplete');
assert.equal(shownWeek.result.reason, '下雨');
assert.equal(shownWeek.result.makeup.date, '2026-09-28');
assert.equal(shownWeek.editable, false);
assert.equal(shownWeek.pendingRecord, false);
week.startEditing(event('id', 1));
week.cancelPlan(event('id', 1));
assert.equal(week.data.adding, false);
assert.equal(snapshot(), confirmed);
week.onShow();
assert.equal(week.data.selectedDate, selectedWeek);
week.selectWeek({ detail: { value: '2026-09-28' } });
assert.equal(week.data.days.flatMap(day => day.plans).some(item => item.id === 1), false);
assert.equal(app.globalData.plans.filter(item => item.id === 1).length, 1); // 跨周保持原周五关联，不搬到补做周一。

const today = mount('today');
assert.equal(today.data.date, '2026-09-28');
assert.equal(today.data.activities.some(item => item.id === 1), false);
const sameDay = mount('record', { planId: '2' });
sameDay.startMakeup();
date(sameDay, '2026-09-28');
activity(sameDay, 1);
sameDay.confirmMakeup();
assert.deepEqual(plain(app.globalData.plans[1].result), { status: 'incomplete', reason: '加班', makeup: { date: '2026-09-28', actualActivity: '跑步' } });
today.onShow();
const shownToday = today.data.activities.find(item => item.id === 2);
assert.equal(shownToday.name, '跑步');
assert.equal(shownToday.completed, true);
assert.equal(shownToday.result.status, 'incomplete');
assert.equal(shownToday.result.makeup.actualActivity, '跑步');
assert.equal(today.data.activities.find(item => item.id === 3).result, null);
week.onShow();
assert.equal(week.data.selectedDate, '2026-09-28');
assert.equal(week.data.days.flatMap(day => day.plans).find(item => item.id === 2).result.makeup.date, '2026-09-28');

for (const planId of ['1', '2', '3', '4', '5', '6', '999', 'invalid', '', undefined]) {
  const before = snapshot();
  const invalid = mount('record', { planId });
  invalid.startMakeup();
  assert.equal(invalid.data.recordingMakeup, false);
  date(invalid, '2026-09-28');
  activity(invalid, 5);
  invalid.confirmMakeup();
  assert.equal(snapshot(), before);
}
for (const change of ['cancelled', 'completed', 'replacement', 'removed', 'result', 'reason', 'makeup']) {
  const plan = { id: 7, date: '2026-09-25', activity: '跑步', startTime: '22:00', result: { status: 'incomplete', reason: '下雨' } };
  app.globalData.plans.push(plan);
  const stale = mount('record', { planId: '7' });
  stale.startMakeup();
  date(stale, '2026-09-28');
  activity(stale, 5);
  if (change === 'cancelled') plan.cancelled = true;
  else if (change === 'removed') app.globalData.plans.pop();
  else if (change === 'result') plan.result = { status: 'incomplete', reason: '下雨' };
  else if (change === 'reason') plan.result.reason = '加班';
  else if (change === 'makeup') plan.result.makeup = { date: '2026-09-26', actualActivity: '瑜伽' };
  else plan.result = { status: change };
  const before = snapshot();
  const currentResult = plan.result;
  stale.confirmMakeup();
  assert.equal(snapshot(), before, 'stale makeup: ' + change);
  assert.equal(plan.result, currentResult);
  if (change !== 'removed') app.globalData.plans.pop();
}

const calendarPlan = { id: 7, date: '2024-01-01', activity: '瑜伽', startTime: '10:00', result: { status: 'incomplete', reason: '其他' } };
app.globalData.plans.push(calendarPlan);
const calendar = mount('record', { planId: '7' });
calendar.startMakeup();
activity(calendar, 0);
for (const value of ['2024-02-30', '2025-02-29', '2026-04-31', '2026-00-10', '2026-13-01']) {
  const before = snapshot();
  date(calendar, value);
  assert.equal(calendar.data.canConfirmMakeup, false, 'invalid calendar date: ' + value);
  calendar.confirmMakeup();
  assert.equal(snapshot(), before);
}
date(calendar, '2024-02-29');
assert.equal(calendar.data.canConfirmMakeup, true); // 有效闰日可选。
calendar.confirmMakeup();
assert.equal(calendarPlan.result.makeup.date, '2024-02-29');
app.globalData.plans.pop();

const beforeFeelings = snapshot();
const skip = mount('mood', { planId: '1', makeup: '1' });
assert.equal(skip.data.isMakeup, true);
assert.deepEqual(plain(skip.data.plan), { id: 1, activity: '散步', date: '2026-09-28', startTime: '' });
assert.equal(skip.data.selectedMood, '');
assert.equal(skip.data.note, '');
skip.goBack();
assert.equal(snapshot(), beforeFeelings); // 原运动前感受不带入，全部可跳过。
assert.equal(makeup.feeling, undefined);
const mood = mount('mood', { planId: '1', makeup: '1' });
const olderMood = mount('mood', { planId: '1', makeup: '1' });
choose(olderMood, 'low');
note(olderMood, '旧页面草稿');
choose(mood, 'good');
note(mood, '  散步后轻松些。\n下次再说。  ');
assert.equal(snapshot(), beforeFeelings);
mood.confirmMood();
assert.equal(app.globalData.plans[0].result, originalResult);
assert.equal(originalResult.afterMood, undefined);
assert.equal(originalResult.afterMoodNote, undefined);
assert.equal(originalResult.makeup.afterMood, 'good');
assert.equal(originalResult.makeup.afterMoodNote, '  散步后轻松些。\n下次再说。  ');
assert.equal(app.globalData.plans[0].beforeMood, 'low');
assert.equal(app.globalData.plans[0].beforeMoodNote, '原运动前感受');
assert.equal(app.globalData.plans[1].result.makeup.afterMood, undefined);
const savedMood = snapshot();
olderMood.confirmMood();
assert.equal(snapshot(), savedMood); // 同一次补做的心情或备注已更新，旧草稿不能覆盖。
mood.confirmMood();
assert.equal(snapshot(), savedMood);
assert.equal(mood.navigation.length, 1);
const reopenedMood = mount('mood', { planId: '1', makeup: '1' });
assert.equal(reopenedMood.data.selectedMood, 'good');
assert.equal(reopenedMood.data.note, '  散步后轻松些。\n下次再说。  ');
choose(reopenedMood, 'invalid');
assert.equal(reopenedMood.data.selectedMood, 'good');
choose(reopenedMood, 'down');
note(reopenedMood, '放弃修改');
reopenedMood.goBack();
assert.equal(snapshot(), savedMood);
const clearNote = mount('mood', { planId: '1', makeup: '1' });
note(clearNote, '');
clearNote.confirmMood();
assert.equal(originalResult.makeup.afterMood, 'good');
assert.equal(originalResult.makeup.afterMoodNote, '');
const feeling = mount('record', { planId: '1' });
assert.equal(feeling.data.selectedFeeling, '');
for (const value of ['轻松', '适中', '吃力', '']) {
  feeling.selectFeeling(event('feeling', value));
  assert.equal(originalResult.makeup.feeling, value);
  assert.equal(originalResult.feeling, undefined);
  assert.equal(mount('record', { planId: '1' }).data.selectedFeeling, value);
  assert.equal(originalResult.makeup.afterMood, 'good');
  assert.equal(app.globalData.plans[1].result.makeup.feeling, undefined);
}
const independentMood = mount('mood', { planId: '1', makeup: '1' });
choose(independentMood, 'great');
note(independentMood, '心情和体感分别更新');
feeling.selectFeeling(event('feeling', '轻松'));
const makeupBeforeMood = originalResult.makeup;
independentMood.confirmMood();
assert.equal(originalResult.makeup, makeupBeforeMood);
assert.equal(originalResult.makeup.feeling, '轻松');
assert.equal(originalResult.makeup.afterMood, 'great');
assert.equal(originalResult.makeup.afterMoodNote, '心情和体感分别更新'); // 体感变化不阻断独立心情确认。
const savedFeeling = snapshot();
feeling.selectFeeling(event('feeling', 'invalid'));
assert.equal(snapshot(), savedFeeling);
const plainMood = mount('mood', { planId: '1' });
assert.equal(plainMood.data.plan, null);
plainMood.confirmMood();
assert.equal(snapshot(), savedFeeling); // 未携带补做上下文的旧感受入口不能修改补做。

for (const change of ['mood', 'note']) {
  const plan = { id: 7, date: '2026-09-25', activity: '跑步', startTime: '22:00', result: { status: 'incomplete', reason: '下雨', makeup: { date: '2026-09-28', actualActivity: '瑜伽', afterMood: 'good', afterMoodNote: '原备注' } } };
  app.globalData.plans.push(plan);
  const older = mount('mood', { planId: '7', makeup: '1' });
  choose(older, 'low');
  note(older, '旧草稿');
  const newer = mount('mood', { planId: '7', makeup: '1' });
  if (change === 'mood') choose(newer, 'great');
  else note(newer, '新备注');
  newer.confirmMood();
  const latest = snapshot();
  older.confirmMood();
  assert.equal(snapshot(), latest, 'stale makeup draft after only ' + change + ' changes');
  app.globalData.plans.pop();
}

for (const change of ['cancelled', 'removed', 'completed', 'result', 'makeup', 'missing']) {
  const plan = { id: 7, date: '2026-09-25', activity: '跑步', startTime: '22:00', result: { status: 'incomplete', reason: '下雨', makeup: { date: '2026-09-28', actualActivity: '瑜伽', feeling: '轻松' } } };
  app.globalData.plans.push(plan);
  const staleMood = mount('mood', { planId: '7', makeup: '1' });
  const staleFeeling = mount('record', { planId: '7' });
  choose(staleMood, 'great');
  note(staleMood, '旧补做草稿');
  if (change === 'cancelled') plan.cancelled = true;
  else if (change === 'removed') app.globalData.plans.pop();
  else if (change === 'completed') plan.result = { status: 'completed' };
  else if (change === 'result') plan.result = { ...plan.result };
  else if (change === 'makeup') plan.result.makeup = { ...plan.result.makeup, afterMood: 'good' };
  else delete plan.result.makeup;
  const before = snapshot();
  staleMood.confirmMood();
  staleFeeling.selectFeeling(event('feeling', '吃力'));
  assert.equal(snapshot(), before, 'stale makeup feeling: ' + change);
  if (change !== 'removed') app.globalData.plans.pop();
}
for (const planId of ['3', '4', '5', '6', '999', 'invalid', undefined]) {
  const before = snapshot();
  const invalid = mount('mood', { planId, makeup: '1' });
  assert.equal(invalid.data.plan, null);
  choose(invalid, 'good');
  note(invalid, '无效目标');
  invalid.confirmMood();
  assert.equal(snapshot(), before);
}
const optional = mount('mood', { planId: '2', makeup: '1' });
optional.confirmMood();
assert.equal(app.globalData.plans[1].result.makeup.afterMood, '');
assert.equal(app.globalData.plans[1].result.makeup.afterMoodNote, '');
assert.equal(app.globalData.plans[1].result.makeup.feeling, undefined);
assert.equal(app.globalData.plans.length, 6);
assert.deepEqual(plain(app.globalData.plans.slice(2)), JSON.parse(original).slice(2));
console.log('PASS: required makeup input, Beijing date boundary, original plan/result retained, original correction cannot erase makeup');
console.log('PASS: invalid dates/activities, leap calendar, discard/reopen, one makeup, stale/cancelled/deleted guards and plan isolation');
console.log('PASS: previous-Friday/next-Monday link, unchanged plan date and count, same-day makeup, today/week state, selected-week preservation');
console.log('PASS: actual makeup mood/note/feeling context, optional/skip/edit/clear, original feelings retained and stale page guards');
