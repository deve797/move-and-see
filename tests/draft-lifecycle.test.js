const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createTestApp } = require('./helpers/runtime');

const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
const input = value => ({ detail: { value } });
const clone = value => JSON.parse(JSON.stringify(value));
const plan = extra => ({ id: 'plan-1', version: 1, date: '2026-09-26', activity: '跑步', startTime: '19:00', ...extra });
async function mount(name, app, clock = { now: '2026-09-26T04:00:00Z' }, query = {}) {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
  }
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  const modals = [];
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => app,
    getCurrentPages: () => [{}, {}], Page(value) { definition = value; },
    wx: { pageScrollTo() {}, showToast() {}, navigateBack() {}, reLaunch() {}, showModal(options) { modals.push(options); } }
  });
  const page = Object.assign({}, definition, {
    data: clone(definition.data), modals,
    setData(value) { Object.assign(this.data, value); }
  });
  if (page.onLoad) await page.onLoad({ planId: 'plan-1', ...query });
  await page.onShow();
  return page;
}

test('today preserves the open before-mood draft across resume while refreshing the current day', async () => {
  const app = createTestApp({ plans: [plan()] });
  const clock = { now: '2026-09-26T04:00:00Z' };
  const today = await mount('today', app, clock);
  today.openBeforeMood(event('id', 'plan-1'));
  today.selectBeforeMood(event('value', 'good'));
  today.inputBeforeMoodNote(input('回来继续填写'));
  const base = today._moodPlan;
  clock.now = '2026-09-26T16:00:00Z';
  await today.onShow();
  assert.equal(today.data.date, '2026-09-27');
  assert.equal(today.data.activities.length, 0);
  assert.equal(today._day.date, '2026-09-27');
  assert.equal(today.data.moodSheetOpen, true);
  assert.equal(today.data.selectedBeforeMood, 'good');
  assert.equal(today.data.beforeMoodNote, '回来继续填写');
  assert.equal(today._moodPlan, base);
  assert.equal(app.globalData.plans[0].beforeMoodNote, undefined);
  await today.confirmBeforeMood();
  today.afterMoodLeave();
  assert.equal(today.data.moodSheetOpen, false);
  assert.equal(app.globalData.plans[0].beforeMoodNote, '回来继续填写');
  assert.equal(app.globalData.plans[0].date, '2026-09-26');
});

test('before-mood failures and conflicts survive resume without adopting a new version', async () => {
  const app = createTestApp({ plans: [plan()] });
  const today = await mount('today', app);
  today.openBeforeMood(event('id', 'plan-1'));
  today.inputBeforeMoodNote(input('仍未保存'));
  app.rejectNext();
  await today.confirmBeforeMood();
  const networkError = today.data.saveError;
  await today.onShow();
  assert.equal(today.data.saveError, networkError);
  assert.equal(today.data.beforeMoodNote, '仍未保存');
  await app.savePlan(plan({ beforeMoodNote: '另一端已保存' }));
  await today.onShow();
  assert.equal(today._moodPlan.version, 1);
  await today.confirmBeforeMood();
  assert.equal(today.data.saveConflict, true);
  await today.onShow();
  assert.equal(today.data.saveConflict, true);
  assert.equal(today.data.beforeMoodNote, '仍未保存');
  assert.equal(app.globalData.plans[0].beforeMoodNote, '另一端已保存');
  today.reloadAfterConflict();
  await today.modals.pop().success({ confirm: true });
  assert.equal(today.data.moodSheetOpen, false);
  assert.equal(today.data.saveError, '');
  today.openBeforeMood(event('id', 'plan-1'));
  assert.equal(today.data.beforeMoodNote, '另一端已保存');
});

test('running draft survives an after-mood round trip and cannot overwrite the newer mood', async () => {
  const app = createTestApp({ plans: [plan({ result: { status: 'completed', runningData: { durationMinutes: '20' } } })] });
  const record = await mount('record', app);
  record.inputRunningData({ ...event('field', 'durationMinutes'), ...input('35') });
  const base = record._plan;
  const mood = await mount('mood', app);
  mood.inputNote(input('新保存的运动后备注'));
  await mood.confirmMood();
  await record.onShow();
  assert.equal(record.data.runningData.durationMinutes, '35');
  assert.equal(record._plan, base);
  await record.confirmRunningData();
  assert.equal(record.data.saveConflict, true);
  assert.equal(record.data.runningData.durationMinutes, '35');
  assert.equal(app.globalData.plans[0].result.afterMoodNote, '新保存的运动后备注');
  assert.equal(app.globalData.plans[0].result.runningData.durationMinutes, '20');
  await record.onShow();
  assert.equal(record.data.saveConflict, true);
  assert.equal(record.data.runningData.durationMinutes, '35');
  record.reloadAfterConflict();
  await record.modals.pop().success({ confirm: true });
  assert.equal(record.data.runningData.durationMinutes, '20');
  assert.equal(record.data.saveConflict, false);
});

for (const scenario of [
  { mode: 'incomplete', original: {}, start: 'startIncomplete', cancel: 'cancelIncomplete', draft: 'recordingIncomplete', value: 'selectedReason', select: page => page.selectReason(event('reason', '下雨')), expected: '下雨', confirm: 'confirmIncomplete' },
  { mode: 'replacement', original: {}, start: 'startReplacement', cancel: 'cancelReplacement', draft: 'recordingReplacement', value: 'actualActivity', select: page => page.selectReplacementActivity(input('5')), expected: '散步', confirm: 'confirmReplacement' },
  { mode: 'makeup', original: { result: { status: 'incomplete', reason: '加班' } }, start: 'startMakeup', cancel: 'cancelMakeup', draft: 'recordingMakeup', value: 'makeupActivity', select: page => { page.selectMakeupDate(input('2026-09-26')); page.selectMakeupActivity(input('5')); }, expected: '散步', confirm: 'confirmMakeup' },
  { mode: 'correction', original: { result: { status: 'completed' } }, start: 'startCorrection', cancel: 'cancelCorrection', draft: 'correcting', value: 'correctionReason', select: page => { page.selectCorrectionStatus(event('status', 'incomplete')); page.selectCorrectionReason(event('reason', '其他')); }, expected: '其他', confirm: 'confirmCorrection' }
]) {
  test(scenario.mode + ' draft and failed save survive resume; explicit cancel still discards', async () => {
    const app = createTestApp({ plans: [plan(scenario.original)] });
    const record = await mount('record', app);
    record[scenario.start]();
    scenario.select(record);
    const base = record._plan;
    await record.onShow();
    assert.equal(record.data[scenario.draft], true);
    assert.equal(record.data[scenario.value], scenario.expected);
    assert.equal(record._plan, base);
    app.rejectNext();
    await record[scenario.confirm]();
    const error = record.data.saveError;
    assert.match(error, /网络/);
    await record.onShow();
    assert.equal(record.data.saveError, error);
    assert.equal(record.data[scenario.draft], true);
    assert.equal(record.data[scenario.value], scenario.expected);
    record[scenario.cancel]();
    assert.equal(record.data[scenario.draft], false);
    assert.equal(record.data.saveError, '');
    assert.deepEqual(app.globalData.plans[0], plan(scenario.original));
  });
}

test('running save retries the preserved draft after network failure and then refreshes normally', async () => {
  const app = createTestApp({ plans: [plan()] });
  const record = await mount('record', app);
  record.inputRunningData({ ...event('field', 'distanceKm'), ...input('5') });
  app.rejectNext();
  await record.confirmCompleted();
  await record.onShow();
  assert.match(record.data.saveError, /网络/);
  assert.equal(record.data.runningData.distanceKm, '5');
  await record.confirmCompleted();
  assert.equal(record.data.saveError, '');
  assert.equal(record.data.completed, true);
  await app.savePlan({ ...clone(app.globalData.plans[0]), result: { ...app.globalData.plans[0].result, afterMoodNote: '新备注' } });
  await record.onShow();
  assert.equal(record._plan.result.afterMoodNote, '新备注');
});

test('after-mood draft survives load failure, save failure and conflicts until explicit discard', async () => {
  const app = createTestApp({ plans: [plan({ result: { status: 'completed', afterMood: 'neutral' } })] });
  const mood = await mount('mood', app);
  mood.selectMood(event('value', 'good'));
  mood.inputNote(input('回来再确认'));
  const base = mood._plan;
  app.rejectNext();
  await mood.onShow();
  assert.match(mood.data.loadError, /网络/);
  await mood.retryLoad();
  assert.equal(mood.data.selectedMood, 'good');
  assert.equal(mood.data.note, '回来再确认');
  assert.equal(mood._plan, base);
  app.rejectNext();
  await mood.confirmMood();
  await mood.onShow();
  assert.match(mood.data.saveError, /网络/);
  await app.savePlan(plan({ result: { status: 'completed', afterMood: 'low', afterMoodNote: '另一端' } }));
  await mood.onShow();
  assert.equal(mood._plan, base);
  await mood.confirmMood();
  assert.equal(mood.data.saveConflict, true);
  await mood.onShow();
  assert.equal(mood.data.saveConflict, true);
  assert.equal(mood.data.note, '回来再确认');
  assert.equal(app.globalData.plans[0].result.afterMoodNote, '另一端');
  mood.reloadAfterConflict();
  await mood.modals.pop().success({ confirm: true });
  assert.equal(mood.data.note, '另一端');
  assert.equal(mood.data.selectedMood, 'low');
  assert.equal(mood.data.saveConflict, false);
});

test('record resume retains the original day version so a changed exemption rejects the old draft', async () => {
  const app = createTestApp({ plans: [plan()] });
  const record = await mount('record', app);
  record.startIncomplete();
  record.selectReason(event('reason', '下雨'));
  await app.saveDay({ ...app.getDay('2026-09-26'), periodMarked: true });
  await record.onShow();
  assert.equal(record._plan._dayVersion, 0);
  await record.confirmIncomplete();
  assert.equal(record.data.saveConflict, true);
  assert.equal(record.data.selectedReason, '下雨');
  assert.equal(app.globalData.plans[0].result, undefined);
});

test('makeup draft survives midnight while the date picker accepts the new today', async () => {
  const app = createTestApp({ plans: [plan({ result: { status: 'incomplete', reason: '加班' } })] });
  const clock = { now: '2026-09-26T15:59:59Z' };
  const record = await mount('record', app, clock);
  record.startMakeup();
  record.selectMakeupDate(input('2026-09-26'));
  record.selectMakeupActivity(input('5'));
  const base = record._plan;
  clock.now = '2026-09-26T16:00:00Z';
  await record.onShow();
  assert.equal(record.data.makeupEndDate, '2026-09-27');
  assert.equal(record.data.recordingMakeup, true);
  assert.equal(record.data.makeupDate, '2026-09-26');
  assert.equal(record.data.makeupActivity, '散步');
  assert.equal(record._plan, base);
  record.selectMakeupDate(input('2026-09-27'));
  assert.equal(record.data.canConfirmMakeup, true);
  await record.confirmMakeup();
  assert.equal(app.globalData.plans[0].result.makeup.date, '2026-09-27');
});

test('makeup after-mood draft preserves deliberate clearing through resume and saves to the makeup', async () => {
  const app = createTestApp({ plans: [plan({ result: { status: 'incomplete', reason: '加班', makeup: { date: '2026-09-26', actualActivity: '散步', afterMood: 'good', afterMoodNote: '旧备注' } } })] });
  const mood = await mount('mood', app, undefined, { makeup: '1' });
  mood.inputNote(input(''));
  await mood.onShow();
  assert.equal(mood.data.note, '');
  assert.equal(mood.data.selectedMood, 'good');
  await mood.confirmMood();
  assert.equal(app.globalData.plans[0].result.makeup.afterMoodNote, '');
  assert.equal(app.globalData.plans[0].result.afterMoodNote, undefined);
});

test('resume after a lost save response retries the original request without a second write', async () => {
  const createStore = require('../miniprogram/utils/cloud-store');
  const state = { plans: [], periodDays: {}, periodWalks: {}, dayVersions: {}, cloudLoaded: false };
  let stored = plan();
  const requests = [];
  const receipts = new Map();
  let writes = 0;
  const store = createStore({ async callFunction({ data }) {
    if (data.action === 'list') return { result: { ok: true, data: { items: data.collection === 'plans' ? [clone(stored)] : [], nextCursor: '' } } };
    requests.push(data);
    if (!receipts.has(data.requestId)) {
      assert.equal(data.expectedVersion, stored.version);
      stored = { ...clone(data.plan), version: stored.version + 1 };
      receipts.set(data.requestId, clone(stored));
      writes += 1;
      throw new Error('response lost after commit');
    }
    return { result: { ok: true, data: receipts.get(data.requestId) } };
  } }, state, 'test-env');
  const record = await mount('record', { globalData: state, ...store });
  record.inputRunningData({ ...event('field', 'distanceKm'), ...input('5') });
  await record.confirmCompleted();
  assert.match(record.data.saveError, /网络/);
  await record.onShow();
  assert.equal(state.plans[0].version, 2);
  assert.equal(record._plan.version, 1);
  assert.equal(record.data.runningData.distanceKm, '5');
  await record.confirmCompleted();
  assert.equal(record.data.completed, true);
  assert.equal(record.data.saveError, '');
  assert.equal(requests[0].requestId, requests[1].requestId);
  assert.equal(writes, 1);
});
