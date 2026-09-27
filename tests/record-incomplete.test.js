(async () => {
const { createTestApp, prepareTestApp } = require('./helpers/runtime');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-09-26T04:00:00Z'])); }
}
const app = { globalData: { plans: [
  { id: 1, date: '2026-09-26', activity: '跑步', startTime: '19:00' },
  { id: 2, date: '2026-09-26', activity: '瑜伽', startTime: '07:30' },
  { id: 3, date: '2026-09-27', activity: '网球', startTime: '09:00' },
  { id: 4, date: '2026-09-26', activity: '散步', startTime: '20:00', cancelled: true }
] } };
async function mount(name, query = {}) {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => prepareTestApp(app),
    Page(value) { definition = value; },
    wx: { pageScrollTo() {}, showToast() {}, showModal() {} }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value); }
  });
  if (page.onLoad) (await page.onLoad(query));
  if (page.onShow) (await page.onShow());
  return page;
}
const select = (page, reason) => page.selectReason({ currentTarget: { dataset: { reason } } });
const event = id => ({ currentTarget: { dataset: { id } } });
const original = JSON.stringify(app.globalData.plans);
const today = (await mount('today'));
const week = (await mount('week'));
const record = (await mount('record', { planId: '1' }));
assert.equal(record.data.plan.activity, '跑步');
assert.equal(record.data.plan.startTime, '19:00');
assert.equal(record.data.selectedReason, '');
assert.equal(record.data.canConfirmIncomplete, false);
record.startIncomplete();
(await record.confirmIncomplete());
assert.equal(JSON.stringify(app.globalData.plans), original);
select(record, '并不存在的原因');
assert.equal(record.data.canConfirmIncomplete, false);
record.setData({ selectedReason: '并不存在的原因', canConfirmIncomplete: true });
(await record.confirmIncomplete());
assert.equal(JSON.stringify(app.globalData.plans), original); // 提交重新校验，不只依赖按钮。
(await record.onShow());
record.startIncomplete();
select(record, '加班');
assert.equal(record.data.canConfirmIncomplete, true);
assert.equal(JSON.stringify(app.globalData.plans), original); // 未确认的选择不写结果。
const discarded = (await mount('record', { planId: '1' }));
assert.equal(discarded.data.selectedReason, '');
record.cancelIncomplete();
assert.equal(record.data.selectedReason, '');
assert.equal(record.data.canConfirmIncomplete, false);
assert.equal(JSON.stringify(app.globalData.plans), original);
record.startIncomplete();
select(record, '加班');

(await record.confirmIncomplete());
assert.equal(app.globalData.plans[0].result.status, 'incomplete');
assert.equal(app.globalData.plans[0].result.reason, '加班');
assert.equal(JSON.stringify(app.globalData.plans.slice(1)), JSON.stringify(JSON.parse(original).slice(1)));
assert.equal(record.data.plan.result.reason, '加班');
assert.equal(record.data.canConfirmIncomplete, false);
const confirmed = JSON.stringify(app.globalData.plans);
(await record.confirmIncomplete());
select(record, '下雨');
(await record.confirmIncomplete());
assert.equal(JSON.stringify(app.globalData.plans), confirmed); // 重复确认/更换原因不实现修正。
const reopened = (await mount('record', { planId: '1' }));
assert.equal(reopened.data.plan.result.status, 'incomplete');
assert.equal(reopened.data.plan.result.reason, '加班');
assert.equal(reopened.data.selectedReason, '加班');
assert.equal(reopened.data.canConfirmIncomplete, false);
reopened.startIncomplete();
select(reopened, '下雨');
(await reopened.confirmIncomplete());
assert.equal(JSON.stringify(app.globalData.plans), confirmed);
(await discarded.confirmIncomplete());
assert.equal(JSON.stringify(app.globalData.plans), confirmed);

(await today.onShow());
assert.deepEqual(Array.from(today.data.activities, item => item.id), [2, 1]);
assert.equal(today.data.activities[1].result.reason, '加班');
assert.equal(Boolean(today.data.activities[0].result), false);
(await week.onShow());
const shown = week.data.days.flatMap(day => day.plans).find(plan => plan.id === 1);
assert.equal(shown.result.reason, '加班');
assert.equal(shown.editable, false);
week.startEditing(event(1));
(await week.cancelPlan(event(1)));
assert.equal(week.data.adding, false);
assert.equal(JSON.stringify(app.globalData.plans), confirmed);
week.showNextWeek();
const selectedWeek = week.data.selectedDate;
(await week.onShow());
assert.equal(week.data.selectedDate, selectedWeek); // 返回页面不跳回本周。

const second = (await mount('record', { planId: '2' }));
assert.equal(second.data.selectedReason, '');
second.startIncomplete();
select(second, '下雨');
(await second.confirmIncomplete());
assert.equal(app.globalData.plans[1].result.reason, '下雨');
assert.equal(app.globalData.plans[0].result.reason, '加班');
assert.equal(app.globalData.plans.length, 4);
for (const planId of ['4', '999', 'invalid', '']) {
  const invalid = (await mount('record', { planId }));
  const before = JSON.stringify(app.globalData.plans);
  assert.equal(invalid.data.plan, null);
  select(invalid, '加班');
  (await invalid.confirmIncomplete());
  assert.equal(JSON.stringify(app.globalData.plans), before);
}
const stale = (await mount('record', { planId: '3' }));
stale.startIncomplete();
select(stale, '加班');
app.globalData.plans[2].version = (app.globalData.plans[2].version || 0) + 1;
app.globalData.plans[2].cancelled = true;
(await stale.confirmIncomplete());
assert.equal(app.globalData.plans[2].result, undefined);
assert.match(stale.data.saveError, /更新|刷新/);
(await stale.onShow());
assert.equal(stale.data.saveConflict, true);
assert.equal(stale.data.selectedReason, '加班');
stale.cancelIncomplete();
assert.equal(stale.data.plan, null);
app.globalData.plans[2].cancelled = false;
(await stale.onShow());
stale.startIncomplete();
select(stale, '加班');
app.globalData.plans[2].version += 1;
app.globalData.plans[2].result = { status: 'completed' };
(await stale.confirmIncomplete());
assert.equal(app.globalData.plans[2].result.status, 'completed'); // 不覆盖既有的其他结果。

assert.equal((await mount('record')).data.plan, null);
for (const reason of ['加班', '下雨', '身体不适', '临时有事', '其他']) {
  app.globalData.plans.push({ id: 5, date: '2026-09-26', activity: '跑步', startTime: '19:00' });
  const option = (await mount('record', { planId: '5' }));
  option.startIncomplete();
  select(option, reason);
  (await option.confirmIncomplete());
  assert.equal(app.globalData.plans[4].result.reason, reason);
  app.globalData.plans.pop();
}
app.globalData.plans = [];
assert.equal((await mount('record', { planId: '1' })).data.plan, null); // 新运行不会补出已清空记录。
console.log('PASS: required valid reason, per-plan isolation, discard, repeat protection, reopen, today/week refresh, stale/cancelled plan, existing-result guards, isolated async fixtures');

})().catch(error => { console.error(error); process.exitCode = 1; });
