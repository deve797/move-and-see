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
const keys = ['completed', 'replacement', 'makeup', 'incomplete'];
const labels = ['按计划完成', '替代完成', '补做', '仍未完成'];
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
async function check(review, today, expected, completed, total) {
  (await review.onShow());
  (await today.onShow());
  assert.deepEqual(plain(review.data.weeklyProgress), { completed, total });
  assert.deepEqual(plain(review.data.weeklyProgress), plain(today.data.weeklyProgress));
  const groups = review.data.resultGroups;
  assert.deepEqual(plain(groups.map(group => group.key)), keys);
  assert.deepEqual(plain(groups.map(group => group.label)), labels);
  groups.forEach((group, index) => {
    assert.deepEqual(plain(group.plans.map(plan => plan.id).sort((a, b) => a - b)), expected[index], group.key);
  });
  const ids = groups.flatMap(group => group.plans.map(plan => plan.id));
  assert.equal(new Set(ids).size, ids.length, '一条计划只能出现在一个结果分类');
  assert.equal(groups.slice(0, 3).reduce((sum, group) => sum + group.plans.length, 0), completed);
  assert.equal(review.data.hasResults, ids.length > 0);
}
const emptyGroups = [[], [], [], []];
const app = runtime();
const review = (await mount('review', app));
const today = (await mount('today', app));
const emptySnapshot = JSON.stringify(app.globalData);
(await check(review, today, emptyGroups, 0, 0));
assert.equal(JSON.stringify(app.globalData), emptySnapshot);

app.globalData.plans.push(
  { id: 1, date: '2026-09-21', activity: '跑步', startTime: '08:00' },
  { id: 2, date: '2026-09-22', activity: '跑步', startTime: '08:00' },
  { id: 3, date: '2026-09-25', activity: '网球', startTime: '18:00' },
  { id: 4, date: '2026-09-27', activity: '瑜伽', startTime: '19:00' },
  { id: 5, date: '2026-09-26', activity: '散步', startTime: '10:00', result: { status: 'completed' } },
  { id: 6, date: '2026-09-24', activity: '跑步', startTime: '09:00', cancelled: true, result: { status: 'completed' } },
  { id: 7, date: '2026-09-20', activity: '跑步', startTime: '09:00', result: { status: 'completed' } },
  { id: 8, date: '2026-09-28', activity: '跑步', startTime: '09:00', result: { status: 'completed' } }
);
(await today.onShow());
(await today.setPeriod(event('marked', true)));
(await check(review, today, emptyGroups, 0, 4)); // 有安排但尚未记录，不能自动判为未完成。
const completedPage = (await mount('record', app, 1));
completedPage.selectActualDate({ detail: { value: completedPage.data.plan.date } });
(await completedPage.confirmCompleted());
(await check(review, today, [[1], [], [], []], 1, 4));
const replacementPage = (await mount('record', app, 2));
replacementPage.startReplacement();
replacementPage.selectReplacementActivity({ detail: { value: '5' } });
replacementPage.selectActualDate({ detail: { value: replacementPage.data.plan.date } });
(await replacementPage.confirmReplacement());
(await check(review, today, [[1], [2], [], []], 2, 4));
const incompletePage = (await mount('record', app, 3));
incompletePage.startIncomplete();
incompletePage.selectReason(event('reason', '下雨'));
(await incompletePage.confirmIncomplete());
(await check(review, today, [[1], [2], [], [3]], 2, 4));
assert.equal(review.data.resultGroups[1].plans[0].activity, '跑步');
assert.equal(review.data.resultGroups[1].plans[0].result.actualActivity, '散步');
assert.equal(review.data.resultGroups[3].plans[0].result.reason, '下雨');

completedPage.startCorrection();
completedPage.selectCorrectionStatus(event('status', 'incomplete'));
completedPage.selectCorrectionReason(event('reason', '加班'));
(await completedPage.confirmCorrection());
(await check(review, today, [[], [2], [], [1, 3]], 1, 4));
assert.equal(review.data.resultGroups[3].plans.find(plan => plan.id === 1).result.reason, '加班');
completedPage.startCorrection();
completedPage.selectCorrectionStatus(event('status', 'completed'));
completedPage.selectActualDate({ detail: { value: completedPage.data.plan.date } });
(await completedPage.confirmCorrection());
(await check(review, today, [[1], [2], [], [3]], 2, 4));
assert.equal(review.data.resultGroups[0].plans[0].result.reason, undefined);

const originalPlans = JSON.stringify(app.globalData.plans);
(await today.choosePeriodWalk());
for (const status of ['completed', 'incomplete']) {
  (await today.recordPeriodWalk(event('status', status)));
  (await check(review, today, [[1], [2], [], [3]], 2, 4));
}
(await today.setPeriod(event('marked', false)));
(await check(review, today, [[1, 5], [2], [], [3]], 3, 5));
(await today.setPeriod(event('marked', true)));
(await check(review, today, [[1], [2], [], [3]], 2, 4));
assert.equal(JSON.stringify(app.globalData.plans), originalPlans);

app.globalData.periodDays['2026-09-21'] = true;
(await check(review, today, [[], [2], [], [3]], 1, 3));
app.globalData.periodDays['2026-09-21'] = false;
(await check(review, today, [[1], [2], [], [3]], 2, 4));
delete app.globalData.periodDays['2026-09-21'];
const beforeRefresh = JSON.stringify(app.globalData);
const references = app.globalData.plans.map(plan => ({ plan, result: plan.result }));
for (let repeat = 0; repeat < 3; repeat++) {
  (await completedPage.confirmCompleted());
  (await replacementPage.confirmReplacement());
  (await incompletePage.confirmIncomplete());
  (await check(review, today, [[1], [2], [], [3]], 2, 4));
  (await check((await mount('review', app)), today, [[1], [2], [], [3]], 2, 4));
}
assert.equal(JSON.stringify(app.globalData), beforeRefresh);
references.forEach((reference, index) => {
  assert.equal(app.globalData.plans[index], reference.plan);
  assert.equal(app.globalData.plans[index].result, reference.result);
});

now = '2026-09-27T15:59:59Z';
(await check(review, today, [[1], [2], [], [3]], 2, 4));
now = '2026-09-27T16:00:00Z';
(await check(review, today, [[8], [], [], []], 1, 1));
const makeupPage = (await mount('record', app, 3));
makeupPage.startMakeup();
makeupPage.selectMakeupDate({ detail: { value: '2026-09-28' } });
makeupPage.selectMakeupActivity({ detail: { value: '5' } });
(await makeupPage.confirmMakeup());
(await check(review, today, [[8], [], [], []], 1, 1)); // 补做周不额外增加完成或计划。
const afterMakeup = JSON.stringify(app.globalData);
(await makeupPage.confirmMakeup());
assert.equal(JSON.stringify(app.globalData), afterMakeup);
now = '2026-09-26T04:00:00Z'; // 固定查看原计划周，检查跨周补做的归属。
(await check(review, today, [[1], [2], [3], []], 3, 4));
const makeupPlan = review.data.resultGroups[2].plans[0];
assert.equal(makeupPlan.date, '2026-09-25');
assert.equal(makeupPlan.activity, '网球');
assert.equal(makeupPlan.result.status, 'incomplete');
assert.equal(makeupPlan.result.reason, '下雨');
assert.equal(makeupPlan.result.makeup.date, '2026-09-28');
assert.equal(makeupPlan.result.makeup.actualActivity, '散步');
assert.equal(app.globalData.plans.length, 8);
assert.equal(JSON.stringify(app.globalData), afterMakeup);
app.globalData.periodDays['2026-09-25'] = true;
(await check(review, today, [[1], [2], [], []], 2, 3));
delete app.globalData.periodDays['2026-09-25'];
(await check(review, today, [[1], [2], [3], []], 3, 4));
assert.equal(JSON.stringify(app.globalData), afterMakeup);

for (const scenario of [
  { plans: [], total: 0 },
  { plans: [{ id: 20, date: '2026-09-20', result: { status: 'completed' } }], total: 0 },
  { plans: [{ id: 21, date: '2026-09-28', result: { status: 'completed' } }], total: 0 },
  { plans: [{ id: 22, date: '2026-09-24', cancelled: true, result: { status: 'completed' } }], total: 0 },
  { plans: [{ id: 23, date: '2026-09-27' }], total: 1 },
  { plans: [{ id: 24, date: '2026-09-21' }], total: 1 },
  { plans: [{ id: 25, date: '2026-09-26', activity: '瑜伽', startTime: '09:00', result: { status: 'completed' } }], periodDays: { '2026-09-26': true }, total: 0 }
]) {
  const emptyApp = runtime();
  emptyApp.globalData.plans = scenario.plans;
  emptyApp.globalData.periodDays = scenario.periodDays || {};
  emptyApp.globalData.periodWalks = { '2026-09-26': { status: 'completed' } };
  const snapshot = JSON.stringify(emptyApp.globalData);
  (await check((await mount('review', emptyApp)), (await mount('today', emptyApp)), emptyGroups, 0, scenario.total));
  assert.equal(JSON.stringify(emptyApp.globalData), snapshot);
}

const yearApp = runtime();
yearApp.globalData.plans.push(
  { id: 30, date: '2026-12-27', result: { status: 'completed' } },
  { id: 31, date: '2026-12-28', result: { status: 'completed' } },
  { id: 32, date: '2027-01-03', activity: '网球', startTime: '18:00', result: { status: 'incomplete', reason: '下雨' } },
  { id: 33, date: '2027-01-04', activity: '跑步', startTime: '09:00', result: { status: 'replacement', actualActivity: '散步' } }
);
now = '2026-12-31T16:00:00Z';
const yearReview = (await mount('review', yearApp));
const yearToday = (await mount('today', yearApp));
(await check(yearReview, yearToday, [[31], [], [], [32]], 1, 2));
now = '2027-01-03T15:59:59Z';
(await check(yearReview, yearToday, [[31], [], [], [32]], 1, 2));
now = '2027-01-03T16:00:00Z';
(await check(yearReview, yearToday, [[], [33], [], []], 1, 1));

const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/review/index.wxml'), 'utf8');
assert.match(wxml, /\{\{\s*weeklyProgress\.completed\s*\}\}/);
assert.match(wxml, /wx:for="\{\{\s*resultGroups\s*\}\}"/);
assert.match(wxml, /\.plans\.length\s*\}\}/, '分类数量绑定对应计划列表');
assert.match(wxml, /hasResults/, '无结果时存在空状态分支');
assert.match(wxml, /result\.reason/, '补做后仍可看到原未完成原因');
assert.match(wxml, /plan\.actualDate/);
assert.match(wxml, /plan\.actualActivity/);
console.log('PASS: live record completion/replacement/incomplete/correction refresh review; all counts match today and identifiable plan lists');
console.log('PASS: cross-week makeup stays in original week, retains original reason and dates, and exits still-incomplete');
console.log('PASS: period exclusion/restoration, separate walks, cancelled/pending/empty states, repeat read-only refresh and Beijing/year week boundaries');

})().catch(error => { console.error(error); process.exitCode = 1; });
