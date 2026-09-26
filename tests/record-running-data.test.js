const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

function runtime() {
  let app;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../miniprogram/app.js'), 'utf8'), {
    App(value) { app = value; }
  });
  return app;
}
function mount(app, planId, name = 'record') {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), getApp: () => app,
    getCurrentPages: () => [{}, {}],
    Page(value) { definition = value; },
    wx: { pageScrollTo() {}, showToast() {}, navigateBack() {} }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value); }
  });
  page.onLoad({ planId });
  page.onShow();
  return page;
}
const input = (page, field, value) => page.inputRunningData({ currentTarget: { dataset: { field } }, detail: { value } });
const choose = (page, method, key, value) => page[method]({ currentTarget: { dataset: { [key]: value } } });
const plain = value => JSON.parse(JSON.stringify(value));
const empty = { durationMinutes: '', distanceKm: '', heartRate: '' };
const app = runtime();
app.globalData.plans.push(
  { id: 1, date: '2026-09-26', activity: '跑步', startTime: '19:00', beforeMood: 'low', beforeMoodNote: '运动前的备注' },
  { id: 2, date: '2026-09-26', activity: '跑步', startTime: '07:00' },
  { id: 3, date: '2026-09-26', activity: '瑜伽', startTime: '08:00' },
  { id: 4, date: '2026-09-26', activity: '跑步', startTime: '09:00', result: { status: 'incomplete', reason: '下雨' } },
  { id: 5, date: '2026-09-26', activity: '跑步', startTime: '10:00', cancelled: true, result: { status: 'completed' } }
);
const snapshot = () => JSON.stringify(app.globalData.plans);
const run = mount(app, '1');
assert.equal(run.data.isRunning, true);
assert.deepEqual(plain(run.data.runningData), empty);
const original = snapshot();
input(run, 'durationMinutes', '30.5');
input(run, 'distanceKm', '5.25');
input(run, 'heartRate', '145');
assert.equal(snapshot(), original); // 输入只是草稿，返回不提交。
assert.deepEqual(plain(mount(app, 1).data.runningData), empty);
run.confirmCompleted();
const result = app.globalData.plans[0].result;
assert.equal(result.status, 'completed');
assert.deepEqual(plain(result.runningData), { durationMinutes: '30.5', distanceKm: '5.25', heartRate: '145' });
assert.deepEqual(plain(mount(app, 1).data.runningData), plain(result.runningData));
assert.equal(app.globalData.plans[1].result, undefined);
assert.equal(app.globalData.plans[0].beforeMood, 'low');

// 三项都可以独立留空；0 是用户输入的有效数字，不能把空值转成 0。
const second = mount(app, 2);
second.confirmCompleted();
assert.deepEqual(plain(mount(app, 2).data.runningData), empty);
for (const field of Object.keys(empty)) {
  const editing = mount(app, 2);
  for (const key of Object.keys(empty)) input(editing, key, key === field ? '0' : '');
  editing.confirmRunningData();
  assert.deepEqual(plain(mount(app, 2).data.runningData), { ...empty, [field]: '0' });
}
const clear = mount(app, 2);
for (const field of Object.keys(empty)) input(clear, field, '');
clear.confirmRunningData();
assert.deepEqual(plain(mount(app, 2).data.runningData), empty);

// 无效输入不能通过首次完成或已完成后的补填确认，不能部分写入。
for (const field of Object.keys(empty)) {
  for (const value of ['-1', '-0.5', 'abc', '12abc', 'NaN', 'Infinity', '1.2.3', '0x10', '1e3', '.']) {
    const completed = mount(app, 1);
    input(completed, field, value);
    assert.ok(completed.data.runningError, field + ': ' + value);
    const before = snapshot();
    completed.confirmRunningData();
    assert.equal(snapshot(), before);
    const fresh = runtime();
    fresh.globalData.plans.push({ id: 10, activity: '跑步', date: '2026-09-26', startTime: '11:00' });
    const pending = mount(fresh, 10);
    input(pending, field, value);
    pending.confirmCompleted();
    assert.equal(fresh.globalData.plans[0].result, undefined);
  }
}
const fixed = mount(app, 1);
input(fixed, 'distanceKm', '-1');
input(fixed, 'distanceKm', '  .75  ');
assert.equal(fixed.data.runningError, '');
fixed.confirmRunningData();
assert.equal(mount(app, 1).data.runningData.distanceKm, '.75');
const submitted = snapshot();
fixed.confirmRunningData();
assert.equal(snapshot(), submitted);
assert.equal(app.globalData.plans[0].result, result);

// 补填与运动前后感受互不覆盖，修改草稿后离页不覆盖已确认内容。
const mood = mount(app, 1, 'mood');
choose(mood, 'selectMood', 'value', 'good');
mood.inputNote({ detail: { value: '运动后的备注' } });
mood.confirmMood();
const dataBeforeMood = plain(result.runningData);
const editing = mount(app, 1);
input(editing, 'heartRate', '150');
editing.confirmRunningData();
assert.equal(result.afterMood, 'good');
assert.equal(result.afterMoodNote, '运动后的备注');
assert.equal(app.globalData.plans[0].beforeMoodNote, '运动前的备注');
assert.deepEqual(plain(result.runningData), { ...dataBeforeMood, heartRate: '150' });
const saved = snapshot();
input(editing, 'durationMinutes', '999');
editing.onShow();
assert.equal(editing.data.runningData.durationMinutes, '30.5');
assert.equal(snapshot(), saved);

// 已有体感选择不重置正在编辑的跑步草稿，跑步确认也不覆盖体感。
input(editing, 'durationMinutes', '40');
choose(editing, 'selectFeeling', 'feeling', '适中');
assert.equal(editing.data.runningData.durationMinutes, '40');
editing.confirmRunningData();
assert.equal(result.feeling, '适中');
assert.equal(result.runningData.durationMinutes, '40');
assert.equal(result.afterMood, 'good');

const bypass = mount(app, 1);
bypass.setData({ runningData: { ...empty, heartRate: '-5' }, runningError: '' });
const beforeBypass = snapshot();
bypass.confirmRunningData();
assert.equal(snapshot(), beforeBypass); // 确认时再次校验，不能只依赖禁用按钮。

// 非跑步、未完成、已取消及失效目标不能补写跑步数据。
assert.equal(mount(app, 3).data.isRunning, false);
mount(app, 3).confirmCompleted();
for (const id of [3, 4, 5, 999, 'invalid', undefined]) {
  const invalid = mount(app, id);
  const before = snapshot();
  input(invalid, 'durationMinutes', '30');
  invalid.confirmRunningData();
  assert.equal(snapshot(), before);
}
assert.equal(app.globalData.plans[2].result.runningData, undefined);
const stale = mount(app, 1);
input(stale, 'durationMinutes', '20');
const replacement = { status: 'completed', afterMood: 'great' };
app.globalData.plans[0].result = replacement;
stale.confirmRunningData();
assert.equal(replacement.runningData, undefined);
assert.deepEqual(plain(stale.data.runningData), empty);
const cancelled = mount(app, 2);
input(cancelled, 'durationMinutes', '20');
const secondResult = JSON.stringify(app.globalData.plans[1].result);
app.globalData.plans[1].cancelled = true;
cancelled.confirmRunningData();
assert.equal(JSON.stringify(app.globalData.plans[1].result), secondResult);
delete app.globalData.plans[1].cancelled;

// 修正同一结果保留数据；修正为未完成后不再沿用旧运动数据。
const correction = mount(app, 1);
input(correction, 'durationMinutes', '25');
correction.confirmRunningData();
correction.startCorrection();
correction.confirmCorrection();
assert.equal(replacement.runningData.durationMinutes, '25');
correction.startCorrection();
choose(correction, 'selectCorrectionStatus', 'status', 'incomplete');
choose(correction, 'selectCorrectionReason', 'reason', '加班');
correction.confirmCorrection();
assert.equal(app.globalData.plans[0].result.runningData, undefined);
correction.startCorrection();
choose(correction, 'selectCorrectionStatus', 'status', 'completed');
correction.confirmCorrection();
assert.deepEqual(plain(mount(app, 1).data.runningData), empty);
assert.equal(app.globalData.plans.length, 5);
assert.equal(mount(runtime(), 1).data.plan, null);
console.log('PASS: running data fields, optional blanks and zero, decimals, validation on both confirmations, reopen/clear/discard, plan/mood isolation, stale/cancelled results, correction, runtime-only state');
