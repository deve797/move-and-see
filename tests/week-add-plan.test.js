const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

const file = path.resolve(__dirname, '../miniprogram/pages/week/index.js');
const source = fs.readFileSync(file, 'utf8');
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-09-26T12:00:00+08:00'])); }
}
const app = { globalData: { plans: [] } };
function mount(runtime = app) {
  let definition;
  vm.runInNewContext(source, {
    require: createRequire(file), Date: FixedDate, getApp: () => runtime,
    Page(value) { definition = value; }, wx: { pageScrollTo() {} }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value); }
  });
  page.onLoad();
  return page;
}
const event = value => ({ detail: { value } });
const plans = page => page.data.days.flatMap(day => day.plans);
const page = mount();
assert.equal(page.data.selectedDate, '2026-09-21');
page.showNextWeek();
assert.equal(page.data.selectedDate, '2026-09-28');
page.startAdding();
page.selectPlanDate(event('2026-09-29'));
page.confirmAdding();
assert.equal(plans(page).length, 0);
page.selectActivity(event('1'));
assert.equal(page.data.canConfirm, false); // 没有时间。
page.confirmAdding();
assert.equal(plans(page).length, 0);
page.selectStartTime(event('19:00'));
assert.equal(page.data.canConfirm, true);
page.confirmAdding();
const tuesday = page.data.days.find(day => day.date === '2026-09-29');
assert.equal(tuesday.plans.length, 1);
assert.equal(tuesday.plans[0].activity, '跑步');
assert.equal(tuesday.plans[0].startTime, '19:00');
assert.equal(tuesday.name, '休息一下'); // 固定示例没有被改写。
assert.equal(page.data.adding, false);
page.confirmAdding();
assert.equal(plans(page).length, 1); // 连点确认不重复新增。

page.showCurrentWeek();
assert.equal(plans(page).length, 0);
page.selectWeek(event('2026-10-06'));
assert.equal(plans(page).length, 0);
page.showNextWeek();
assert.equal(plans(page).length, 1);
assert.equal(plans(page)[0].date, '2026-09-29');

page.startAdding();
assert.equal(page.data.draft.activity, '');
assert.equal(page.data.draft.startTime, '');
page.selectStartTime(event('20:00'));
assert.equal(page.data.canConfirm, false); // 没有项目。
page.confirmAdding();
assert.equal(plans(page).length, 1);
page.selectActivity(event('0'));
page.cancelAdding();
page.confirmAdding();
assert.equal(plans(page).length, 1); // 取消完整表单不新增。

page.startAdding();
page.selectPlanDate(event('2027-01-01'));
page.selectActivity(event('5'));
page.selectStartTime(event('08:30'));
page.confirmAdding();
assert.equal(page.data.selectedDate, '2026-12-28');
assert.equal(plans(page).length, 1);
assert.equal(plans(page)[0].date, '2027-01-01');
page.showNextWeek();
assert.equal(plans(page).length, 1); // 跨年新增不覆盖原来那周。
page.startAdding();
page.selectPlanDate(event('2026-09-29'));
page.selectActivity(event('0'));
page.selectStartTime(event('20:00'));
page.confirmAdding();
assert.equal(plans(page).length, 2); // 同一天可安排两项。
assert.equal(new Set(plans(page).map(plan => plan.id)).size, 2);
const reopened = mount();
reopened.showNextWeek();
assert.equal(plans(reopened).length, 2); // 切片 4：同次运行内跨页共享。
assert.equal(mount({ globalData: { plans: [] } })._plans.length, 0); // 新运行无持久化。
console.log('PASS: required fields, cancel, next Tuesday 19:00 run, week isolation, year boundary, multiple plans, duplicate confirm, runtime-only shared plans');
