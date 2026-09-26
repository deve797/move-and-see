const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

let now = '2026-09-26T04:00:00Z';
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
}
const plain = value => JSON.parse(JSON.stringify(value));
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
const plan = (id, date, change = {}) => ({ id, date, activity: '瑜伽', startTime: '09:00', ...change });
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
    Page(value) { definition = value; }, wx: { pageScrollTo() {}, showToast() {} }
  });
  const page = Object.assign({}, definition, {
    data: plain(definition.data),
    setData(value, callback) { Object.assign(this.data, value); if (callback) callback(); }
  });
  if (page.onLoad) page.onLoad(planId === undefined ? {} : { planId: String(planId) });
  if (page.onShow) page.onShow();
  return page;
}
function refresh(review, today, app) {
  const snapshot = JSON.stringify(app.globalData);
  const references = app.globalData.plans.map(item => [item, item.result, item.result && item.result.makeup]);
  review.onShow();
  today.onShow();
  assert.equal(JSON.stringify(app.globalData), snapshot, '刷新统计不修改临时记录及数组顺序');
  references.forEach(([item, result, makeup], index) => {
    assert.equal(app.globalData.plans[index], item);
    assert.equal(item.result, result);
    assert.equal(item.result && item.result.makeup, makeup);
  });
  const weeks = plain(review.data.weeks);
  assert.equal(weeks.length, 4);
  assert.deepEqual(weeks.map(item => item.isCurrent), [false, false, false, true]);
  const current = weeks[3];
  assert.deepEqual({ completed: current.completed, total: current.total }, plain(today.data.weeklyProgress));
  assert.deepEqual(plain(review.data.weeklyProgress), plain(today.data.weeklyProgress));
  return weeks;
}
function progress(week, completed, total, rate) {
  assert.deepEqual({ completed: week.completed, total: week.total, rate: week.rate }, { completed, total, rate });
}
function ranges(weeks, expected) {
  assert.deepEqual(weeks.map(item => [item.startDate, item.endDate]), expected);
}

const app = runtime();
const review = mount('review', app);
const today = mount('today', app);
let weeks = refresh(review, today, app);
ranges(weeks, [
  ['2026-08-31', '2026-09-06'], ['2026-09-07', '2026-09-13'],
  ['2026-09-14', '2026-09-20'], ['2026-09-21', '2026-09-27']
]);
assert.deepEqual(weeks.map(item => item.emptyLabel), ['无数据', '无数据', '无数据', '无考核计划']);
weeks.forEach(item => progress(item, 0, 0, null));
app.globalData.plans.push(
  plan(1, '2026-09-21'), plan(2, '2026-09-22'), plan(3, '2026-09-25'),
  plan(4, '2026-09-27'), // 未来计划也进入本周分母。
  plan(5, '2026-09-26', { result: { status: 'completed' } }),
  plan(6, '2026-09-24', { cancelled: true, result: { status: 'completed' } }),
  plan(7, '2026-09-07', { cancelled: true, result: { status: 'completed' } }),
  plan(8, '2026-09-13', { result: { status: 'completed' } }),
  plan(9, '2026-09-14', { result: { status: 'completed' } }),
  plan(10, '2026-09-19'), plan(11, '2026-09-20'),
  plan(12, '2026-08-30', { result: { status: 'completed' } }),
  plan(13, '2026-09-28', { result: { status: 'completed' } })
);
app.globalData.periodDays['2026-09-13'] = true;
today.onShow();
today.setPeriod(event('marked', true));
weeks = refresh(review, today, app);
assert.equal(weeks[0].emptyLabel, '无数据');
assert.equal(weeks[1].emptyLabel, '无考核计划');
progress(weeks[1], 0, 0, null);
progress(weeks[2], 1, 3, 33);
progress(weeks[3], 0, 4, 0);

const completed = mount('record', app, 1);
completed.confirmCompleted();
progress(refresh(review, today, app)[3], 1, 4, 25);
const replacement = mount('record', app, 2);
replacement.startReplacement();
replacement.selectReplacementActivity({ detail: { value: '5' } });
replacement.confirmReplacement();
progress(refresh(review, today, app)[3], 2, 4, 50);
const incomplete = mount('record', app, 3);
incomplete.startIncomplete();
incomplete.selectReason(event('reason', '下雨'));
incomplete.confirmIncomplete();
progress(refresh(review, today, app)[3], 2, 4, 50);
completed.startCorrection();
completed.selectCorrectionStatus(event('status', 'incomplete'));
completed.selectCorrectionReason(event('reason', '加班'));
completed.confirmCorrection();
progress(refresh(review, today, app)[3], 1, 4, 25);
completed.startCorrection();
completed.selectCorrectionStatus(event('status', 'completed'));
completed.confirmCorrection();
progress(refresh(review, today, app)[3], 2, 4, 50);

today.choosePeriodWalk();
today.recordPeriodWalk(event('status', 'completed'));
progress(refresh(review, today, app)[3], 2, 4, 50);
today.setPeriod(event('marked', false));
progress(refresh(review, today, app)[3], 3, 5, 60);
today.setPeriod(event('marked', true));
progress(refresh(review, today, app)[3], 2, 4, 50);
app.globalData.plans[0].cancelled = true;
progress(refresh(review, today, app)[3], 1, 3, 33);
app.globalData.plans[0].cancelled = false;
progress(refresh(review, today, app)[3], 2, 4, 50);
const confirmedSnapshot = JSON.stringify(app.globalData);
for (let repeat = 0; repeat < 3; repeat++) {
  completed.confirmCompleted();
  replacement.confirmReplacement();
  incomplete.confirmIncomplete();
  assert.deepEqual(refresh(mount('review', app), today, app), refresh(review, today, app));
}
assert.equal(JSON.stringify(app.globalData), confirmedSnapshot);

now = '2026-09-27T15:59:59Z';
weeks = refresh(review, today, app);
assert.equal(weeks[3].startDate, '2026-09-21');
progress(weeks[3], 2, 4, 50);
now = '2026-09-27T16:00:00Z';
weeks = refresh(review, today, app);
ranges(weeks, [
  ['2026-09-07', '2026-09-13'], ['2026-09-14', '2026-09-20'],
  ['2026-09-21', '2026-09-27'], ['2026-09-28', '2026-10-04']
]);
progress(weeks[2], 2, 4, 50);
progress(weeks[3], 1, 1, 100);
const makeup = mount('record', app, 3);
makeup.startMakeup();
makeup.selectMakeupDate({ detail: { value: '2026-09-28' } });
makeup.selectMakeupActivity({ detail: { value: '5' } });
makeup.confirmMakeup();
weeks = refresh(review, today, app);
progress(weeks[2], 3, 4, 75);
progress(weeks[3], 1, 1, 100);
assert.equal(app.globalData.plans.length, 13);
assert.equal(app.globalData.plans[2].date, '2026-09-25');
assert.equal(app.globalData.plans[2].result.status, 'incomplete');
assert.equal(app.globalData.plans[2].result.reason, '下雨');
const makeupSnapshot = JSON.stringify(app.globalData);
makeup.confirmMakeup();
assert.deepEqual(refresh(mount('review', app), today, app), weeks);
assert.equal(JSON.stringify(app.globalData), makeupSnapshot);

const yearApp = runtime();
yearApp.globalData.plans = [
  plan(1, '2026-12-28', { result: { status: 'completed' } }),
  plan(2, '2027-01-03'), plan(3, '2027-01-04', { result: { status: 'completed' } })
];
now = '2026-12-31T16:00:00Z';
const yearReview = mount('review', yearApp);
const yearToday = mount('today', yearApp);
weeks = refresh(yearReview, yearToday, yearApp);
ranges(weeks, [
  ['2026-12-07', '2026-12-13'], ['2026-12-14', '2026-12-20'],
  ['2026-12-21', '2026-12-27'], ['2026-12-28', '2027-01-03']
]);
progress(weeks[3], 1, 2, 50);
now = '2027-01-03T15:59:59Z';
assert.deepEqual(refresh(yearReview, yearToday, yearApp), weeks);
now = '2027-01-03T16:00:00Z';
weeks = refresh(yearReview, yearToday, yearApp);
assert.equal(weeks[0].startDate, '2026-12-14');
assert.equal(weeks[2].endDate, '2027-01-03');
assert.equal(weeks[3].startDate, '2027-01-04');
progress(weeks[2], 1, 2, 50);
progress(weeks[3], 1, 1, 100);

const restartedApp = runtime();
restartedApp.globalData.periodDays['2027-01-04'] = true;
restartedApp.globalData.periodWalks['2027-01-04'] = { status: 'completed' };
weeks = refresh(mount('review', restartedApp), mount('today', restartedApp), restartedApp);
assert.deepEqual(weeks.map(item => item.emptyLabel), ['无数据', '无数据', '无数据', '无考核计划']);
weeks.forEach(item => progress(item, 0, 0, null));
console.log('PASS: real completion/replacement/correction and cross-week makeup refresh four-week rates; current week matches today');
console.log('PASS: continuous Beijing weeks across month/year boundaries, missing-history versus no-assessment states and rounding');
console.log('PASS: exemptions/restoration, cancellation, separate walk isolation, repeated confirmation, re-entry and read-only refresh');
