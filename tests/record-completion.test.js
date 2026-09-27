(async () => {
const { createTestApp, prepareTestApp } = require('./helpers/runtime');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

function runtime() { return createTestApp(); }
async function mount(name, app, query = {}) {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), getApp: () => prepareTestApp(app),
    Page(value) { definition = value; },
    wx: { showToast() {}, pageScrollTo() {}, showToast() {} }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value); }
  });
  if (page.onLoad) (await page.onLoad(query));
  if (page.onShow) (await page.onShow());
  return page;
}

const app = runtime();
app.globalData.plans.push(
  { id: 1, date: '2026-09-26', activity: '跑步', startTime: '19:00' },
  { id: 2, date: '2026-09-26', activity: '跑步', startTime: '20:00' },
  { id: 3, date: '2026-09-27', activity: '瑜伽', startTime: '07:00' }
);
const original = JSON.stringify(app.globalData.plans);
const record = (await mount('record', app, { planId: '1' }));
assert.equal(record.data.plan.id, 1);
assert.equal(record.data.plan.activity, '跑步');
assert.equal(record.data.plan.startTime, '19:00');
assert.equal(record.data.completed, false);
assert.equal(record.data.canComplete, true);
assert.equal(JSON.stringify(app.globalData.plans), original); // 进入、返回不自动完成。
const others = JSON.stringify(app.globalData.plans.slice(1));
(await record.confirmCompleted()); // 不填写心情、备注或任何其他字段。
assert.equal(app.globalData.plans[0].result.status, 'completed');
assert.equal(record.data.completed, true);
assert.equal(record.data.canComplete, false);
assert.equal(JSON.stringify(app.globalData.plans.slice(1)), others);
assert.equal(app.globalData.plans.length, 3);
const result = app.globalData.plans[0].result;
(await record.confirmCompleted());
assert.equal(app.globalData.plans[0].result, result); // 重复确认保留同一个结果。
const reopened = (await mount('record', app, { planId: '1' }));
assert.equal(reopened.data.completed, true);
(await reopened.confirmCompleted());
assert.equal(app.globalData.plans[0].result, result);
assert.deepEqual(Object.keys(app.globalData.plans[0]).sort(), ['activity', 'date', 'id', 'result', 'startTime', 'version']);
assert.equal((await mount('record', app, { planId: '2' })).data.completed, false);

const completedState = JSON.stringify(app.globalData.plans);
for (const query of [{}, { planId: 'invalid' }, { planId: '' }, { planId: '999' }, { source: 'today', day: '0' }]) {
  const missing = (await mount('record', app, query));
  assert.equal(missing.data.plan, null);
  assert.equal(missing.data.canComplete, false);
  (await missing.confirmCompleted());
}
assert.equal(JSON.stringify(app.globalData.plans), completedState);
const cancelled = (await mount('record', app, { planId: '2' }));
app.globalData.plans[1].version = (app.globalData.plans[1].version || 0) + 1;
app.globalData.plans[1].cancelled = true;
(await cancelled.confirmCompleted()); // 页面打开后取消，也不能产生结果。
assert.equal(app.globalData.plans[1].result, undefined);
assert.match(cancelled.data.saveError, /更新|刷新/);
(await cancelled.onShow());
assert.equal(cancelled.data.saveConflict, true); // 返回保留冲突，重新进入页面才读取最新状态。
assert.equal((await mount('record', app, { planId: '2' })).data.plan, null);
assert.equal((await mount('record', app, { planId: '2' })).data.canComplete, false);
const alreadyRecorded = (await mount('record', app, { planId: '3' }));
const existing = { status: 'completed' };
app.globalData.plans[2].version = (app.globalData.plans[2].version || 0) + 1;
app.globalData.plans[2].result = existing;
(await alreadyRecorded.confirmCompleted());
assert.equal(app.globalData.plans[2].result, existing);
assert.match(alreadyRecorded.data.saveError, /更新|刷新/);
(await alreadyRecorded.onShow());
assert.equal(alreadyRecorded.data.saveConflict, true);
assert.equal((await mount('record', app, { planId: '3' })).data.completed, true);
assert.equal((await mount('record', runtime(), { planId: '1' })).data.plan, null);

// 从已有新增流程建立安排，检查两个列表返回刷新以及完成后的编辑保护。
const shared = runtime();
const week = (await mount('week', shared));
const todayDate = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
async function add(date, activity, startTime) {
  week.selectWeek({ detail: { value: date } });
  week.startAdding({ currentTarget: { dataset: { date } } });
  week.selectActivity({ detail: { value: String(week.data.activities.indexOf(activity)) } });
  week.selectStartTime({ detail: { value: startTime.split(':').map((value, index) => Number(value) / (index ? 10 : 1)) } });
  (await week.confirmAdding());
}
(await add(todayDate, '跑步', '19:00'));
(await add(todayDate, '瑜伽', '07:30'));
const today = (await mount('today', shared));
const run = (await mount('record', shared, { planId: String(today.data.activities[1].id) }));
(await run.confirmCompleted());
(await today.onShow());
assert.equal(today.data.activities[0].completed, false);
assert.equal(today.data.activities[1].completed, true);
(await week.onShow());
assert.equal(week.data.days.flatMap(day => day.plans).find(plan => plan.id === '1').result.status, 'completed');
assert.equal(week.data.days.flatMap(day => day.plans).find(plan => plan.id === '1').editable, false);
assert.equal((await mount('today', shared)).data.activities[1].completed, true);
week.showNextWeek();
const selectedWeek = week.data.selectedDate;
(await add(selectedWeek, '网球', '18:00'));
(await (await mount('record', shared, { planId: '3' })).confirmCompleted());
(await week.onShow());
assert.equal(week.data.selectedDate, selectedWeek);
assert.equal(week.data.days.flatMap(day => day.plans)[0].result.status, 'completed');
assert.equal(week.data.days.flatMap(day => day.plans)[0].editable, false);
week.startEditing({ currentTarget: { dataset: { id: 3 } } });
assert.equal(week.data.adding, false);
(await week.cancelPlan({ currentTarget: { dataset: { id: 3 } } }));
assert.equal(shared.globalData.plans[2].cancelled, undefined);
assert.equal(shared.globalData.plans.length, 3);
console.log('PASS: specific plan, optional fields skipped, same-name isolation, repeat/reopen idempotency, invalid/cancelled guards, confirmation recheck, fresh runtime');
console.log('PASS: add-to-record-to-today/week flow, refresh on return, selected week preserved, completed plan cannot edit/cancel');

})().catch(error => { console.error(error); process.exitCode = 1; });
