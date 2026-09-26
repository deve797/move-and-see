const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

let now = '2026-09-26T12:00:00+08:00';
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
}
function mount(name, app, query = {}) {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => app,
    Page(value) { definition = value; }, wx: { pageScrollTo() {}, showToast() {} }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value); }
  });
  if (page.onLoad) page.onLoad(query);
  if (page.onShow) page.onShow();
  return page;
}
const app = { globalData: { plans: [
  { id: 1, date: '2026-09-25', activity: '跑步', startTime: '19:00' },
  { id: 2, date: '2026-09-25', activity: '跑步', startTime: '20:00' },
  { id: 3, date: '2026-09-26', activity: '瑜伽', startTime: '12:00' },
  { id: 4, date: '2026-09-26', activity: '网球', startTime: '12:01' },
  { id: 5, date: '2026-09-27', activity: '散步', startTime: '08:00' },
  { id: 6, date: '2026-09-25', activity: '力量训练', startTime: '08:00', result: { status: 'completed' } },
  { id: 7, date: '2026-09-25', activity: '徒步', startTime: '09:00', result: { status: 'incomplete', reason: '下雨' } },
  { id: 8, date: '2026-09-25', activity: '瑜伽', startTime: '10:00', cancelled: true },
  { id: 9, date: '2026-09-20', activity: '跑步', startTime: '18:00' }
] } };
const original = JSON.stringify(app.globalData.plans);
const week = mount('week', app);
const visible = () => week.data.days.flatMap(day => day.plans);
const shown = id => visible().find(plan => plan.id === id);
assert.deepEqual(Array.from(visible().filter(plan => plan.pendingRecord), plan => plan.id), [1, 2, 3]);
assert.equal(shown(4).pendingRecord, false);
assert.equal(shown(5).pendingRecord, false);
assert.equal(shown(6).pendingRecord, false);
assert.equal(shown(7).pendingRecord, false);
assert.equal(shown(6).result.status, 'completed');
assert.equal(shown(7).result.reason, '下雨');
assert.equal(shown(8), undefined);
assert.equal(JSON.stringify(app.globalData.plans), original); // 待补只是展示，不自动写未完成。

now = '2026-09-26T12:01:00+08:00';
week.onShow();
assert.equal(shown(4).pendingRecord, true); // 页面重新显示时重新判断到时状态。
week.selectWeek({ detail: { value: '2026-09-20' } });
assert.equal(shown(9).pendingRecord, true);
const selectedWeek = week.data.selectedDate;
const previousWeekRecord = mount('record', app, { planId: '9' });
assert.equal(previousWeekRecord.data.plan.id, 9);
assert.equal(previousWeekRecord.data.plan.date, '2026-09-20');
previousWeekRecord.confirmCompleted();
week.onShow();
assert.equal(week.data.selectedDate, selectedWeek); // 记录后返回仍在原周。
assert.equal(shown(9).pendingRecord, false);
assert.equal(shown(9).result.status, 'completed');
week.showNextWeek();
assert.equal(visible().length, 0);
week.showCurrentWeek();
assert.equal(shown(1).pendingRecord, true);

const untouched = JSON.stringify(app.globalData.plans.slice(1));
const record = mount('record', app, { planId: '1' });
assert.equal(record.data.plan.activity, '跑步');
assert.equal(record.data.plan.date, '2026-09-25');
assert.equal(record.data.plan.startTime, '19:00');
week.onShow();
assert.equal(shown(1).pendingRecord, true); // 只打开、未确认，不清除待补。
record.confirmCompleted();
week.onShow();
assert.equal(shown(1).pendingRecord, false);
assert.equal(shown(1).result.status, 'completed');
assert.equal(shown(2).pendingRecord, true); // 同日同项目的另一条不受影响。
assert.equal(JSON.stringify(app.globalData.plans.slice(1)), untouched);
assert.equal(app.globalData.plans.length, 9);
assert.equal(mount('record', app, { planId: '1' }).data.completed, true);
assert.equal(mount('record', app, { planId: '2' }).data.plan.startTime, '20:00');

const incompleteRecord = mount('record', app, { planId: '2' });
incompleteRecord.startIncomplete();
incompleteRecord.confirmIncomplete();
week.onShow();
assert.equal(shown(2).pendingRecord, true); // 未选择原因，补录未完成不能清除待补。
incompleteRecord.selectReason({ currentTarget: { dataset: { reason: '下雨' } } });
incompleteRecord.confirmIncomplete();
week.onShow();
assert.equal(shown(2).pendingRecord, false);
assert.equal(shown(2).result.status, 'incomplete');
assert.equal(shown(2).result.reason, '下雨');
assert.equal(shown(1).result.status, 'completed');
assert.equal(mount('record', app, { planId: '2' }).data.incomplete, true);
assert.equal(app.globalData.plans.length, 9);

now = '2026-12-31T16:00:00Z'; // 北京时间跨年，设备时区不影响判断。
const yearApp = { globalData: { plans: [
  { id: 1, date: '2026-12-31', activity: '跑步', startTime: '23:59' },
  { id: 2, date: '2027-01-01', activity: '瑜伽', startTime: '00:00' },
  { id: 3, date: '2027-01-01', activity: '网球', startTime: '00:01' }
] } };
const yearWeek = mount('week', yearApp);
assert.deepEqual(Array.from(yearWeek.data.days.flatMap(day => day.plans), plan => plan.pendingRecord), [true, true, false]);
assert.equal(mount('week', { globalData: { plans: [] } }).data.days.flatMap(day => day.plans).length, 0);
console.log('PASS: overdue-only pending, exact start boundary, result preservation, cancelled exclusion, no automatic result, selected-week refresh, completed/incomplete recording with same-name isolation, Beijing midnight/year boundary, empty runtime');
