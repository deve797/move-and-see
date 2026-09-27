(async () => {
const { createTestApp, prepareTestApp } = require('./helpers/runtime');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

const file = path.resolve(__dirname, '../miniprogram/pages/week/index.js');
let now = '2026-09-26T12:00:00+08:00';
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
}
let definition;
const app = { globalData: { plans: [] } };
const modals = [];
vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
  require: createRequire(file), Date: FixedDate, getApp: () => prepareTestApp(app),
  Page(value) { definition = value; },
  wx: { pageScrollTo() {}, showToast() {}, showModal(options) { modals.push(options); } }
});
const page = Object.assign({}, definition, {
  data: JSON.parse(JSON.stringify(definition.data)),
  setData(value) { Object.assign(this.data, value); }
});
const event = value => ({ detail: { value } });
const cancel = async id => (await page.cancelPlan({ currentTarget: { dataset: { id } } }));
const visible = () => page.data.days.flatMap(day => day.plans);
async function add(date, time) {
  page.selectWeek(event(date));
  page.startAdding({ currentTarget: { dataset: { date } } });
  page.selectActivity(event('1'));
  page.selectStartTime(event(time.split(':').map((value, index) => Number(value) / (index ? 10 : 1))));
  (await page.confirmAdding());
}

(await page.onLoad());
  (await page.onShow());
(await add('2026-09-29', '19:00'));
(await add('2026-09-29', '20:00'));
const original = JSON.stringify(page._plans);
(await cancel(1));
assert.match(modals[0].content, /2026-09-29.*19:00.*跑步/);
assert.equal(JSON.stringify(page._plans), original); // 弹窗打开时不取消。
(await modals.pop().success({ confirm: false, cancel: true }));
assert.equal(JSON.stringify(page._plans), original);
assert.equal(visible().length, 2);

const other = JSON.stringify(page._plans[1]);
(await cancel(1));
const confirmation = modals.pop();
(await confirmation.success({ confirm: true }));
assert.deepEqual(Array.from(visible(), plan => plan.id), ['2']);
assert.equal(JSON.stringify(page._plans[1]), other);
(await confirmation.success({ confirm: true })); // 重复回调不能影响其他安排。
(await cancel(1));
assert.equal(modals.length, 0);
page.startEditing({ currentTarget: { dataset: { id: 1 } } });
assert.equal(page.data.adding, false);
page.showCurrentWeek();
page.showNextWeek();
assert.deepEqual(Array.from(visible(), plan => plan.id), ['2']);
(await add('2026-09-30', '18:00'));
assert.deepEqual(Array.from(visible(), plan => plan.id), ['2', '3']);

// 旧记录保留每分钟精度，用于检查过去、当前及刚好到时的保护。
app.globalData.plans.push(...['11:59', '12:00', '12:01'].map((startTime, index) => ({
  id: String(index + 4), date: '2026-09-26', activity: '跑步', startTime
})));
page.selectWeek(event('2026-09-26'));
page._plans[1].result = { status: 'completed' }; // 仅测试已有结果保护。
const beforeBlocked = JSON.stringify(page._plans);
for (const id of [2, 4, 5, 999]) await cancel(id);
assert.equal(modals.length, 0);
assert.equal(JSON.stringify(page._plans), beforeBlocked);
(await cancel(6));
now = '2026-09-26T12:01:00+08:00';
(await modals.pop().success({ confirm: true }));
assert.equal(JSON.stringify(page._plans), beforeBlocked); // 确认期间刚好到时。
(await cancel(3));
page._plans[2].version += 1; // 模拟另一客户端先保存了结果。
page._plans[2].result = { status: 'completed' };
const withResult = JSON.stringify(page._plans);
(await modals.pop().success({ confirm: true }));
assert.equal(JSON.stringify(page._plans), withResult); // 确认期间出现结果。
console.log('PASS: cancel removes only selected plan, discard unchanged, week navigation, stable new IDs, past/current/result guards, confirmation-time recheck, repeated cancel');

})().catch(error => { console.error(error); process.exitCode = 1; });
