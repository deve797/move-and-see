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
vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
  require: createRequire(file), Date: FixedDate, getApp: () => prepareTestApp(app),
  Page(value) { definition = value; }, wx: { showToast() {}, pageScrollTo() {}, showToast() {} }
});
const page = Object.assign({}, definition, {
  data: JSON.parse(JSON.stringify(definition.data)),
  setData(value) { Object.assign(this.data, value); }
});
const event = value => ({ detail: { value } });
const edit = id => page.startEditing({ currentTarget: { dataset: { id } } });
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
const other = JSON.stringify(page._plans[1]);
edit(1);
assert.equal(page.data.draft.activity, '跑步');
assert.equal(page.data.draft.startTime, '19:00');
page.selectPlanDate(event('2026-09-30'));
assert.equal(page._plans[0].date, '2026-09-29'); // 草稿不提前改变原安排。
(await page.confirmAdding());
assert.equal(page.data.days.find(day => day.date === '2026-09-29').plans.length, 1);
assert.equal(page.data.days.find(day => day.date === '2026-09-30').plans[0].id, '1');
edit(1);
page.selectActivity(event('4'));
page.selectStartTime(event([18, 3]));
(await page.confirmAdding());
(await page.confirmAdding());
assert.equal(page._plans.length, 2);
assert.equal(page._plans[0].activity, '网球');
assert.equal(page._plans[0].startTime, '18:30');
assert.equal(JSON.stringify(page._plans[1]), other);

const original = JSON.stringify(page._plans);
edit(1);
page.selectPlanDate(event('2026-10-07'));
page.selectActivity(event('0'));
page.selectStartTime(event([6, 0]));
page.cancelAdding();
(await page.confirmAdding());
assert.equal(JSON.stringify(page._plans), original);
edit(1);
page.selectPlanDate(event('2026-09-25'));
assert.equal(page.data.canConfirm, false);
(await page.confirmAdding());
assert.equal(JSON.stringify(page._plans), original);
page.selectPlanDate(event('2026-09-26'));
page.selectStartTime(event([12, 0]));
assert.equal(page.data.canConfirm, false); // 等于现在也不属于未来。
page.selectStartTime(event([12, 1]));
assert.equal(page.data.canConfirm, true);
page.updateDraft({ startTime: '' });
assert.equal(page.data.canConfirm, false);
page.selectStartTime(event([12, 1]));
page.selectActivity(event('99'));
assert.equal(page.data.canConfirm, false);
page.cancelAdding();

edit(1);
page.selectPlanDate(event('2027-01-01'));
(await page.confirmAdding());
assert.equal(page.data.selectedDate, '2026-12-28');
assert.equal(visible()[0].id, '1');
page.showNextWeek();
assert.equal(visible().length, 1);
assert.equal(visible()[0].id, '2');
page.selectWeek(event('2027-01-01'));
assert.equal(visible()[0].id, '1');

// 旧记录保留每分钟精度，用于检查过去、当前及刚好到时的保护。
app.globalData.plans.push(...['11:59', '12:00', '12:01'].map((startTime, index) => ({
  id: String(index + 3), date: '2026-09-26', activity: '跑步', startTime
})));
page.selectWeek(event('2026-09-26'));
assert.deepEqual(Array.from(visible(), plan => plan.editable), [false, false, true]);
edit(3);
assert.equal(page.data.adding, false);
edit(4);
assert.equal(page.data.adding, false);
edit(999);
assert.equal(page.data.adding, false);
page._plans[0].result = { status: 'completed' }; // 仅注入测试样例，不实现结果录入。
page.renderWeek('2027-01-01');
assert.equal(visible()[0].editable, false);
edit(1);
assert.equal(page.data.adding, false);

edit(5);
page.selectStartTime(event([13, 0]));
now = '2026-09-26T12:01:00+08:00';
(await page.confirmAdding());
assert.equal(page._plans[4].startTime, '12:01'); // 表单打开期间到时不能再改。
assert.equal(page.data.adding, true); // 无效保存保留草稿供用户查看。
assert.equal(page._plans[4].startTime, '12:01');
page.cancelAdding();
edit(2);
page.selectStartTime(event([21, 0]));
page._plans[1].version += 1;
page._plans[1].result = { status: 'completed' };
(await page.confirmAdding());
assert.equal(page._plans[1].startTime, '20:00'); // 确认时重新检查结果。
assert.equal(page._plans.length, 5);
// 修改旧的非整十分钟安排时，不确认新时间就保留原值。
app.globalData.plans.push({ id: '6', date: '2026-09-29', activity: '跑步', startTime: '09:17' });
page.selectWeek(event('2026-09-29'));
edit(6);
assert.equal(page.data.draft.startTime, '09:17');
assert.deepEqual(Array.from(page.data.startTimeIndex), [9, 1]);
page.selectActivity(event('0'));
assert.equal(page.data.draft.startTime, '09:17'); // 取消时间 picker 不触发 change，草稿不舍入。
await page.confirmAdding();
assert.equal(page._plans[5].activity, '瑜伽');
assert.equal(page._plans[5].startTime, '09:17');
edit(6);
page.selectStartTime(event([9, 2]));
page.cancelAdding();
assert.equal(page._plans[5].startTime, '09:17'); // 放弃整个修改也不覆盖原时间。
edit(6);
page.selectStartTime(event([9, 1]));
await page.confirmAdding();
assert.equal(page._plans[5].startTime, '09:10'); // 只有确认新的 picker 值才改时间。
console.log('PASS: legacy minute precision preserved until an explicit picker change');
console.log('PASS: move date, stable ID/count, activity/time edit, discard, cross-week/year, required fields, past/current/result guards, expiry during editing');

})().catch(error => { console.error(error); process.exitCode = 1; });
