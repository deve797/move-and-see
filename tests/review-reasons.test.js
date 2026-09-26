(async () => {
const { createTestApp, prepareTestApp } = require('./helpers/runtime');
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
const group = (reason, count, makeupCount = 0) => ({ reason, count, makeupCount });
function runtime() { return createTestApp(); }
async function mount(name, app, planId) {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => prepareTestApp(app),
    Page(value) { definition = value; },
    wx: { showToast() {}, pageScrollTo() {}, showToast() {} }
  });
  const page = Object.assign({}, definition, {
    data: plain(definition.data),
    setData(value, callback) { Object.assign(this.data, value); if (callback) callback(); }
  });
  if (page.onLoad) (await page.onLoad(planId === undefined ? {} : { planId: String(planId) }));
  if (page.onShow) (await page.onShow());
  return page;
}
async function check(page, app, expected) {
  const snapshot = JSON.stringify(app.globalData);
  const references = app.globalData.plans.map(plan => ({ plan, result: plan.result }));
  (await page.onShow());
  assert.deepEqual(plain(page.data.reasonGroups), expected);
  assert.equal(JSON.stringify(app.globalData), snapshot, '原因汇总只读，不修改原记录及顺序');
  references.forEach((reference, index) => {
    assert.equal(app.globalData.plans[index], reference.plan);
    assert.equal(app.globalData.plans[index].result, reference.result);
  });
}
async function recordIncomplete(app, id, reason) {
  const page = (await mount('record', app, id));
  page.startIncomplete();
  page.selectReason(event('reason', reason));
  (await page.confirmIncomplete());
  return page;
}
async function correct(page, status, reason) {
  page.startCorrection();
  page.selectCorrectionStatus(event('status', status));
  if (reason) page.selectCorrectionReason(event('reason', reason));
  (await page.confirmCorrection());
}
async function makeup(page, date) {
  page.startMakeup();
  page.selectMakeupDate({ detail: { value: date } });
  page.selectMakeupActivity({ detail: { value: '5' } });
  (await page.confirmMakeup());
}

const markedApp = runtime();
markedApp.globalData.plans = [
  { id: 1, date: '2026-09-26', activity: '瑜伽', startTime: '08:00' },
  { id: 2, date: '2026-09-26', activity: '跑步', startTime: '09:00' }
];
(await recordIncomplete(markedApp, 1, '加班'));
const markedMakeup = (await recordIncomplete(markedApp, 2, '加班'));
(await makeup(markedMakeup, '2026-09-26'));
const markedReview = (await mount('review', markedApp));
const markedToday = (await mount('today', markedApp));
const markedReasons = [group('加班', 2, 1)];
(await check(markedReview, markedApp, markedReasons));
(await markedToday.setPeriod(event('marked', true)));
(await check(markedReview, markedApp, markedReasons)); // 免考核不抹掉已明确填写的原原因和补做子计数。
assert.deepEqual(plain(markedReview.data.weeklyProgress), { completed: 0, total: 0 });
assert.equal(markedReview.data.hasResults, false, '免考核仍从进度和结果分类排除');
(await check((await mount('review', markedApp)), markedApp, markedReasons));
(await markedToday.setPeriod(event('marked', false)));
(await check(markedReview, markedApp, markedReasons));
assert.deepEqual(plain(markedReview.data.weeklyProgress), { completed: 1, total: 2 });

const app = runtime();
const review = (await mount('review', app));
(await check(review, app, []));
app.globalData.plans.push(
  { id: 3, date: '2026-09-23', activity: '网球', startTime: '18:00' },
  { id: 2, date: '2026-09-22', activity: '跑步', startTime: '19:00' },
  { id: 1, date: '2026-09-21', activity: '跑步', startTime: '19:00' },
  { id: 4, date: '2026-09-24', activity: '瑜伽', startTime: '19:00' },
  { id: 5, date: '2026-09-25', activity: '跑步', startTime: '07:00' },
  { id: 6, date: '2026-09-26', activity: '瑜伽', startTime: '08:00' },
  { id: 7, date: '2026-09-27', activity: '跑步', startTime: '19:00' },
  { id: 8, date: '2026-09-20', activity: '跑步', startTime: '19:00', result: { status: 'incomplete', reason: '身体不适', makeup: { date: '2026-09-21', actualActivity: '散步' } } },
  { id: 9, date: '2026-09-28', activity: '瑜伽', startTime: '19:00', result: { status: 'incomplete', reason: '其他' } },
  { id: 10, date: '2026-09-24', activity: '网球', startTime: '09:00', cancelled: true, result: { status: 'incomplete', reason: '临时有事' } }
);
(await check(review, app, [])); // 待补记录、未来计划和本周补做的上周计划不能自动归因。
const first = (await recordIncomplete(app, 1, '加班'));
const second = (await recordIncomplete(app, 2, '加班'));
const rain = (await recordIncomplete(app, 3, '下雨'));
const completed = (await mount('record', app, 4));
(await completed.confirmCompleted());
const initial = [group('加班', 2), group('下雨', 1)];
(await check(review, app, initial)); // 按计划日期排序，不按全局数组插入顺序。
(await check((await mount('review', app)), app, initial));

(await makeup(first, '2026-09-26'));
const withMakeup = [group('加班', 2, 1), group('下雨', 1)];
(await check(review, app, withMakeup));
const confirmed = JSON.stringify(app.globalData);
for (let repeat = 0; repeat < 3; repeat++) {
  (await first.confirmMakeup());
  (await second.confirmIncomplete());
  (await check(review, app, withMakeup));
  (await check((await mount('review', app)), app, withMakeup));
}
assert.equal(JSON.stringify(app.globalData), confirmed, '补做重复确认或重进回看不能重复计数');
assert.equal(app.globalData.plans.find(plan => plan.id === 1).result.reason, '加班');

(await correct(rain, 'incomplete', '加班'));
(await check(review, app, [group('加班', 3, 1)]));
(await correct(rain, 'completed'));
(await check(review, app, [group('加班', 2, 1)]));
assert.equal(app.globalData.plans.find(plan => plan.id === 3).result.reason, undefined);
(await correct(rain, 'incomplete', '下雨'));
(await check(review, app, withMakeup));
(await correct(completed, 'incomplete', '其他'));
(await check(review, app, [...withMakeup, group('其他', 1)])); // 仅明确选择“其他”才出现该原因。
(await correct(completed, 'completed'));
(await check(review, app, withMakeup));

const today = (await mount('today', app));
(await today.setPeriod(event('marked', true)));
const exempt = (await mount('record', app, 6));
exempt.startIncomplete();
exempt.selectReason(event('reason', '身体不适'));
(await exempt.confirmIncomplete());
assert.equal(app.globalData.plans.find(plan => plan.id === 6).result, undefined);
(await today.choosePeriodWalk());
for (const status of ['incomplete', 'completed']) {
  (await today.recordPeriodWalk(event('status', status)));
  (await check(review, app, withMakeup));
}
app.globalData.periodDays['2026-09-21'] = true;
(await check(review, app, withMakeup));
app.globalData.periodDays['2026-09-21'] = false;
(await check(review, app, withMakeup)); // 标记及取消免考核均不改变原原因和补做子计数。

now = '2026-09-27T15:59:59Z';
(await check(review, app, withMakeup));
now = '2026-09-27T16:00:00Z';
(await check(review, app, [group('其他', 1)])); // 北京时间周一零点换周。
(await makeup(second, '2026-09-28'));
(await check(review, app, [group('其他', 1)]));
(await second.confirmMakeup());
assert.equal(app.globalData.plans.length, 10);
assert.equal(app.globalData.plans.find(plan => plan.id === 2).date, '2026-09-22');
now = '2026-09-26T04:00:00Z'; // 固定查看原周，跨周补做仍归原计划。
(await check(review, app, [group('加班', 2, 2), group('下雨', 1)]));
(await check((await mount('review', app)), app, [group('加班', 2, 2), group('下雨', 1)]));

const emptyApp = runtime();
emptyApp.globalData.plans = [
  { id: 20, date: '2026-09-21', startTime: '07:00' },
  { id: 21, date: '2026-09-21', startTime: '08:00', result: { status: 'incomplete' } },
  { id: 22, date: '2026-09-21', startTime: '09:00', result: { status: 'incomplete', reason: '' } },
  { id: 23, date: '2026-09-22', startTime: '09:00', result: { status: 'completed' } },
  { id: 24, date: '2026-09-23', startTime: '09:00', result: { status: 'replacement', actualActivity: '散步' } },
  { id: 25, date: '2026-09-26', startTime: '09:00', result: { status: 'incomplete', reason: '' } }
];
emptyApp.globalData.periodDays = { '2026-09-26': true };
emptyApp.globalData.periodWalks = { '2026-09-26': { status: 'incomplete' } };
(await check((await mount('review', emptyApp)), emptyApp, []));
app.globalData.plans = [];
(await check(review, app, [])); // 原有分布清空后必须刷新为空，不能残留上次计数。

const yearApp = runtime();
yearApp.globalData.plans = [
  { id: 30, date: '2026-12-27', startTime: '19:00', result: { status: 'incomplete', reason: '其他' } },
  { id: 31, date: '2026-12-28', startTime: '19:00', result: { status: 'incomplete', reason: '加班' } },
  { id: 32, date: '2027-01-03', startTime: '19:00', result: { status: 'incomplete', reason: '下雨' } },
  { id: 33, date: '2027-01-04', startTime: '19:00', result: { status: 'incomplete', reason: '身体不适' } }
];
now = '2026-12-31T16:00:00Z';
const yearReview = (await mount('review', yearApp));
(await check(yearReview, yearApp, [group('加班', 1), group('下雨', 1)]));
now = '2027-01-03T15:59:59Z';
(await check(yearReview, yearApp, [group('加班', 1), group('下雨', 1)]));
now = '2027-01-03T16:00:00Z';
(await check(yearReview, yearApp, [group('身体不适', 1)]));

console.log('PASS: two overtime/one rain reasons, same/cross-week makeup subsets, repeated confirmation and original-week attribution');
console.log('PASS: live reason/result corrections, return/reopen refresh, read-only aggregation and empty states');
console.log('PASS: pending/missing reasons, explicit reasons preserved across period marking, independent walks, cancelled/out-of-week plans and Beijing/year week boundaries');

})().catch(error => { console.error(error); process.exitCode = 1; });
