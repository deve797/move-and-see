const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createTestApp } = require('./helpers/runtime');

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-09-26T04:00:00Z'])); }
}
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
const clone = value => JSON.parse(JSON.stringify(value));
const plan = extra => ({ id: 'plan-1', version: 1, date: '2026-09-26', activity: '跑步', startTime: '19:00', ...extra });
async function mount(name, app, query = {}) {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  const navigation = [];
  const modals = [];
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => app,
    getCurrentPages: () => [{}, {}], Page(value) { definition = value; },
    wx: {
      pageScrollTo() {}, showToast() {}, showModal(options) { modals.push(options); },
      navigateBack() { navigation.push('back'); }, reLaunch() { navigation.push('home'); }
    }
  });
  const page = Object.assign({}, definition, {
    data: clone(definition.data), navigation, modals,
    setData(value) { Object.assign(this.data, value); }
  });
  if (page.onLoad) await page.onLoad(query);
  if (page.onShow) await page.onShow();
  return page;
}

test('new plan waits for server, rejects duplicate taps, preserves failed draft, and retries once', async () => {
  const app = createTestApp();
  const week = await mount('week', app);
  week.startAdding(event('date', '2026-09-27'));
  week.selectActivity({ detail: { value: '0' } });
  week.selectStartTime({ detail: { value: [19, 2] } });
  const originalSave = app.savePlan;
  let reject;
  let calls = 0;
  app.savePlan = () => { calls += 1; return new Promise((resolve, fail) => { reject = fail; }); };
  const saving = week.confirmAdding();
  assert.equal(week.data.saving, true);
  assert.equal(app.globalData.plans.length, 0);
  await week.confirmAdding();
  assert.equal(calls, 1);
  reject(new Error('网络暂时不可用'));
  await saving;
  assert.equal(week.data.saving, false);
  assert.equal(week.data.adding, true);
  assert.equal(week.data.draft.activity, '瑜伽');
  assert.equal(week.data.draft.date, '2026-09-27');
  assert.equal(week.data.draft.startTime, '19:20');
  assert.deepEqual(Array.from(week.data.startTimeIndex), [19, 2]);
  assert.match(week.data.saveError, /网络/);
  assert.equal(week.data.saveConflict, false);
  week.reloadAfterConflict();
  assert.equal(week.modals.length, 0);
  assert.equal(app.globalData.plans.length, 0);
  app.savePlan = originalSave;
  await week.confirmAdding();
  assert.equal(week.data.adding, false);
  assert.equal(app.globalData.plans.length, 1);
  assert.equal(app.globalData.plans[0].version, 1);
  assert.equal(app.globalData.plans[0].date, '2026-09-27');
  assert.equal(app.globalData.plans[0].startTime, '19:20');
  assert.equal(typeof app.globalData.plans[0].id, 'string');
});

test('failed completion keeps entered running data and does not create a result', async () => {
  const app = createTestApp({ plans: [plan()] });
  const record = await mount('record', app, { planId: 'plan-1' });
  record.inputRunningData({ currentTarget: { dataset: { field: 'durationMinutes' } }, detail: { value: '30' } });
  record.inputRunningData({ currentTarget: { dataset: { field: 'distanceKm' } }, detail: { value: '5' } });
  const original = clone(app.globalData.plans);
  app.rejectNext();
  await record.confirmCompleted();
  assert.deepEqual(app.globalData.plans, original);
  assert.equal(record.data.completed, false);
  assert.equal(record.data.runningData.durationMinutes, '30');
  assert.match(record.data.saveError, /网络/);
  await record.confirmCompleted();
  assert.equal(app.globalData.plans[0].result.status, 'completed');
  assert.equal(app.globalData.plans[0].result.runningData.distanceKm, '5');
  assert.equal(app.globalData.plans[0].version, 2);
});

test('stale record version cannot overwrite a later result', async () => {
  const app = createTestApp({ plans: [plan()] });
  const first = await mount('record', app, { planId: 'plan-1' });
  const stale = await mount('record', app, { planId: 'plan-1' });
  await first.confirmCompleted();
  const saved = clone(app.globalData.plans);
  await stale.confirmCompleted();
  assert.deepEqual(app.globalData.plans, saved);
  assert.equal(app.globalData.plans[0].version, 2);
});

test('failed mood save preserves the note and stays on the current page', async () => {
  const app = createTestApp({ plans: [plan({ result: { status: 'completed' } })] });
  const mood = await mount('mood', app, { planId: 'plan-1' });
  mood.selectMood(event('value', 'good'));
  mood.inputNote({ detail: { value: '保留输入的备注' } });
  const original = clone(app.globalData.plans);
  app.rejectNext();
  await mood.confirmMood();
  assert.deepEqual(app.globalData.plans, original);
  assert.deepEqual(mood.navigation, []);
  assert.equal(mood.data.note, '保留输入的备注');
  assert.match(mood.data.saveError, /网络/);
  await mood.confirmMood();
  assert.equal(app.globalData.plans[0].result.afterMoodNote, '保留输入的备注');
  assert.deepEqual(mood.navigation, ['back']);
});

test('day save is atomic and a stale day cannot overwrite a newer choice', async () => {
  const app = createTestApp();
  const today = await mount('today', app);
  app.rejectNext();
  await today.setPeriod(event('marked', true));
  assert.deepEqual(app.globalData.periodDays, {});
  assert.equal(today.data.periodMarked, false);
  assert.match(today.data.saveError, /网络/);
  await today.setPeriod(event('marked', true));
  const stale = await mount('today', app);
  await today.choosePeriodWalk();
  await today.recordPeriodWalk(event('status', 'completed'));
  const saved = clone(app.globalData);
  await stale.setPeriod(event('marked', false));
  assert.deepEqual(app.globalData, saved);
  assert.match(stale.data.saveError, /更新|刷新/);
  assert.equal(app.globalData.periodWalks['2026-09-26'].status, 'completed');
});

test('load failure is visible and retry restores server-backed content', async () => {
  const app = createTestApp({ plans: [plan()] });
  app.rejectNext(new Error('云端暂时不可用'));
  const today = await mount('today', app);
  assert.equal(today.data.loading, false);
  assert.match(today.data.loadError, /云端/);
  assert.equal(today.data.activities.length, 0);
  await today.retryLoad();
  assert.equal(today.data.loadError, '');
  assert.equal(today.data.activities[0].id, 'plan-1');
});


test('conflict recovery keeps the mood draft on cancel and reloads only after explicit discard', async () => {
  const app = createTestApp({ plans: [plan({ result: { status: 'completed', afterMoodNote: '原备注' } })] });
  const mood = await mount('mood', app, { planId: 'plan-1' });
  mood.inputNote({ detail: { value: '未保存的草稿' } });
  await app.savePlan(plan({ result: { status: 'completed', afterMood: 'good', afterMoodNote: '另一端的新备注' } }));
  await mood.confirmMood();
  assert.equal(mood.data.saveConflict, true);
  assert.equal(mood.data.note, '未保存的草稿');
  const originalLoad = app.loadData;
  let reloads = 0;
  app.loadData = async () => { reloads += 1; return originalLoad(); };
  mood.reloadAfterConflict();
  await mood.modals.pop().success({ confirm: false });
  assert.equal(reloads, 0);
  assert.equal(mood.data.saveConflict, true);
  assert.equal(mood.data.note, '未保存的草稿');
  mood.reloadAfterConflict();
  await mood.modals.pop().success({ confirm: true });
  assert.equal(reloads, 1);
  assert.equal(mood.data.saveConflict, false);
  assert.equal(mood.data.saveError, '');
  assert.equal(mood.data.note, '另一端的新备注');
  assert.equal(mood.data.selectedMood, 'good');
  assert.deepEqual(mood.navigation, []);
});

test('day-version conflict recovery refreshes exemption and discards the old incomplete draft', async () => {
  const app = createTestApp({ plans: [plan()] });
  const record = await mount('record', app, { planId: 'plan-1' });
  record.startIncomplete();
  record.selectReason(event('reason', '下雨'));
  const day = app.getDay('2026-09-26');
  await app.saveDay({ ...day, periodMarked: true });
  await record.confirmIncomplete();
  assert.equal(record.data.saveConflict, true);
  assert.equal(record.data.recordingIncomplete, true);
  assert.equal(record.data.selectedReason, '下雨');
  assert.equal(app.globalData.plans[0].result, undefined);
  record.reloadAfterConflict();
  await record.modals.pop().success({ confirm: true });
  assert.equal(record.data.saveConflict, false);
  assert.equal(record.data.recordingIncomplete, false);
  assert.equal(record.data.periodExempt, true);
  assert.equal(app.globalData.plans[0].result, undefined);
});
