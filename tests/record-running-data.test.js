(async () => {
const { createTestApp, prepareTestApp } = require('./helpers/runtime');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

function runtime() { return createTestApp(); }
async function mount(app, planId, name = 'record') {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), getApp: () => prepareTestApp(app),
    getCurrentPages: () => [{}, {}],
    Page(value) { definition = value; },
    wx: { pageScrollTo() {}, showToast() {}, navigateBack() {} }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value); }
  });
  (await page.onLoad({ planId }));
  (await page.onShow());
  return page;
}
const input = (page, field, value) => page.inputRunningData({ currentTarget: { dataset: { field } }, detail: { value } });
const choose = async (page, method, key, value) => (await page[method]({ currentTarget: { dataset: { [key]: value } } }));
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
const run = (await mount(app, '1'));
assert.equal(run.data.isRunning, true);
assert.deepEqual(plain(run.data.runningData), empty);
const original = snapshot();
input(run, 'durationMinutes', '30.5');
input(run, 'distanceKm', '5.25');
input(run, 'heartRate', '145');
assert.equal(snapshot(), original); // 输入只是草稿，返回不提交。
assert.deepEqual(plain((await mount(app, 1)).data.runningData), empty);
(await run.confirmCompleted());
const currentResult = () => app.globalData.plans[0].result;
assert.equal(currentResult().status, 'completed');
assert.deepEqual(plain(currentResult().runningData), { durationMinutes: '30.5', distanceKm: '5.25', heartRate: '145' });
assert.deepEqual(plain((await mount(app, 1)).data.runningData), plain(currentResult().runningData));
assert.equal(app.globalData.plans[1].result, undefined);
assert.equal(app.globalData.plans[0].beforeMood, 'low');

// 三项都可以独立留空；0 是用户输入的有效数字，不能把空值转成 0。
const second = (await mount(app, 2));
(await second.confirmCompleted());
assert.deepEqual(plain((await mount(app, 2)).data.runningData), empty);
for (const field of Object.keys(empty)) {
  const editing = (await mount(app, 2));
  for (const key of Object.keys(empty)) input(editing, key, key === field ? '0' : '');
  (await editing.confirmRunningData());
  assert.deepEqual(plain((await mount(app, 2)).data.runningData), { ...empty, [field]: '0' });
}
const clear = (await mount(app, 2));
for (const field of Object.keys(empty)) input(clear, field, '');
(await clear.confirmRunningData());
assert.deepEqual(plain((await mount(app, 2)).data.runningData), empty);

// 无效输入不能通过首次完成或已完成后的补填确认，不能部分写入。
for (const field of Object.keys(empty)) {
  for (const value of ['-1', '-0.5', 'abc', '12abc', 'NaN', 'Infinity', '1.2.3', '0x10', '1e3', '.']) {
    const completed = (await mount(app, 1));
    input(completed, field, value);
    assert.ok(completed.data.runningError, field + ': ' + value);
    const before = snapshot();
    (await completed.confirmRunningData());
    assert.equal(snapshot(), before);
    const fresh = runtime();
    fresh.globalData.plans.push({ id: 10, activity: '跑步', date: '2026-09-26', startTime: '11:00' });
    const pending = (await mount(fresh, 10));
    input(pending, field, value);
    (await pending.confirmCompleted());
    assert.equal(fresh.globalData.plans[0].result, undefined);
  }
}
const fixed = (await mount(app, 1));
input(fixed, 'distanceKm', '-1');
input(fixed, 'distanceKm', '  .75  ');
assert.equal(fixed.data.runningError, '');
(await fixed.confirmRunningData());
assert.equal((await mount(app, 1)).data.runningData.distanceKm, '.75');
const submitted = snapshot();
(await fixed.confirmRunningData());
assert.deepEqual(JSON.parse(snapshot()).map(({ version, ...plan }) => plan), JSON.parse(submitted).map(({ version, ...plan }) => plan));
assert.equal(currentResult().status, 'completed');

// 补填与运动前后感受互不覆盖，修改草稿后离页不覆盖已确认内容。
const mood = (await mount(app, 1, 'mood'));
(await choose(mood, 'selectMood', 'value', 'good'));
mood.inputNote({ detail: { value: '运动后的备注' } });
(await mood.confirmMood());
const dataBeforeMood = plain(currentResult().runningData);
const editing = (await mount(app, 1));
input(editing, 'heartRate', '150');
(await editing.confirmRunningData());
assert.equal(currentResult().afterMood, 'good');
assert.equal(currentResult().afterMoodNote, '运动后的备注');
assert.equal(app.globalData.plans[0].beforeMoodNote, '运动前的备注');
assert.deepEqual(plain(currentResult().runningData), { ...dataBeforeMood, heartRate: '150' });
const saved = snapshot();
input(editing, 'durationMinutes', '999');
(await editing.onShow());
assert.equal(editing.data.runningData.durationMinutes, '999');
assert.equal((await mount(app, 1)).data.runningData.durationMinutes, '30.5');
assert.equal(snapshot(), saved);

// 已有体感选择不重置正在编辑的跑步草稿，跑步确认也不覆盖体感。
input(editing, 'durationMinutes', '40');
(await choose(editing, 'selectFeeling', 'feeling', '适中'));
assert.equal(editing.data.runningData.durationMinutes, '40');
(await editing.confirmRunningData());
assert.equal(currentResult().feeling, '适中');
assert.equal(currentResult().runningData.durationMinutes, '40');
assert.equal(currentResult().afterMood, 'good');

const bypass = (await mount(app, 1));
bypass.setData({ runningData: { ...empty, heartRate: '-5' }, runningError: '' });
const beforeBypass = snapshot();
(await bypass.confirmRunningData());
assert.equal(snapshot(), beforeBypass); // 确认时再次校验，不能只依赖禁用按钮。

// 非跑步、未完成、已取消及失效目标不能补写跑步数据。
assert.equal((await mount(app, 3)).data.isRunning, false);
(await (await mount(app, 3)).confirmCompleted());
for (const id of [3, 4, 5, 999, 'invalid', undefined]) {
  const invalid = (await mount(app, id));
  const before = snapshot();
  input(invalid, 'durationMinutes', '30');
  (await invalid.confirmRunningData());
  assert.equal(snapshot(), before);
}
assert.equal(app.globalData.plans[2].result.runningData, undefined);
const stale = (await mount(app, 1));
input(stale, 'durationMinutes', '20');
const replacement = { status: 'completed', afterMood: 'great' };
app.globalData.plans[0].version += 1;
app.globalData.plans[0].result = replacement;
(await stale.confirmRunningData());
assert.equal(replacement.runningData, undefined);
assert.match(stale.data.saveError, /更新|刷新/);
(await stale.onShow());
assert.equal(stale.data.runningData.durationMinutes, '20');
assert.equal(stale.data.saveConflict, true);
assert.deepEqual(plain((await mount(app, 1)).data.runningData), empty);
const cancelled = (await mount(app, 2));
input(cancelled, 'durationMinutes', '20');
const secondResult = JSON.stringify(app.globalData.plans[1].result);
app.globalData.plans[1].version += 1;
app.globalData.plans[1].cancelled = true;
(await cancelled.confirmRunningData());
assert.equal(JSON.stringify(app.globalData.plans[1].result), secondResult);
delete app.globalData.plans[1].cancelled;

// 修正同一结果保留数据；修正为未完成后不再沿用旧运动数据。
const correction = (await mount(app, 1));
input(correction, 'durationMinutes', '25');
(await correction.confirmRunningData());
correction.startCorrection();
(await correction.confirmCorrection());
assert.equal(currentResult().runningData.durationMinutes, '25');
correction.startCorrection();
(await choose(correction, 'selectCorrectionStatus', 'status', 'incomplete'));
(await choose(correction, 'selectCorrectionReason', 'reason', '加班'));
(await correction.confirmCorrection());
assert.equal(app.globalData.plans[0].result.runningData, undefined);
correction.startCorrection();
(await choose(correction, 'selectCorrectionStatus', 'status', 'completed'));
(await correction.confirmCorrection());
assert.deepEqual(plain((await mount(app, 1)).data.runningData), empty);
assert.equal(app.globalData.plans.length, 5);
assert.equal((await mount(runtime(), 1)).data.plan, null);
console.log('PASS: running data fields, optional blanks and zero, decimals, validation on both confirmations, reopen/clear/discard, plan/mood isolation, stale/cancelled results, correction, isolated async fixtures');

})().catch(error => { console.error(error); process.exitCode = 1; });
