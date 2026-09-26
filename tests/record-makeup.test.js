(async () => {
const { createTestApp, prepareTestApp } = require('./helpers/runtime');
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
async function mount(name, query = {}) {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  const navigation = [];
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => prepareTestApp(app),
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
  if (page.onLoad) (await page.onLoad(query));
  if (page.onShow) (await page.onShow());
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
const currentResult = () => app.globalData.plans[0].result;
const record = (await mount('record', { planId: '1' }));
const staleConfirmation = (await mount('record', { planId: '1' }));
const staleCorrection = (await mount('record', { planId: '1' }));
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
(await record.confirmMakeup());
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
  (await record.confirmMakeup());
  assert.equal(snapshot(), original);
}
date(record, '2026-09-28');
for (const index of [-1, 99, 1.5, 'invalid']) {
  activity(record, index);
  assert.equal(record.data.canConfirmMakeup, false);
  (await record.confirmMakeup());
  assert.equal(snapshot(), original);
}
record.setData({ makeupDate: '2026-09-28', makeupActivity: '不存在的项目', canConfirmMakeup: true });
(await record.confirmMakeup());
assert.equal(snapshot(), original); // 确认重新验证，不相信按钮状态。
record.setData({ makeupDate: '2026-09-29', makeupActivity: '散步', canConfirmMakeup: true });
(await record.confirmMakeup());
assert.equal(snapshot(), original);
record.cancelMakeup();
(await record.confirmMakeup());
assert.equal(record.data.recordingMakeup, false);
assert.equal(snapshot(), original);
record.startMakeup();
date(record, '2026-09-28');
activity(record, 5);
(await record.onShow());
(await record.confirmMakeup());
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
(await record.confirmMakeup());
const currentMakeup = () => currentResult().makeup;
assert.deepEqual(plain(currentMakeup()), { date: '2026-09-28', actualActivity: '散步' });
assert.equal(currentResult().status, 'incomplete');
assert.deepEqual(plain({ ...app.globalData.plans[0], version: undefined, result: { ...currentResult(), makeup: undefined } }), originalPlan);
assert.equal(JSON.stringify(app.globalData.plans.slice(1)), others);
assert.equal(app.globalData.plans.length, 6);
assert.equal(record.data.canMakeup, false);
assert.equal(record.data.canCorrect, false);
assert.equal(record.data.makeup.actualActivity, '散步');
(await staleCorrection.confirmCorrection());
assert.equal(currentResult().status, 'incomplete');
assert.equal(currentResult().reason, '下雨');
assert.deepEqual(plain(currentMakeup()), { date: '2026-09-28', actualActivity: '散步' });
const confirmed = snapshot();
(await record.confirmMakeup());
record.startMakeup();
date(record, '2026-09-26');
activity(record, 0);
(await record.confirmMakeup());
(await staleConfirmation.confirmMakeup());
const reopened = (await mount('record', { planId: '1' }));
assert.equal(reopened.data.makeup.date, '2026-09-28');
assert.equal(reopened.data.makeup.actualActivity, '散步');
assert.equal(reopened.data.plan.date, '2026-09-25');
assert.equal(reopened.data.plan.activity, '跑步');
assert.equal(reopened.data.plan.startTime, '19:00');
assert.equal(reopened.data.plan.result.reason, '下雨');
(await reopened.confirmMakeup());
reopened.startCorrection();
(await reopened.confirmCorrection());
(await reopened.confirmCompleted());
(await reopened.confirmIncomplete());
(await reopened.confirmReplacement());
(await reopened.confirmRunningData());
assert.equal(snapshot(), confirmed);
assert.deepEqual(plain(currentMakeup()), { date: '2026-09-28', actualActivity: '散步' }); // 连点、旧页、重进、原修正入口不能产生第二份补做。

const week = (await mount('week'));
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
(await week.cancelPlan(event('id', 1)));
assert.equal(week.data.adding, false);
assert.equal(snapshot(), confirmed);
(await week.onShow());
assert.equal(week.data.selectedDate, selectedWeek);
week.selectWeek({ detail: { value: '2026-09-28' } });
assert.equal(week.data.days.flatMap(day => day.plans).some(item => item.id === 1), false);
assert.equal(app.globalData.plans.filter(item => item.id === 1).length, 1); // 跨周保持原周五关联，不搬到补做周一。

const today = (await mount('today'));
assert.equal(today.data.date, '2026-09-28');
assert.equal(today.data.activities.some(item => item.id === 1), false);
const sameDay = (await mount('record', { planId: '2' }));
sameDay.startMakeup();
date(sameDay, '2026-09-28');
activity(sameDay, 1);
(await sameDay.confirmMakeup());
assert.deepEqual(plain(app.globalData.plans[1].result), { status: 'incomplete', reason: '加班', makeup: { date: '2026-09-28', actualActivity: '跑步' } });
(await today.onShow());
const shownToday = today.data.activities.find(item => item.id === 2);
assert.equal(shownToday.name, '跑步');
assert.equal(shownToday.completed, true);
assert.equal(shownToday.result.status, 'incomplete');
assert.equal(shownToday.result.makeup.actualActivity, '跑步');
assert.equal(today.data.activities.find(item => item.id === 3).result, null);
(await week.onShow());
assert.equal(week.data.selectedDate, '2026-09-28');
assert.equal(week.data.days.flatMap(day => day.plans).find(item => item.id === 2).result.makeup.date, '2026-09-28');

for (const planId of ['1', '2', '3', '4', '5', '6', '999', 'invalid', '', undefined]) {
  const before = snapshot();
  const invalid = (await mount('record', { planId }));
  invalid.startMakeup();
  assert.equal(invalid.data.recordingMakeup, false);
  date(invalid, '2026-09-28');
  activity(invalid, 5);
  (await invalid.confirmMakeup());
  assert.equal(snapshot(), before);
}
for (const change of ['cancelled', 'completed', 'replacement', 'removed', 'result', 'reason', 'makeup']) {
  const plan = { id: 7, version: 1, date: '2026-09-25', activity: '跑步', startTime: '22:00', result: { status: 'incomplete', reason: '下雨' } };
  app.globalData.plans.push(plan);
  const stale = (await mount('record', { planId: '7' }));
  stale.startMakeup();
  date(stale, '2026-09-28');
  activity(stale, 5);
  plan.version = (plan.version || 0) + 1; // 模拟其他客户端已保存的新版本。
  if (change === 'cancelled') plan.cancelled = true;
  else if (change === 'removed') app.globalData.plans.pop();
  else if (change === 'result') plan.result = { status: 'incomplete', reason: '下雨' };
  else if (change === 'reason') plan.result.reason = '加班';
  else if (change === 'makeup') plan.result.makeup = { date: '2026-09-26', actualActivity: '瑜伽' };
  else plan.result = { status: change };
  const before = snapshot();
  const currentResult = plan.result;
  (await stale.confirmMakeup());
  assert.equal(snapshot(), before, 'stale makeup: ' + change);
  assert.equal(plan.result, currentResult);
  if (change !== 'removed') app.globalData.plans.pop();
}

const calendarPlan = { id: 7, date: '2024-01-01', activity: '瑜伽', startTime: '10:00', result: { status: 'incomplete', reason: '其他' } };
app.globalData.plans.push(calendarPlan);
const calendar = (await mount('record', { planId: '7' }));
calendar.startMakeup();
activity(calendar, 0);
for (const value of ['2024-02-30', '2025-02-29', '2026-04-31', '2026-00-10', '2026-13-01']) {
  const before = snapshot();
  date(calendar, value);
  assert.equal(calendar.data.canConfirmMakeup, false, 'invalid calendar date: ' + value);
  (await calendar.confirmMakeup());
  assert.equal(snapshot(), before);
}
date(calendar, '2024-02-29');
assert.equal(calendar.data.canConfirmMakeup, true); // 有效闰日可选。
(await calendar.confirmMakeup());
assert.equal(app.globalData.plans.at(-1).result.makeup.date, '2024-02-29');
app.globalData.plans.pop();

const beforeFeelings = snapshot();
const skip = (await mount('mood', { planId: '1', makeup: '1' }));
assert.equal(skip.data.isMakeup, true);
assert.deepEqual(plain(skip.data.plan), { id: 1, activity: '散步', date: '2026-09-28', startTime: '' });
assert.equal(skip.data.selectedMood, '');
assert.equal(skip.data.note, '');
skip.goBack();
assert.equal(snapshot(), beforeFeelings); // 原运动前感受不带入，全部可跳过。
assert.equal(currentMakeup().feeling, undefined);
const mood = (await mount('mood', { planId: '1', makeup: '1' }));
const olderMood = (await mount('mood', { planId: '1', makeup: '1' }));
choose(olderMood, 'low');
note(olderMood, '旧页面草稿');
choose(mood, 'good');
note(mood, '  散步后轻松些。\n下次再说。  ');
assert.equal(snapshot(), beforeFeelings);
(await mood.confirmMood());
assert.equal(currentResult().status, 'incomplete');
assert.equal(currentResult().afterMood, undefined);
assert.equal(currentResult().afterMoodNote, undefined);
assert.equal(currentResult().makeup.afterMood, 'good');
assert.equal(currentResult().makeup.afterMoodNote, '  散步后轻松些。\n下次再说。  ');
assert.equal(app.globalData.plans[0].beforeMood, 'low');
assert.equal(app.globalData.plans[0].beforeMoodNote, '原运动前感受');
assert.equal(app.globalData.plans[1].result.makeup.afterMood, undefined);
const savedMood = snapshot();
(await olderMood.confirmMood());
assert.equal(snapshot(), savedMood); // 同一次补做的心情或备注已更新，旧草稿不能覆盖。
(await mood.confirmMood());
assert.equal(snapshot(), savedMood);
assert.equal(mood.navigation.length, 1);
const reopenedMood = (await mount('mood', { planId: '1', makeup: '1' }));
assert.equal(reopenedMood.data.selectedMood, 'good');
assert.equal(reopenedMood.data.note, '  散步后轻松些。\n下次再说。  ');
choose(reopenedMood, 'invalid');
assert.equal(reopenedMood.data.selectedMood, 'good');
choose(reopenedMood, 'down');
note(reopenedMood, '放弃修改');
reopenedMood.goBack();
assert.equal(snapshot(), savedMood);
const clearNote = (await mount('mood', { planId: '1', makeup: '1' }));
note(clearNote, '');
(await clearNote.confirmMood());
assert.equal(currentResult().makeup.afterMood, 'good');
assert.equal(currentResult().makeup.afterMoodNote, '');
const feeling = (await mount('record', { planId: '1' }));
assert.equal(feeling.data.selectedFeeling, '');
for (const value of ['轻松', '适中', '吃力', '']) {
  (await feeling.selectFeeling(event('feeling', value)));
  assert.equal(currentResult().makeup.feeling, value);
  assert.equal(currentResult().feeling, undefined);
  assert.equal((await mount('record', { planId: '1' })).data.selectedFeeling, value);
  assert.equal(currentResult().makeup.afterMood, 'good');
  assert.equal(app.globalData.plans[1].result.makeup.feeling, undefined);
}
let independentMood = (await mount('mood', { planId: '1', makeup: '1' }));
choose(independentMood, 'great');
note(independentMood, '心情和体感分别更新');
(await feeling.selectFeeling(event('feeling', '轻松')));
const makeupBeforeMood = plain(currentMakeup());
(await independentMood.confirmMood());
assert.deepEqual(plain(currentMakeup()), makeupBeforeMood);
assert.match(independentMood.data.saveError, /更新|刷新/);
independentMood = (await mount('mood', { planId: '1', makeup: '1' }));
choose(independentMood, 'great');
note(independentMood, '心情和体感分别更新');
(await independentMood.confirmMood());
assert.equal(currentResult().makeup.feeling, '轻松');
assert.equal(currentResult().makeup.afterMood, 'great');
assert.equal(currentResult().makeup.afterMoodNote, '心情和体感分别更新'); // 刷新后再确认，保留已保存的体感。
const savedFeeling = snapshot();
(await feeling.selectFeeling(event('feeling', 'invalid')));
assert.equal(snapshot(), savedFeeling);
const plainMood = (await mount('mood', { planId: '1' }));
assert.equal(plainMood.data.plan, null);
(await plainMood.confirmMood());
assert.equal(snapshot(), savedFeeling); // 未携带补做上下文的旧感受入口不能修改补做。

for (const change of ['mood', 'note']) {
  const plan = { id: 7, version: 1, date: '2026-09-25', activity: '跑步', startTime: '22:00', result: { status: 'incomplete', reason: '下雨', makeup: { date: '2026-09-28', actualActivity: '瑜伽', afterMood: 'good', afterMoodNote: '原备注' } } };
  app.globalData.plans.push(plan);
  const older = (await mount('mood', { planId: '7', makeup: '1' }));
  choose(older, 'low');
  note(older, '旧草稿');
  const newer = (await mount('mood', { planId: '7', makeup: '1' }));
  if (change === 'mood') choose(newer, 'great');
  else note(newer, '新备注');
  (await newer.confirmMood());
  const latest = snapshot();
  (await older.confirmMood());
  assert.equal(snapshot(), latest, 'stale makeup draft after only ' + change + ' changes');
  app.globalData.plans.pop();
}

for (const change of ['cancelled', 'removed', 'completed', 'result', 'makeup', 'missing']) {
  const plan = { id: 7, version: 1, date: '2026-09-25', activity: '跑步', startTime: '22:00', result: { status: 'incomplete', reason: '下雨', makeup: { date: '2026-09-28', actualActivity: '瑜伽', feeling: '轻松' } } };
  app.globalData.plans.push(plan);
  const staleMood = (await mount('mood', { planId: '7', makeup: '1' }));
  const staleFeeling = (await mount('record', { planId: '7' }));
  choose(staleMood, 'great');
  note(staleMood, '旧补做草稿');
  plan.version = (plan.version || 0) + 1; // 模拟其他客户端已保存的新版本。
  if (change === 'cancelled') plan.cancelled = true;
  else if (change === 'removed') app.globalData.plans.pop();
  else if (change === 'completed') plan.result = { status: 'completed' };
  else if (change === 'result') plan.result = { ...plan.result };
  else if (change === 'makeup') plan.result.makeup = { ...plan.result.makeup, afterMood: 'good' };
  else delete plan.result.makeup;
  const before = snapshot();
  (await staleMood.confirmMood());
  (await staleFeeling.selectFeeling(event('feeling', '吃力')));
  assert.equal(snapshot(), before, 'stale makeup feeling: ' + change);
  if (change !== 'removed') app.globalData.plans.pop();
}
for (const planId of ['3', '4', '5', '6', '999', 'invalid', undefined]) {
  const before = snapshot();
  const invalid = (await mount('mood', { planId, makeup: '1' }));
  assert.equal(invalid.data.plan, null);
  choose(invalid, 'good');
  note(invalid, '无效目标');
  (await invalid.confirmMood());
  assert.equal(snapshot(), before);
}
const optional = (await mount('mood', { planId: '2', makeup: '1' }));
(await optional.confirmMood());
assert.equal(app.globalData.plans[1].result.makeup.afterMood, '');
assert.equal(app.globalData.plans[1].result.makeup.afterMoodNote, '');
assert.equal(app.globalData.plans[1].result.makeup.feeling, undefined);
assert.equal(app.globalData.plans.length, 6);
assert.deepEqual(plain(app.globalData.plans.slice(2)), JSON.parse(original).slice(2));
console.log('PASS: required makeup input, Beijing date boundary, original plan/result retained, original correction cannot erase makeup');
console.log('PASS: invalid dates/activities, leap calendar, discard/reopen, one makeup, stale/cancelled/deleted guards and plan isolation');
console.log('PASS: previous-Friday/next-Monday link, unchanged plan date and count, same-day makeup, today/week state, selected-week preservation');
console.log('PASS: actual makeup mood/note/feeling context, optional/skip/edit/clear, original feelings retained and stale page guards');

})().catch(error => { console.error(error); process.exitCode = 1; });
