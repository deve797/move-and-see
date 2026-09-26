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
function mount(app, name = 'today', planId) {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => app,
    Page(value) { definition = value; }, wx: {}
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value); }
  });
  if (page.onLoad) page.onLoad({ planId: String(planId) });
  page.onShow();
  return page;
}
const plain = value => JSON.parse(JSON.stringify(value));
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
const mark = (page, value) => page.setPeriod(event('marked', value));
const record = (page, value) => page.recordPeriodWalk(event('status', value));
const app = runtime();
assert.ok(app.globalData.periodWalks, 'new runtime provides a separate map for voluntary walks');
assert.deepEqual(plain(app.globalData.periodWalks), {});
const today = mount(app);
assert.equal(today.data.periodWalk, null);
today.choosePeriodWalk();
record(today, 'completed');
assert.deepEqual(plain(app.globalData.periodWalks), {});
mark(today, true);
assert.equal(today.data.periodWalk, null, 'marking a period day does not choose a walk');
record(today, 'incomplete');
assert.deepEqual(plain(app.globalData.periodWalks), {}, 'recording requires an explicit choice');
today.choosePeriodWalk();
assert.deepEqual(plain(today.data.periodWalk), { status: 'pending' });
assert.deepEqual(plain(app.globalData.plans), [], 'a voluntary walk also works without original plans');
const walk = app.globalData.periodWalks['2026-09-26'];
today.choosePeriodWalk();
assert.equal(app.globalData.periodWalks['2026-09-26'], walk);
record(today, 'incomplete');
assert.deepEqual(plain(walk), { status: 'incomplete' }, 'no reason is required or invented');
assert.equal(app.globalData.periodDays['2026-09-26'], true);
assert.equal(mount(app).data.periodWalk.status, 'incomplete');

app.globalData.plans.push(
  { id: 1, date: '2026-09-26', activity: '散步', startTime: '09:00' },
  { id: 2, date: '2026-09-26', activity: '跑步', startTime: '08:00', beforeMood: 'good', result: { status: 'completed', afterMood: 'great', runningData: { durationMinutes: '30', distanceKm: '5' } } },
  { id: 3, date: '2026-09-26', activity: '瑜伽', startTime: '10:00', result: { status: 'incomplete', reason: '加班' } },
  { id: 4, date: '2026-09-26', activity: '跑步', startTime: '11:00', result: { status: 'replacement', actualActivity: '散步' } },
  { id: 5, date: '2026-09-26', activity: '网球', startTime: '12:00', result: { status: 'incomplete', reason: '下雨', makeup: { date: '2026-09-26', actualActivity: '散步', feeling: '轻松' } } },
  { id: 6, date: '2026-09-27', activity: '瑜伽', startTime: '13:00' },
  { id: 7, date: '2026-09-26', activity: '散步', startTime: '14:00', cancelled: true }
);
const original = JSON.stringify(app.globalData.plans);
const refs = app.globalData.plans.map(plan => ({ plan, result: plan.result, makeup: plan.result && plan.result.makeup, runningData: plan.result && plan.result.runningData }));
function assertOriginal() {
  assert.equal(JSON.stringify(app.globalData.plans), original);
  refs.forEach((ref, index) => {
    const plan = app.globalData.plans[index];
    assert.equal(plan, ref.plan);
    assert.equal(plan.result, ref.result);
    if (plan.result) {
      assert.equal(plan.result.makeup, ref.makeup);
      assert.equal(plan.result.runningData, ref.runningData);
    }
  });
}
for (const status of ['completed', 'completed', 'incomplete', 'incomplete']) {
  today.onShow();
  record(today, status);
  today.choosePeriodWalk();
  assert.equal(today.data.periodWalk.status, status, 'repeat choice never resets the recorded result');
  assert.equal(app.globalData.periodWalks['2026-09-26'], walk);
  assert.equal(app.globalData.periodDays['2026-09-26'], true);
  assert.equal(today.data.activities.length, 5);
  assert.equal(today.data.activities.every(item => item.periodExempt), true);
  const weekPlans = mount(app, 'week').data.days.flatMap(day => day.plans);
  for (const id of [1, 2, 3, 4, 5]) {
    assert.equal(weekPlans.find(plan => plan.id === id).periodExempt, true);
    const page = mount(app, 'record', id);
    assert.equal(page.data.plan.id, id);
    assert.equal(page.data.periodExempt, true);
  }
  assert.equal(mount(app, 'record', 6).data.periodExempt, false);
  assertOriginal();
}
record(today, 'replacement');
record(today, 'pending');
assert.equal(walk.status, 'incomplete');
const stale = mount(app);
mark(today, false);
assert.equal(today.data.periodWalk, null);
record(stale, 'completed');
stale.choosePeriodWalk();
assert.equal(walk.status, 'incomplete');
assert.equal(stale.data.periodMarked, false);
assert.equal(stale.data.periodWalk, null);
assertOriginal();
mark(today, true);
assert.equal(today.data.periodWalk.status, 'incomplete');
assert.equal(mount(app).data.periodWalk.status, 'incomplete');

const oldChoice = mount(app);
const oldResult = mount(app);
const beforeMidnight = JSON.stringify(app.globalData);
now = '2026-09-26T16:00:00Z';
oldChoice.choosePeriodWalk();
record(oldResult, 'completed');
assert.equal(oldChoice.data.date, '2026-09-27');
assert.equal(oldResult.data.date, '2026-09-27');
assert.equal(oldResult.data.periodWalk, null);
assert.equal(JSON.stringify(app.globalData), beforeMidnight);
const nextDay = mount(app);
mark(nextDay, true);
assert.equal(nextDay.data.periodWalk, null);
nextDay.choosePeriodWalk();
record(nextDay, 'completed');
assert.equal(app.globalData.periodWalks['2026-09-27'].status, 'completed');
assert.equal(walk.status, 'incomplete');
assert.deepEqual(plain(app.globalData.periodDays), { '2026-09-26': true, '2026-09-27': true });
assertOriginal();
const fresh = runtime();
assert.deepEqual(plain(fresh.globalData.periodWalks), {});
assert.equal(mount(fresh).data.periodWalk, null);

console.log('PASS: voluntary-only walk, empty plans, reason-free independent results, repeat choice/result, reopen and runtime-only state');
console.log('PASS: original plans/results/feelings preserved, same-name isolation, today/week/record exemption, unmark/re-mark and stale guards');
console.log('PASS: invalid status, Beijing midnight protection and date isolation');
