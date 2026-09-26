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
const counts = (improved = 0, same = 0, declined = 0) => ({ improved, same, declined, total: improved + same + declined });
function runtime() { return createTestApp(); }
async function mount(name, app, query = {}) {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => prepareTestApp(app),
    getCurrentPages: () => [{}, {}], Page(value) { definition = value; },
    wx: { pageScrollTo() {}, showToast() {}, navigateBack() {}, reLaunch() {} }
  });
  const page = Object.assign({}, definition, {
    data: plain(definition.data),
    setData(value, callback) { Object.assign(this.data, value); if (callback) callback(); }
  });
  if (page.onLoad) (await page.onLoad(query));
  if (page.onShow) (await page.onShow());
  return page;
}
async function check(page, app, expected) {
  const snapshot = JSON.stringify(app.globalData);
  const references = app.globalData.plans.map(plan => ({ plan, result: plan.result, makeup: plan.result && plan.result.makeup }));
  (await page.onShow());
  assert.deepEqual(plain(page.data.moodComparison), expected);
  const summary = page.data.moodComparison;
  assert.equal(summary.improved + summary.same + summary.declined, summary.total, '三类之和等于有效样本数');
  assert.equal(JSON.stringify(app.globalData), snapshot, '心情汇总只读，不修改记录、备注或数组顺序');
  references.forEach((reference, index) => {
    const plan = app.globalData.plans[index];
    assert.equal(plan, reference.plan);
    assert.equal(plan.result, reference.result);
    assert.equal(plan.result && plan.result.makeup, reference.makeup);
  });
}
function plan(id, change = {}) {
  return { id, date: '2026-09-26', activity: '瑜伽', startTime: '09:00', ...change };
}
async function beforeMood(app, id, value) {
  const today = (await mount('today', app));
  today.openBeforeMood(event('id', id));
  today.selectBeforeMood(event('value', value));
  (await today.confirmBeforeMood());
}
async function afterMood(app, id, value) {
  const mood = (await mount('mood', app, { planId: String(id) }));
  mood.selectMood(event('value', value));
  (await mood.confirmMood());
}
async function correct(page, status) {
  page.startCorrection();
  page.selectCorrectionStatus(event('status', status));
  if (status === 'incomplete') page.selectCorrectionReason(event('reason', '加班'));
  (await page.confirmCorrection());
}

const app = runtime();
const review = (await mount('review', app));
(await check(review, app, counts()));
app.globalData.plans.push(plan(3), plan(1), plan(2));
const examples = [
  { id: 1, before: 'neutral', after: 'good', expected: counts(1) },
  { id: 2, before: 'good', after: 'good', expected: counts(1, 1) },
  { id: 3, before: 'good', after: 'down', expected: counts(1, 1, 1) }
];
for (const example of examples) {
  const previous = plain(review.data.moodComparison);
  (await beforeMood(app, example.id, example.before));
  (await check(review, app, previous)); // 只有运动前心情且尚未运动，不计样本。
  (await (await mount('record', app, { planId: String(example.id) })).confirmCompleted());
  (await check(review, app, previous)); // 已完成但缺运动后心情仍不计样本。
  (await afterMood(app, example.id, example.after));
  (await check(review, app, example.expected));
}
(await check((await mount('review', app)), app, counts(1, 1, 1))); // spec 的一般→不错、不错→不错、不错→不太好。
for (let repeat = 0; repeat < 3; repeat++) (await check(review, app, counts(1, 1, 1)));

(await beforeMood(app, 3, 'down'));
(await check(review, app, counts(1, 2)));
(await afterMood(app, 3, 'great'));
(await check(review, app, counts(2, 1)));
const corrected = (await mount('record', app, { planId: '1' }));
(await correct(corrected, 'incomplete'));
(await check(review, app, counts(1, 1)));
(await correct(corrected, 'completed'));
(await check(review, app, counts(1, 1))); // 修正产生新结果，不能保留已移除的运动后心情。
(await afterMood(app, 1, 'low'));
(await check(review, app, counts(1, 1, 1)));
(await check((await mount('review', app)), app, counts(1, 1, 1)));

const ordered = ['low', 'down', 'neutral', 'good', 'great'];
const optionValues = require('../miniprogram/utils/mood-options').map(item => item.value);
assert.deepEqual(optionValues, ordered);
const orderedApp = runtime();
const orderedReview = (await mount('review', orderedApp));
const allPairs = [];
for (let before = 0; before < ordered.length; before++) {
  for (let after = 0; after < ordered.length; after++) {
    const sample = plan(before * 5 + after, { beforeMood: ordered[before], result: { status: 'completed', afterMood: ordered[after] } });
    allPairs.push(sample);
    orderedApp.globalData.plans = [sample];
    (await check(orderedReview, orderedApp, counts(Number(after > before), Number(after === before), Number(after < before))));
  }
}
orderedApp.globalData.plans = allPairs;
(await check(orderedReview, orderedApp, counts(10, 5, 10))); // 包含最低档 low，不能把首档序号 0 当作缺值。

const excludedApp = runtime();
excludedApp.globalData.plans = [
  plan(1, { beforeMood: 'low' }),
  plan(2, { result: { status: 'completed', afterMood: 'great' } }),
  plan(3, { beforeMood: 'low', result: { status: 'completed' } }),
  plan(4, { beforeMood: 'low', result: { status: 'incomplete', reason: '下雨', afterMood: 'great' } }),
  plan(5, { beforeMood: 'low', result: { status: 'pending', afterMood: 'great' } }),
  plan(6, { beforeMoodNote: '一般', result: { status: 'completed', afterMoodNote: '很好，轻松了许多' } }),
  plan(7, { beforeMood: 'low', result: { status: 'replacement', actualActivity: '散步', afterMood: 'great' } }),
  plan(8, { beforeMood: 'low', result: { status: 'incomplete', afterMood: 'great', makeup: { date: '2026-09-26', actualActivity: '散步', afterMood: 'great' } } }),
  plan(9, { beforeMood: 'low', result: { status: 'incomplete', afterMood: 'great', makeup: { date: '2026-09-26', actualActivity: '散步', beforeMood: 'low' } } })
];
for (const invalid of [undefined, '', null, 'unknown', 0]) {
  excludedApp.globalData.plans.push(
    plan(20 + excludedApp.globalData.plans.length, { beforeMood: invalid, result: { status: 'completed', afterMood: 'good' } }),
    plan(40 + excludedApp.globalData.plans.length, { beforeMood: 'good', result: { status: 'completed', afterMood: invalid } })
  );
}
const excludedReview = (await mount('review', excludedApp));
(await check(excludedReview, excludedApp, counts())); // 不跨计划、不跨原记录和补做拼接，不从文字推测心情。

// 完整替代/补做对为汇总层固定样本：现有页面没有对应运动前心情采集入口。
excludedApp.globalData.plans.push(
  plan(100, { beforeMood: 'low', result: { status: 'replacement', actualActivity: '散步', beforeMood: 'great', afterMood: 'down' } }),
  plan(101, { beforeMood: 'low', result: { status: 'incomplete', afterMood: 'great', makeup: { date: '2026-09-26', actualActivity: '散步', beforeMood: 'good', afterMood: 'good' } } }),
  plan(102, { beforeMood: 'great', result: { status: 'completed', beforeMood: 'low', afterMood: 'neutral' } })
);
(await check(excludedReview, excludedApp, counts(0, 1, 2))); // 每次运动只使用自己的配对；正常完成仍使用计划前心情。
excludedApp.globalData.plans = [];
(await check(excludedReview, excludedApp, counts())); // 数据清空后不残留上次统计。

const periodApp = runtime();
periodApp.globalData.plans = [plan(1, { beforeMood: 'low', result: { status: 'completed', afterMood: 'good' } })];
const periodReview = (await mount('review', periodApp));
(await check(periodReview, periodApp, counts(1)));
const today = (await mount('today', periodApp));
(await today.setPeriod(event('marked', true)));
(await check(periodReview, periodApp, counts(1))); // 免考核不等于没有实际运动，不排除完整心情样本。
assert.deepEqual(plain(periodReview.data.weeklyProgress), { completed: 0, total: 0 });
(await today.choosePeriodWalk());
for (const status of ['incomplete', 'completed']) {
  (await today.recordPeriodWalk(event('status', status)));
  (await check(periodReview, periodApp, counts(1))); // 独立散步没有前后心情，不能借用原计划心情。
}
(await today.setPeriod(event('marked', false)));
(await check(periodReview, periodApp, counts(1)));
periodApp.globalData.plans[0].cancelled = true;
(await check(periodReview, periodApp, counts()));

const weekApp = runtime();
weekApp.globalData.plans = [
  plan(1, { date: '2026-09-20', beforeMood: 'low', result: { status: 'incomplete', makeup: { date: '2026-09-21', actualActivity: '散步', beforeMood: 'low', afterMood: 'great' } } }),
  plan(2, { date: '2026-09-21', beforeMood: 'neutral', result: { status: 'completed', afterMood: 'good' } }),
  plan(3, { date: '2026-09-27', result: { status: 'incomplete', makeup: { date: '2026-09-28', actualActivity: '散步', beforeMood: 'good', afterMood: 'good' } } }),
  plan(4, { date: '2026-09-28', beforeMood: 'good', result: { status: 'completed', afterMood: 'down' } }),
  plan(5, { date: '2026-09-26', cancelled: true, beforeMood: 'low', result: { status: 'completed', afterMood: 'great' } })
];
const weekReview = (await mount('review', weekApp));
// spec 未单独定义心情跨周归属：本轮最小实现假设沿用回看的原计划周，不按补做日期搬移。
(await check(weekReview, weekApp, counts(1, 1)));
now = '2026-09-27T15:59:59Z';
(await check(weekReview, weekApp, counts(1, 1)));
now = '2026-09-27T16:00:00Z';
(await check(weekReview, weekApp, counts(0, 0, 1))); // 北京时间周一零点换周，实际补做所在周不重复计数。
now = '2026-09-20T15:59:59Z';
(await check(weekReview, weekApp, counts(1)));
now = '2026-09-20T16:00:00Z';
(await check(weekReview, weekApp, counts(1, 1)));

const yearApp = runtime();
yearApp.globalData.plans = [
  plan(1, { date: '2026-12-27', beforeMood: 'low', result: { status: 'completed', afterMood: 'great' } }),
  plan(2, { date: '2026-12-28', beforeMood: 'good', result: { status: 'completed', afterMood: 'good' } }),
  plan(3, { date: '2027-01-03', beforeMood: 'good', result: { status: 'completed', afterMood: 'down' } }),
  plan(4, { date: '2027-01-04', beforeMood: 'low', result: { status: 'completed', afterMood: 'great' } })
];
now = '2026-12-31T16:00:00Z';
const yearReview = (await mount('review', yearApp));
(await check(yearReview, yearApp, counts(0, 1, 1)));
now = '2027-01-03T16:00:00Z';
(await check(yearReview, yearApp, counts(1)));
const restartedApp = runtime();
(await check((await mount('review', restartedApp)), restartedApp, counts())); // 独立测试 fixture 不共享状态。

console.log('PASS: spec mood examples, all 25 ordered pairs, sample sum, optional/invalid values and no text inference');
console.log('PASS: existing before/after recording flow, live edits and corrections, repeat/reopen refresh and read-only aggregation');
console.log('PASS: actual replacement/makeup pairing, no cross-record pairing, period completion, cancelled/empty states');
console.log('PASS: documented original-plan-week assumption, Beijing week boundaries and year transition');

})().catch(error => { console.error(error); process.exitCode = 1; });
