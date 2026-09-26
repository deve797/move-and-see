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
  require: createRequire(file), Date: FixedDate, getApp: () => app,
  Page(value) { definition = value; }, wx: { pageScrollTo() {}, showToast() {} }
});
const page = Object.assign({}, definition, {
  data: JSON.parse(JSON.stringify(definition.data)),
  setData(value) { Object.assign(this.data, value); }
});
const event = value => ({ detail: { value } });
const edit = id => page.startEditing({ currentTarget: { dataset: { id } } });
const visible = () => page.data.days.flatMap(day => day.plans);
function add(date, time) {
  page.startAdding();
  page.selectPlanDate(event(date));
  page.selectActivity(event('1'));
  page.selectStartTime(event(time));
  page.confirmAdding();
}
page.onLoad();
add('2026-09-29', '19:00');
add('2026-09-29', '20:00');
const other = JSON.stringify(page._plans[1]);
edit(1);
assert.equal(page.data.draft.activity, '跑步');
assert.equal(page.data.draft.startTime, '19:00');
page.selectPlanDate(event('2026-09-30'));
assert.equal(page._plans[0].date, '2026-09-29'); // 草稿不提前改变原安排。
page.confirmAdding();
assert.equal(page.data.days.find(day => day.date === '2026-09-29').plans.length, 1);
assert.equal(page.data.days.find(day => day.date === '2026-09-30').plans[0].id, 1);
edit(1);
page.selectActivity(event('4'));
page.selectStartTime(event('18:30'));
page.confirmAdding();
page.confirmAdding();
assert.equal(page._plans.length, 2);
assert.equal(page._plans[0].activity, '网球');
assert.equal(page._plans[0].startTime, '18:30');
assert.equal(JSON.stringify(page._plans[1]), other);

const original = JSON.stringify(page._plans);
edit(1);
page.selectPlanDate(event('2026-10-07'));
page.selectActivity(event('0'));
page.selectStartTime(event('06:00'));
page.cancelAdding();
page.confirmAdding();
assert.equal(JSON.stringify(page._plans), original);
edit(1);
page.selectPlanDate(event('2026-09-25'));
assert.equal(page.data.canConfirm, false);
page.confirmAdding();
assert.equal(JSON.stringify(page._plans), original);
page.selectPlanDate(event('2026-09-26'));
page.selectStartTime(event('12:00'));
assert.equal(page.data.canConfirm, false); // 等于现在也不属于未来。
page.selectStartTime(event('12:01'));
assert.equal(page.data.canConfirm, true);
page.selectStartTime(event(''));
assert.equal(page.data.canConfirm, false);
page.selectStartTime(event('12:01'));
page.selectActivity(event('99'));
assert.equal(page.data.canConfirm, false);
page.cancelAdding();

edit(1);
page.selectPlanDate(event('2027-01-01'));
page.confirmAdding();
assert.equal(page.data.selectedDate, '2026-12-28');
assert.equal(visible()[0].id, 1);
page.showNextWeek();
assert.equal(visible().length, 1);
assert.equal(visible()[0].id, 2);
page.selectWeek(event('2027-01-01'));
assert.equal(visible()[0].id, 1);

add('2026-09-26', '11:59');
add('2026-09-26', '12:00');
add('2026-09-26', '12:01');
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
page.selectStartTime(event('13:00'));
now = '2026-09-26T12:01:00+08:00';
page.confirmAdding();
assert.equal(page._plans[4].startTime, '12:01'); // 表单打开期间到时不能再改。
assert.equal(page.data.adding, false);
edit(2);
page.selectStartTime(event('21:00'));
page._plans[1].result = { status: 'completed' };
page.confirmAdding();
assert.equal(page._plans[1].startTime, '20:00'); // 确认时重新检查结果。
assert.equal(page._plans.length, 5);
console.log('PASS: move date, stable ID/count, activity/time edit, discard, cross-week/year, required fields, past/current/result guards, expiry during editing');
