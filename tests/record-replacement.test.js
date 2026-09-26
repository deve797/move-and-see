const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-09-26T04:00:00Z'])); }
}
const app = { globalData: { plans: [
  { id: 1, date: '2026-09-26', activity: '跑步', startTime: '19:00', beforeMood: 'low', beforeMoodNote: '运动前有点累。' },
  { id: 2, date: '2026-09-26', activity: '跑步', startTime: '20:00' },
  { id: 3, date: '2026-09-28', activity: '瑜伽', startTime: '07:30' },
  { id: 4, date: '2026-09-26', activity: '散步', startTime: '21:00', cancelled: true },
  { id: 5, date: '2026-09-26', activity: '跑步', startTime: '08:00', result: { status: 'completed', feeling: '适中', afterMood: 'good', afterMoodNote: '跑完清爽些。', runningData: { durationMinutes: '30', distanceKm: '5', heartRate: '' } } },
  { id: 6, date: '2026-09-26', activity: '网球', startTime: '09:00', result: { status: 'incomplete', reason: '下雨' } }
] } };
function mount(name, query = {}) {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => app,
    getCurrentPages: () => [{}, {}],
    Page(value) { definition = value; },
    wx: { pageScrollTo() {}, showToast() {}, showModal() {}, navigateBack() {} }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value); }
  });
  if (page.onLoad) page.onLoad(query);
  if (page.onShow) page.onShow();
  return page;
}
const snapshot = () => JSON.stringify(app.globalData.plans);
const plain = value => JSON.parse(JSON.stringify(value));
const select = (page, index) => page.selectReplacementActivity({ detail: { value: String(index) } });
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
const original = snapshot();
const originalPlan = plain(app.globalData.plans[0]);
const others = JSON.stringify(app.globalData.plans.slice(1));
const today = mount('today');
const week = mount('week');
const record = mount('record', { planId: '1' });
const oldConfirmation = mount('record', { planId: '1' });
oldConfirmation.startIncomplete();
oldConfirmation.selectReason(event('reason', '下雨'));
assert.deepEqual(Array.from(record.data.replacementActivities), ['瑜伽', '跑步', '力量训练', '徒步', '网球', '散步']);
assert.equal(record.data.replacement, false);
record.startReplacement();
assert.equal(record.data.recordingReplacement, true);
assert.equal(record.data.actualActivity, '');
assert.equal(record.data.canConfirmReplacement, false);
record.confirmReplacement();
assert.equal(snapshot(), original);
for (const index of [-1, 99, 'invalid']) {
  select(record, index);
  assert.equal(record.data.canConfirmReplacement, false);
  record.confirmReplacement();
  assert.equal(snapshot(), original);
}
record.setData({ actualActivity: '不存在的项目', canConfirmReplacement: true });
record.confirmReplacement();
assert.equal(snapshot(), original); // 提交重新校验项目，不只依赖按钮。
record.cancelReplacement();
record.startReplacement();
select(record, 5);
assert.equal(record.data.actualActivity, '散步');
assert.equal(record.data.canConfirmReplacement, true);
assert.equal(snapshot(), original); // 选择仍是草稿。
record.cancelReplacement();
record.confirmReplacement();
assert.equal(record.data.recordingReplacement, false);
assert.equal(snapshot(), original);
record.startReplacement();
select(record, 5);
record.onShow();
record.confirmReplacement();
assert.equal(record.data.recordingReplacement, false);
assert.equal(record.data.actualActivity, '');
assert.equal(snapshot(), original); // 离页返回不提交草稿。

record.inputRunningData({ currentTarget: { dataset: { field: 'durationMinutes' } }, detail: { value: '30' } });
record.inputRunningData({ currentTarget: { dataset: { field: 'distanceKm' } }, detail: { value: '5' } });
record.startReplacement();
select(record, 5);
record.confirmReplacement();
const result = app.globalData.plans[0].result;
assert.deepEqual(plain(result), { status: 'replacement', actualActivity: '散步' });
const { result: ignoredResult, ...remainingPlan } = app.globalData.plans[0];
assert.deepEqual(remainingPlan, originalPlan); // 原项目、日期、时间和运动前感受不变。
assert.equal(JSON.stringify(app.globalData.plans.slice(1)), others);
assert.equal(app.globalData.plans.length, 6);
assert.equal(record.data.plan.activity, '跑步');
assert.equal(record.data.plan.result.actualActivity, '散步');
assert.equal(record.data.replacement, true);
assert.equal(record.data.completed, false);
assert.equal(record.data.isRunning, false);
assert.equal(record.data.canComplete, false);
assert.equal(record.data.canCorrect, false);
assert.equal(record.data.canConfirmReplacement, false);
record.confirmReplacement();
record.startReplacement();
select(record, 0);
record.confirmReplacement();
const reopened = mount('record', { planId: '1' });
assert.equal(reopened.data.replacement, true);
assert.equal(reopened.data.plan.activity, '跑步');
assert.equal(reopened.data.plan.result.actualActivity, '散步');
reopened.confirmReplacement();
assert.equal(app.globalData.plans[0].result, result); // 重复确认及重进不替换结果对象。
oldConfirmation.confirmCompleted();
oldConfirmation.confirmIncomplete();
reopened.startCorrection();
reopened.confirmCorrection();
reopened.selectFeeling(event('feeling', '轻松'));
reopened.confirmRunningData();
const mood = mount('mood', { planId: '1' });
assert.equal(mood.data.plan, null);
mood.confirmMood();
assert.deepEqual(plain(result), { status: 'replacement', actualActivity: '散步' });
assert.equal(app.globalData.plans[0].result, result); // 旧确认和附属入口不能改写替代结果。

today.onShow();
const shownToday = today.data.activities.find(item => item.id === 1);
assert.equal(shownToday.name, '跑步');
assert.equal(shownToday.completed, true);
assert.equal(shownToday.result.actualActivity, '散步');
assert.equal(today.data.activities.find(item => item.id === 2).result, null);
week.onShow();
const shownWeek = week.data.days.flatMap(day => day.plans).find(item => item.id === 1);
assert.equal(shownWeek.activity, '跑步');
assert.equal(shownWeek.result.status, 'replacement');
assert.equal(shownWeek.result.actualActivity, '散步');
assert.equal(shownWeek.editable, false);
assert.equal(shownWeek.pendingRecord, false);
const confirmed = snapshot();
week.startEditing(event('id', 1));
week.cancelPlan(event('id', 1));
assert.equal(week.data.adding, false);
assert.equal(snapshot(), confirmed);
week.showNextWeek();
const selectedWeek = week.data.selectedDate;
const nextWeek = mount('record', { planId: '3' });
nextWeek.startReplacement();
select(nextWeek, 5);
nextWeek.confirmReplacement();
week.onShow();
assert.equal(week.data.selectedDate, selectedWeek);
assert.equal(week.data.days.flatMap(day => day.plans).find(item => item.id === 3).result.actualActivity, '散步');

for (const planId of ['1', '3', '4', '5', '6', '999', 'invalid', '', undefined]) {
  const before = snapshot();
  const invalid = mount('record', { planId });
  invalid.startReplacement();
  assert.equal(invalid.data.recordingReplacement, false);
  select(invalid, 5);
  invalid.confirmReplacement();
  assert.equal(snapshot(), before); // 无效、取消及已有结果均不能新增或覆盖。
}
for (const change of ['cancelled', 'completed', 'incomplete', 'replacement', 'removed']) {
  const plan = { id: 7, date: '2026-09-26', activity: '跑步', startTime: '22:00' };
  app.globalData.plans.push(plan);
  const stale = mount('record', { planId: '7' });
  stale.startReplacement();
  select(stale, 5);
  if (change === 'cancelled') plan.cancelled = true;
  else if (change === 'removed') app.globalData.plans.pop();
  else plan.result = change === 'incomplete' ? { status: change, reason: '加班' } : change === 'replacement' ? { status: change, actualActivity: '瑜伽' } : { status: change };
  const before = snapshot();
  const existing = plan.result;
  stale.confirmReplacement();
  assert.equal(snapshot(), before);
  assert.equal(plan.result, existing); // 确认时重新读取计划，不能覆盖期间产生的结果。
  if (change !== 'removed') app.globalData.plans.pop();
}
const second = mount('record', { planId: '2' });
second.startReplacement();
select(second, 0);
second.confirmReplacement();
assert.deepEqual(plain(app.globalData.plans[1].result), { status: 'replacement', actualActivity: '瑜伽' });
assert.equal(app.globalData.plans[0].result, result);
assert.equal(app.globalData.plans[0].result.actualActivity, '散步');
assert.equal(JSON.stringify(app.globalData.plans.slice(4)), JSON.stringify(JSON.parse(original).slice(4)));
assert.equal(app.globalData.plans.length, 6);
console.log('PASS: required actual activity, original plan preserved, one result per plan, discard/reopen, repeat identity, same-name isolation, stale/cancelled/existing-result guards');
console.log('PASS: today/week refresh, selected week and edit protection, original feelings preserved, no running draft or unsupported result mutation');
