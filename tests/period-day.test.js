const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

let now = '2026-09-26T04:00:00Z';
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
}
function runtime() {
  let app;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../miniprogram/app.js'), 'utf8'), {
    App(value) { app = value; }
  });
  return app;
}
function mount(name, app, planId) {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => app,
    Page(value) { definition = value; },
    wx: { pageScrollTo() {}, showToast() {}, showModal(options) { options.success({ confirm: true }); } }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value); }
  });
  if (page.onLoad) page.onLoad(planId === undefined ? {} : { planId: String(planId) });
  if (page.onShow) page.onShow();
  return page;
}
const plain = value => JSON.parse(JSON.stringify(value));
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
const setPeriod = (page, marked) => page.setPeriod(event('marked', marked));
const app = runtime();
assert.ok(app.globalData.periodDays && typeof app.globalData.periodDays === 'object', 'new runtime provides an empty date-based period marker map');
assert.deepEqual(plain(app.globalData.periodDays), {});
const today = mount('today', app);
assert.equal(today.data.periodMarked, false);
setPeriod(today, true);
assert.deepEqual(plain(app.globalData.periodDays), { '2026-09-26': true });
assert.equal(today.data.periodMarked, true);
assert.deepEqual(plain(app.globalData.plans), []); // 没有计划也只标记日期，不生成计划或结果。
setPeriod(today, true);
assert.deepEqual(plain(app.globalData.periodDays), { '2026-09-26': true });
setPeriod(today, false);
setPeriod(today, false);
assert.equal(today.data.periodMarked, false);
assert.equal(Boolean(app.globalData.periodDays['2026-09-26']), false);

app.globalData.plans.push(
  { id: 1, date: '2026-09-26', activity: '跑步', startTime: '09:00', beforeMood: 'low', beforeMoodNote: '今天有点累' },
  { id: 2, date: '2026-09-26', activity: '跑步', startTime: '07:00', beforeMood: 'good', beforeMoodNote: '运动前原话', result: { status: 'completed', feeling: '适中', afterMood: 'great', afterMoodNote: '运动后原话', runningData: { durationMinutes: '30', distanceKm: '5', heartRate: '120' } } },
  { id: 3, date: '2026-09-26', activity: '瑜伽', startTime: '08:00', result: { status: 'incomplete', reason: '加班' } },
  { id: 4, date: '2026-09-26', activity: '跑步', startTime: '08:30', result: { status: 'replacement', actualActivity: '散步' } },
  { id: 5, date: '2026-09-26', activity: '网球', startTime: '09:30', beforeMood: 'down', beforeMoodNote: '原运动前备注', result: { status: 'incomplete', reason: '下雨', makeup: { date: '2026-09-26', actualActivity: '瑜伽', feeling: '轻松', afterMood: 'good', afterMoodNote: '补做的备注' } } },
  { id: 6, date: '2026-09-26', activity: '散步', startTime: '19:00', cancelled: true, result: { status: 'completed' } },
  { id: 7, date: '2026-09-25', activity: '跑步', startTime: '19:00' },
  { id: 8, date: '2026-09-27', activity: '跑步', startTime: '19:00' }
);
const original = JSON.stringify(app.globalData.plans);
const references = app.globalData.plans.map(plan => ({
  plan, result: plan.result,
  runningData: plan.result && plan.result.runningData,
  makeup: plan.result && plan.result.makeup
}));
function assertOriginal() {
  assert.equal(JSON.stringify(app.globalData.plans), original);
  references.forEach((ref, index) => {
    const plan = app.globalData.plans[index];
    assert.equal(plan, ref.plan);
    assert.equal(plan.result, ref.result);
    if (ref.result) {
      assert.equal(plan.result.runningData, ref.runningData);
      assert.equal(plan.result.makeup, ref.makeup);
    }
  });
}
const week = mount('week', app);
const weekPlans = page => page.data.days.flatMap(day => day.plans);
const staleIncomplete = mount('record', app, 1);
staleIncomplete.startIncomplete();
staleIncomplete.selectReason(event('reason', '加班'));
assert.equal(staleIncomplete.data.canConfirmIncomplete, true);
const staleCompletedCorrection = mount('record', app, 2);
staleCompletedCorrection.startCorrection();
staleCompletedCorrection.selectCorrectionStatus(event('status', 'incomplete'));
staleCompletedCorrection.selectCorrectionReason(event('reason', '下雨'));
const staleIncompleteCorrection = mount('record', app, 3);
staleIncompleteCorrection.startCorrection();
staleIncompleteCorrection.selectCorrectionStatus(event('status', 'completed'));

today.onShow();
setPeriod(today, true);
assert.equal(today.data.periodMarked, true);
assert.equal(today.data.activities.length, 5);
assert.equal(today.data.activities.every(item => item.periodExempt === true), true);
assert.equal(today.data.activities.find(item => item.id === 1).completed, false);
assert.equal(today.data.activities.find(item => item.id === 3).completed, false);
assert.equal(today.data.activities.find(item => item.id === 2).completed, true);
assert.equal(today.data.activities.find(item => item.id === 4).completed, true);
assert.equal(today.data.activities.find(item => item.id === 5).completed, true);
assertOriginal(); // 标记覆盖展示，不将免考核写成完成或清除既有结果。
week.onShow();
for (const plan of weekPlans(week)) {
  assert.equal(plan.periodExempt, plan.date === '2026-09-26');
}
assert.equal(weekPlans(week).some(plan => plan.id === 6), false);
assert.equal(weekPlans(week).find(plan => plan.id === 1).pendingRecord, false);
for (const id of [1, 2, 3, 4, 5]) {
  const record = mount('record', app, id);
  assert.equal(record.data.periodExempt, true);
  assert.equal(record.data.canCorrect, [2, 3].includes(id));
  record.startIncomplete();
  assert.equal(record.data.recordingIncomplete, false);
  assert.equal(record.data.canConfirmIncomplete, false);
  record.selectReason(event('reason', '身体不适'));
  record.confirmIncomplete();
  record.startCorrection();
  assert.equal(record.data.correcting, [2, 3].includes(id));
  record.cancelCorrection();
  assertOriginal();
}
for (const id of [6, 7, 8, 999]) {
  assert.equal(mount('record', app, id).data.periodExempt, false);
}
staleIncomplete.confirmIncomplete();
assert.equal(staleIncomplete.data.recordingIncomplete, false);
staleCompletedCorrection.confirmCorrection();
staleIncompleteCorrection.confirmCorrection();
assert.equal(staleCompletedCorrection.data.correcting, false);
assert.equal(staleIncompleteCorrection.data.correcting, false);
assertOriginal(); // 标记前已打开的原因或修正草稿，在确认时仍重新校验。

const reopened = mount('today', app);
assert.equal(reopened.data.periodMarked, true);
assert.equal(reopened.data.activities.every(item => item.periodExempt === true), true);
setPeriod(reopened, true);
assertOriginal();
setPeriod(reopened, false);
assert.equal(reopened.data.periodMarked, false);
assert.equal(reopened.data.activities.every(item => item.periodExempt === false), true);
assert.equal(reopened.data.activities.find(item => item.id === 1).completed, false);
week.onShow();
assert.equal(weekPlans(week).every(plan => plan.periodExempt === false), true);
assert.equal(weekPlans(week).find(plan => plan.id === 1).pendingRecord, true);
assert.equal(mount('record', app, 2).data.canCorrect, true);
assert.equal(mount('record', app, 3).data.canCorrect, true);
assert.equal(mount('record', app, 4).data.canCorrect, false);
assert.equal(mount('record', app, 5).data.canCorrect, false);
assertOriginal();
for (const marked of [false, true, true, false]) {
  setPeriod(reopened, marked);
  assertOriginal();
}

setPeriod(reopened, true);
week.startAdding();
week.updateDraft({ date: '2026-09-26', activity: '瑜伽', startTime: '20:00' });
week.confirmAdding();
const added = app.globalData.plans[8];
assert.equal(added.id, 9);
assert.equal(added.result, undefined);
assert.equal(weekPlans(week).find(plan => plan.id === added.id).periodExempt, true);
reopened.onShow();
assert.equal(reopened.data.activities.find(item => item.id === added.id).periodExempt, true);
assert.equal(mount('record', app, added.id).data.periodExempt, true);
week.startEditing(event('id', 8));
week.updateDraft({ date: '2026-09-26' });
week.confirmAdding();
assert.equal(app.globalData.plans[7].date, '2026-09-26');
assert.equal(weekPlans(week).find(plan => plan.id === 8).periodExempt, true);
assert.equal(mount('record', app, 8).data.periodExempt, true);
week.startEditing(event('id', 8));
week.updateDraft({ date: '2026-09-27' });
week.confirmAdding();
assert.equal(weekPlans(week).find(plan => plan.id === 8).periodExempt, false);
assert.equal(mount('record', app, 8).data.periodExempt, false);
reopened.onShow();
assert.equal(reopened.data.activities.some(item => item.id === 8), false);
week.cancelPlan(event('id', added.id));
reopened.onShow();
assert.equal(added.cancelled, true);
assert.equal(reopened.data.activities.some(item => item.id === added.id), false);
assert.equal(mount('record', app, added.id).data.periodExempt, false);
assert.deepEqual(plain(app.globalData.plans.slice(0, 8)), JSON.parse(original));

const voluntaryApp = runtime();
voluntaryApp.globalData.plans.push(
  { id: 1, date: '2026-09-26', activity: '瑜伽', startTime: '18:00' },
  { id: 2, date: '2026-09-26', activity: '跑步', startTime: '19:00' },
  { id: 3, date: '2026-09-26', activity: '网球', startTime: '20:00' }
);
const voluntaryToday = mount('today', voluntaryApp);
setPeriod(voluntaryToday, true);
const completed = mount('record', voluntaryApp, 1);
assert.equal(completed.data.canComplete, true);
completed.confirmCompleted();
assert.equal(voluntaryApp.globalData.plans[0].result.status, 'completed');
const replacement = mount('record', voluntaryApp, 2);
replacement.startReplacement();
replacement.selectReplacementActivity({ detail: { value: '5' } });
replacement.confirmReplacement();
assert.deepEqual(plain(voluntaryApp.globalData.plans[1].result), { status: 'replacement', actualActivity: '散步' });
const voluntaryResults = JSON.stringify(voluntaryApp.globalData.plans);
setPeriod(voluntaryToday, false);
assert.equal(JSON.stringify(voluntaryApp.globalData.plans), voluntaryResults);
const restored = mount('record', voluntaryApp, 3);
restored.startIncomplete();
assert.equal(restored.data.recordingIncomplete, true);
assert.equal(restored.data.canConfirmIncomplete, false);
restored.confirmIncomplete();
assert.equal(voluntaryApp.globalData.plans[2].result, undefined);
restored.selectReason(event('reason', '加班'));
restored.confirmIncomplete();
assert.deepEqual(plain(voluntaryApp.globalData.plans[2].result), { status: 'incomplete', reason: '加班' });
const restoredCorrection = mount('record', voluntaryApp, 1);
restoredCorrection.startCorrection();
restoredCorrection.selectCorrectionStatus(event('status', 'incomplete'));
restoredCorrection.confirmCorrection();
assert.equal(voluntaryApp.globalData.plans[0].result.status, 'completed');
restoredCorrection.selectCorrectionReason(event('reason', '下雨'));
restoredCorrection.confirmCorrection();
assert.deepEqual(plain(voluntaryApp.globalData.plans[0].result), { status: 'incomplete', reason: '下雨' });

const staleMark = mount('today', app);
const staleUnmark = mount('today', app);
const beforeMidnight = JSON.stringify(app.globalData);
now = '2026-09-26T16:00:00Z'; // 北京时间午夜；旧页点击只刷新，不误写新一天。
setPeriod(staleMark, true);
assert.equal(staleMark.data.date, '2026-09-27');
assert.equal(staleMark.data.periodMarked, false);
assert.equal(JSON.stringify(app.globalData), beforeMidnight);
assert.equal(staleMark.data.activities.every(item => item.periodExempt === false), true);
assert.equal(mount('record', app, 1).data.periodExempt, true); // 昨日标记按原日期保留。
const newDay = mount('today', app);
setPeriod(newDay, true);
const newDayMarked = JSON.stringify(app.globalData);
setPeriod(staleUnmark, false);
assert.equal(staleUnmark.data.date, '2026-09-27');
assert.equal(staleUnmark.data.periodMarked, true);
assert.equal(JSON.stringify(app.globalData), newDayMarked);
setPeriod(newDay, false);
assert.equal(app.globalData.periodDays['2026-09-26'], true);
assert.equal(Boolean(app.globalData.periodDays['2026-09-27']), false);
assert.equal(mount('record', app, 8).data.periodExempt, false);
week.onShow();
assert.equal(weekPlans(week).find(plan => plan.id === 1).periodExempt, true);
assert.equal(weekPlans(week).find(plan => plan.id === 8).periodExempt, false);
const freshApp = runtime();
assert.deepEqual(plain(freshApp.globalData.periodDays), {});
assert.deepEqual(plain(freshApp.globalData.plans), []);
assert.equal(mount('today', freshApp).data.periodMarked, false);

console.log('PASS: date marker, no-plan state, same-name multi-plan exemption, other dates/cancellation, existing result and nested feeling identity');
console.log('PASS: repeat mark/unmark, recreated pages, no automatic completion/reason, stale incomplete/correction guards, restored rules');
console.log('PASS: added/moved plans follow date, voluntary completion/replacement, Beijing midnight stale-page protection, fresh runtime');
