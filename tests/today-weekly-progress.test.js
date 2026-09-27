(async () => {
const { createTestApp, prepareTestApp } = require('./helpers/runtime');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const weeklyProgress = require('../miniprogram/utils/weekly-progress');

let now = '2026-09-26T04:00:00Z';
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
}
function runtime() { return createTestApp(); }
async function mount(name, app, planId) {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => prepareTestApp(app),
    Page(value) { definition = value; },
    wx: { pageScrollTo() {}, showToast() {}, async showModal(options) { (await options.success({ confirm: true })); } }
  });
  if (name === 'today') assert.deepEqual(plain(definition.data.weeklyProgress), { completed: 0, total: 0 });
  const page = Object.assign({}, definition, {
    data: plain(definition.data),
    setData(value) { Object.assign(this.data, value); }
  });
  if (page.onLoad) (await page.onLoad({ planId: String(planId) }));
  if (page.onShow) (await page.onShow());
  return page;
}
const plain = value => JSON.parse(JSON.stringify(value));
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
const progress = (page, completed, total) => assert.deepEqual(plain(page.data.weeklyProgress), { completed, total });
const app = runtime();
const emptySnapshot = JSON.stringify(app.globalData);
const today = (await mount('today', app));
progress(today, 0, 0);
(await today.onShow());
assert.equal(JSON.stringify(app.globalData), emptySnapshot);
app.globalData.plans.push(
  { id: 1, date: '2026-09-21', activity: '瑜伽', startTime: '08:00' },
  { id: 2, date: '2026-09-22', activity: '跑步', startTime: '09:00' },
  { id: 3, date: '2026-09-25', activity: '网球', startTime: '18:00' },
  { id: 4, date: '2026-09-27', activity: '跑步', startTime: '19:00' },
  { id: 5, date: '2026-09-26', activity: '散步', startTime: '10:00', result: { status: 'completed' } },
  { id: 6, date: '2026-09-24', activity: '瑜伽', startTime: '08:00', cancelled: true, result: { status: 'completed' } }
);
(await today.onShow());
progress(today, 1, 5);
(await today.setPeriod(event('marked', true)));
progress(today, 0, 4);
const completed = (await mount('record', app, 1));
completed.selectActualDate({ detail: { value: '2026-09-21' } });
(await completed.confirmCompleted());
(await today.onShow());
progress(today, 1, 4);
const replacement = (await mount('record', app, 2));
replacement.startReplacement();
replacement.selectActualDate({ detail: { value: '2026-09-22' } });
replacement.selectReplacementActivity({ detail: { value: '5' } });
(await replacement.confirmReplacement());
(await today.onShow());
progress(today, 2, 4);
const incomplete = (await mount('record', app, 3));
incomplete.startIncomplete();
incomplete.selectReason(event('reason', '下雨'));
(await incomplete.confirmIncomplete());
(await today.onShow());
progress(today, 2, 4); // 正常、替代、未完成、未来待记录、免考核各一条。
const originalPlans = JSON.stringify(app.globalData.plans);
(await completed.confirmCompleted());
(await replacement.confirmReplacement());
(await incomplete.confirmIncomplete());
for (let repeat = 0; repeat < 3; repeat++) {
  (await today.onShow());
  progress(today, 2, 4);
  progress((await mount('today', app)), 2, 4);
}
assert.equal(JSON.stringify(app.globalData.plans), originalPlans);
(await today.choosePeriodWalk());
for (const status of ['completed', 'completed', 'incomplete']) {
  (await today.recordPeriodWalk(event('status', status)));
  progress(today, 2, 4);
}
(await today.setPeriod(event('marked', false)));
progress(today, 3, 5);
(await today.setPeriod(event('marked', true)));
progress(today, 2, 4);
assert.equal(JSON.stringify(app.globalData.plans), originalPlans);

now = '2026-09-27T15:59:59Z'; // 北京时间周日 23:59:59。
(await today.onShow());
assert.equal(today.data.date, '2026-09-27');
progress(today, 2, 4);
const beforeWeekBoundary = JSON.stringify(app.globalData);
now = '2026-09-27T16:00:00Z'; // 北京时间周一 00:00:00。
(await today.onShow());
assert.equal(today.data.date, '2026-09-28');
progress(today, 0, 0);
assert.equal(JSON.stringify(app.globalData), beforeWeekBoundary);
const makeup = (await mount('record', app, 3));
makeup.startMakeup();
makeup.selectMakeupDate({ detail: { value: '2026-09-28' } });
makeup.selectMakeupActivity({ detail: { value: '5' } });
(await makeup.confirmMakeup());
const afterMakeup = JSON.stringify(app.globalData);
for (let repeat = 0; repeat < 3; repeat++) {
  (await makeup.confirmMakeup());
  (await today.onShow());
  progress(today, 0, 0);
  assert.deepEqual(weeklyProgress(app.globalData.plans, app.globalData.periodDays, '2026-09-25'), { completed: 3, total: 4 });
}
assert.equal(JSON.stringify(app.globalData), afterMakeup);
assert.equal(app.globalData.plans.length, 6);
assert.equal(app.globalData.plans[2].date, '2026-09-25');
assert.equal(app.globalData.plans[2].result.status, 'incomplete');
assert.equal(app.globalData.plans[2].result.reason, '下雨');

const yearApp = runtime();
yearApp.globalData.plans.push(
  { id: 1, date: '2026-12-28', activity: '瑜伽', startTime: '08:00', result: { status: 'completed' } },
  { id: 2, date: '2027-01-03', activity: '跑步', startTime: '09:00' },
  { id: 3, date: '2027-01-04', activity: '散步', startTime: '10:00', result: { status: 'completed' } }
);
now = '2026-12-31T16:00:00Z';
const yearToday = (await mount('today', yearApp));
assert.equal(yearToday.data.date, '2027-01-01');
progress(yearToday, 1, 2);
now = '2027-01-03T15:59:59Z';
(await yearToday.onShow());
assert.equal(yearToday.data.date, '2027-01-03');
progress(yearToday, 1, 2);
now = '2027-01-03T16:00:00Z';
(await yearToday.onShow());
assert.equal(yearToday.data.date, '2027-01-04');
progress(yearToday, 1, 1);
const noPlans = runtime();
noPlans.globalData.periodDays['2027-01-04'] = true;
noPlans.globalData.periodWalks['2027-01-04'] = { status: 'completed' };
progress((await mount('today', noPlans)), 0, 0);
console.log('PASS: today empty/default state, real record actions produce 2/4, repeat confirmation/refresh and period walk isolation');
console.log('PASS: period mark/unmark recalculates without modifying results, cross-week makeup updates original week only');
console.log('PASS: Beijing Sunday 15:59:59Z/16:00:00Z boundary, cross-year week and read-only refresh');

})().catch(error => { console.error(error); process.exitCode = 1; });
