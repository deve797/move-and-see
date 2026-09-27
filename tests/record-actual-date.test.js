const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createTestApp } = require('./helpers/runtime');

const input = value => ({ detail: { value } });
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
const clone = value => JSON.parse(JSON.stringify(value));
const plan = extra => ({ id: 'plan-1', version: 1, date: '2026-09-26', activity: '跑步', startTime: '19:00', ...extra });
async function mount(app, clock = { now: '2026-09-26T04:00:00Z' }, name = 'record') {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
  }
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  const toasts = [];
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => app,
    getCurrentPages: () => [{}, {}], Page(value) { definition = value; },
    wx: { pageScrollTo() {}, showToast(options) { toasts.push(options.title); }, navigateBack() {} }
  });
  const page = Object.assign({}, definition, {
    data: clone(definition.data), toasts,
    setData(value) { Object.assign(this.data, value); }
  });
  await page.onLoad({ planId: 'plan-1' });
  await page.onShow();
  return page;
}

// 当前日不比较具体开始时刻，允许提前做完后直接记一笔。
test('same-day completion defaults to today even before the planned time', async () => {
  const app = createTestApp({ plans: [plan()] });
  const record = await mount(app);
  assert.equal(record.data.actualDate, '2026-09-26');
  assert.equal(record.data.needsActualDate, false);
  assert.equal(record.data.canComplete, true);
  await record.confirmCompleted();
  assert.equal(app.globalData.plans[0].result.status, 'completed');
  assert.equal(app.globalData.plans[0].result.actualDate, '2026-09-26');
  assert.equal(record.data.resultActualDate, '2026-09-26');
  assert.equal(record.data.isLateCompletion, false);
  const saved = clone(app.globalData.plans);
  await record.confirmCompleted();
  assert.deepEqual(app.globalData.plans, saved);
});

test('past plans require a choice and distinguish late entry from a later exercise day', async () => {
  for (const [actualDate, isLate] of [['2026-09-25', false], ['2026-09-26', true]]) {
    const original = plan({ date: '2026-09-25' });
    const app = createTestApp({ plans: [original] });
    const record = await mount(app);
    assert.equal(record.data.needsActualDate, true);
    assert.equal(record.data.actualDateChosen, false);
    await record.confirmCompleted();
    assert.equal(app.globalData.plans[0].result, undefined);
    record.selectActualDate(input(actualDate));
    assert.equal(record.data.actualDateChosen, true);
    await record.confirmCompleted();
    const saved = app.globalData.plans[0];
    assert.equal(saved.date, '2026-09-25');
    assert.equal(saved.startTime, '19:00');
    assert.equal(saved.result.status, 'completed');
    assert.equal(saved.result.actualDate, actualDate);
    assert.equal(saved.result.makeup, undefined);
    assert.equal(saved.result.reason, undefined);
    const reopened = await mount(app);
    assert.equal(reopened.data.resultActualDate, actualDate);
    assert.equal(reopened.data.isLateCompletion, isLate);
  }
});

test('actual dates must be real calendar dates from the planned day through Beijing today', async () => {
  for (const value of ['', '2026-09-24', '2026-09-27', '2026-02-30', '2026-9-26', 'invalid']) {
    const app = createTestApp({ plans: [plan({ date: '2026-09-25' })] });
    const record = await mount(app);
    record.selectActualDate(input(value));
    await record.confirmCompleted();
    assert.equal(app.globalData.plans[0].result, undefined, value);
    // 提交仍检查日期，不能只依赖 picker 范围或按钮状态。
    record.setData({ actualDate: value, actualDateChosen: true, canComplete: true });
    await record.confirmCompleted();
    assert.equal(app.globalData.plans[0].result, undefined, value);
  }
  const leapClock = { now: '2028-02-29T16:00:00Z' };
  const app = createTestApp({ plans: [plan({ date: '2028-02-28' })] });
  const record = await mount(app, leapClock);
  record.selectActualDate(input('2028-02-29'));
  await record.confirmCompleted();
  assert.equal(app.globalData.plans[0].result.actualDate, '2028-02-29');
});

test('future plans cannot record completed or replacement results', async () => {
  const app = createTestApp({ plans: [plan({ date: '2026-09-27' })] });
  const record = await mount(app);
  assert.equal(record.data.canComplete, false);
  record.selectActualDate(input('2026-09-27'));
  await record.confirmCompleted();
  record.startReplacement();
  record.selectReplacementActivity(input('5'));
  await record.confirmReplacement();
  assert.equal(app.globalData.plans[0].result, undefined);
});

test('chosen date and running data survive resume and failed save, while reopening discards an unsaved draft', async () => {
  const app = createTestApp({ plans: [plan({ date: '2026-09-24' })] });
  const record = await mount(app);
  record.selectActualDate(input('2026-09-25'));
  record.inputRunningData({ ...event('field', 'durationMinutes'), ...input('30') });
  record.inputRunningData({ ...event('field', 'distanceKm'), ...input('5') });
  await record.onShow();
  assert.equal(record.data.actualDate, '2026-09-25');
  assert.equal(record.data.actualDateChosen, true);
  assert.equal(record.data.runningData.distanceKm, '5');
  const reopenedBeforeSave = await mount(app);
  assert.equal(reopenedBeforeSave.data.actualDateChosen, false);
  assert.equal(reopenedBeforeSave.data.runningData.distanceKm, '');
  app.rejectNext();
  await record.confirmCompleted();
  assert.equal(app.globalData.plans[0].result, undefined);
  assert.match(record.data.saveError, /网络/);
  await record.onShow();
  assert.equal(record.data.actualDate, '2026-09-25');
  assert.equal(record.data.runningData.durationMinutes, '30');
  await record.confirmCompleted();
  assert.equal(app.globalData.plans[0].result.actualDate, '2026-09-25');
  assert.deepEqual(app.globalData.plans[0].result.runningData, { durationMinutes: '30', distanceKm: '5', heartRate: '' });
  const reopened = await mount(app);
  assert.equal(reopened.data.resultActualDate, '2026-09-25');
  assert.equal(reopened.data.runningData.distanceKm, '5');
});

test('a date-only draft survives resume without requiring running input', async () => {
  const app = createTestApp({ plans: [plan({ date: '2026-09-24', activity: '瑜伽' })] });
  const record = await mount(app);
  record.selectActualDate(input('2026-09-25'));
  const version = record._plan.version;
  await record.onShow();
  assert.equal(record.data.actualDate, '2026-09-25');
  assert.equal(record.data.actualDateChosen, true);
  assert.equal(record._plan.version, version);
  await record.confirmCompleted();
  assert.equal(app.globalData.plans[0].result.actualDate, '2026-09-25');
});

test('crossing Beijing midnight requires an explicit date instead of using yesterday automatically', async () => {
  for (const resume of [false, true]) {
    const app = createTestApp({ plans: [plan()] });
    const clock = { now: '2026-09-26T15:59:59Z' };
    const record = await mount(app, clock);
    record.inputRunningData({ ...event('field', 'distanceKm'), ...input('5') });
    clock.now = '2026-09-26T16:00:00Z';
    if (resume) await record.onShow();
    await record.confirmCompleted();
    assert.equal(app.globalData.plans[0].result, undefined);
    assert.equal(record.data.needsActualDate, true);
    assert.equal(record.data.actualDateChosen, false);
    assert.equal(record.data.runningData.distanceKm, '5');
    record.selectActualDate(input('2026-09-26'));
    await record.confirmCompleted();
    assert.equal(app.globalData.plans[0].result.actualDate, '2026-09-26');
    assert.equal(record.data.isLateCompletion, false);
  }
});

test('a future running draft becomes completable when its planned day begins', async () => {
  const app = createTestApp({ plans: [plan({ date: '2026-09-27' })] });
  const clock = { now: '2026-09-26T15:59:00Z' };
  const record = await mount(app, clock);
  record.inputRunningData({ ...event('field', 'durationMinutes'), ...input('30') });
  assert.equal(record.data.canComplete, false);
  clock.now = '2026-09-26T16:00:00Z';
  await record.onShow();
  assert.equal(record.data.runningData.durationMinutes, '30');
  assert.equal(record.data.actualDate, '2026-09-27');
  assert.equal(record.data.needsActualDate, false);
  assert.equal(record.data.canComplete, true);
  await record.confirmCompleted();
  assert.equal(app.globalData.plans[0].result.actualDate, '2026-09-27');
  assert.equal(app.globalData.plans[0].result.runningData.durationMinutes, '30');
});

test('past replacement requires both an explicit date and an activity and preserves them on retry', async () => {
  const app = createTestApp({ plans: [plan({ date: '2026-09-25' })] });
  const record = await mount(app);
  record.startReplacement();
  record.selectReplacementActivity(input('5'));
  assert.equal(record.data.canConfirmReplacement, false);
  await record.confirmReplacement();
  assert.equal(app.globalData.plans[0].result, undefined);
  record.selectActualDate(input('2026-09-26'));
  assert.equal(record.data.canConfirmReplacement, true);
  app.rejectNext();
  await record.confirmReplacement();
  await record.onShow();
  assert.equal(record.data.recordingReplacement, true);
  assert.equal(record.data.actualDate, '2026-09-26');
  assert.equal(record.data.actualActivity, '散步');
  await record.confirmReplacement();
  assert.deepEqual(app.globalData.plans[0].result, { status: 'replacement', actualActivity: '散步', actualDate: '2026-09-26' });
  assert.equal((await mount(app)).data.isLateCompletion, true);
});

test('choosing the exercise date before replacement keeps that choice', async () => {
  const app = createTestApp({ plans: [plan({ date: '2026-09-24' })] });
  const record = await mount(app);
  record.selectActualDate(input('2026-09-25'));
  record.startReplacement();
  assert.equal(record.data.actualDate, '2026-09-25');
  assert.equal(record.data.actualDateChosen, true);
  assert.equal(record.data.canConfirmReplacement, false);
  record.selectReplacementActivity(input('0'));
  await record.confirmReplacement();
  assert.deepEqual(app.globalData.plans[0].result, { status: 'replacement', actualActivity: '瑜伽', actualDate: '2026-09-25' });
});

test('correcting past incomplete to completed requires its actual date and leaves existing makeup rules intact', async () => {
  const app = createTestApp({ plans: [plan({ date: '2026-09-25', result: { status: 'incomplete', reason: '下雨' } })] });
  const record = await mount(app);
  record.startCorrection();
  record.selectCorrectionStatus(event('status', 'completed'));
  assert.equal(record.data.canConfirmCorrection, false);
  await record.confirmCorrection();
  assert.equal(app.globalData.plans[0].result.status, 'incomplete');
  record.selectActualDate(input('2026-09-26'));
  assert.equal(record.data.canConfirmCorrection, true);
  app.rejectNext();
  await record.confirmCorrection();
  await record.onShow();
  assert.equal(record.data.correcting, true);
  assert.equal(record.data.actualDate, '2026-09-26');
  await record.confirmCorrection();
  assert.deepEqual(app.globalData.plans[0].result, { status: 'completed', actualDate: '2026-09-26' });
  assert.equal(record.data.isLateCompletion, true);
  assert.equal(record.data.canMakeup, false);
});

test('legacy completed results stay undated on unchanged correction and current metadata preserves known actual dates', async () => {
  for (const actualDate of [undefined, '2026-09-25', '2026-09-26']) {
    const original = { status: 'completed', feeling: '轻松', afterMood: 'good', runningData: { durationMinutes: '30', distanceKm: '5', heartRate: '' } };
    if (actualDate) original.actualDate = actualDate;
    const app = createTestApp({ plans: [plan({ date: '2026-09-25', result: original })] });
    const record = await mount(app);
    record.startCorrection();
    await record.confirmCorrection();
    assert.deepEqual(app.globalData.plans[0].result, original);
    await record.selectFeeling(event('feeling', '适中'));
    record.inputRunningData({ ...event('field', 'heartRate'), ...input('140') });
    await record.confirmRunningData();
    const mood = await mount(app, undefined, 'mood');
    mood.inputNote(input('保留实际运动日期'));
    await mood.confirmMood();
    assert.equal(app.globalData.plans[0].result.actualDate, actualDate);
    assert.equal(app.globalData.plans[0].result.feeling, '适中');
    assert.equal(app.globalData.plans[0].result.runningData.heartRate, '140');
    assert.equal(app.globalData.plans[0].result.afterMoodNote, '保留实际运动日期');
  }
});
