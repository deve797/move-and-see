const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

let now = '2026-09-26T04:00:00Z';
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
}
function runtime() {
  let app;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../miniprogram/app.js'), 'utf8'), {
    App(value) { app = value; }
  });
  return app;
}
function mount(name, app) {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => app,
    Page(value) { definition = value; },
    wx: { pageScrollTo() {}, showToast() {}, showModal(options) { options.success({ confirm: true }); } }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value); }
  });
  if (page.onLoad) page.onLoad();
  if (page.onShow) page.onShow();
  return page;
}
function add(page, date, activity, startTime) {
  page.startAdding();
  page.updateDraft({ date, activity, startTime });
  page.confirmAdding();
}
const event = id => ({ currentTarget: { dataset: { id } } });
const shown = page => Array.from(page.data.activities, item => [item.id, item.name, item.time]);
const app = runtime();
const today = mount('today', app);
assert.deepEqual(shown(today), []); // 首次打开不填充示例。
const week = mount('week', app);
add(week, '2026-09-26', '跑步', '19:00');
add(week, '2026-09-26', '瑜伽', '07:30');
add(week, '2026-09-25', '散步', '08:00');
add(week, '2026-09-27', '网球', '09:00');
const original = JSON.stringify(week._plans);
today.onShow();
assert.equal(today.data.date, '2026-09-26');
assert.deepEqual(shown(today), [[2, '瑜伽', '07:30'], [1, '跑步', '19:00']]);
assert.equal(JSON.stringify(week._plans), original); // 排序不修改共享数组。
assert.equal(today.data.activities.some(item => item.duration || item.completed), false);

const reopenedWeek = mount('week', app); // 返回再打开周计划，共享同一批安排。
assert.equal(reopenedWeek._plans.length, 4);
reopenedWeek.startEditing(event(1));
reopenedWeek.updateDraft({ activity: '力量训练', startTime: '18:00' });
reopenedWeek.confirmAdding();
today.onShow();
assert.deepEqual(shown(today), [[2, '瑜伽', '07:30'], [1, '力量训练', '18:00']]);
assert.equal(today.data.activities[1].kind, ''); // 非瑜伽/跑步不冒用动画。
reopenedWeek.startEditing(event(1));
reopenedWeek.updateDraft({ date: '2026-09-27' });
reopenedWeek.confirmAdding();
today.onShow();
assert.deepEqual(shown(today), [[2, '瑜伽', '07:30']]);
add(reopenedWeek, '2026-09-26', '网球', '20:00');
reopenedWeek.cancelPlan(event(5));
today.onShow();
assert.deepEqual(shown(today), [[2, '瑜伽', '07:30']]);
assert.deepEqual(shown(mount('today', app)), shown(today));

now = '2026-09-26T16:00:00Z'; // 北京时间跨日，设备时区不影响归属。
today.onShow();
assert.equal(today.data.date, '2026-09-27');
assert.deepEqual(shown(today), [[4, '网球', '09:00'], [1, '力量训练', '18:00']]);
now = '2026-09-27T16:00:00Z';
today.onShow();
assert.deepEqual(shown(today), []);
assert.deepEqual(shown(mount('today', runtime())), []); // 新运行不持久化。

// 同一瞬间切换设备时区，今天与本周仍以北京时间为准。
const originalTimezone = process.env.TZ;
try {
  for (const timezone of ['Asia/Shanghai', 'America/Los_Angeles', 'UTC', 'Pacific/Kiritimati']) {
    process.env.TZ = timezone;
    const cases = [
      ['2026-09-27T15:59:59Z', '2026-09-27', '2026-09-21', '2026-09-28'],
      ['2026-09-27T16:00:00Z', '2026-09-28', '2026-09-28', '2026-10-05'],
      ['2026-12-31T16:00:00Z', '2027-01-01', '2026-12-28', '2027-01-04'],
      ['2027-01-03T16:00:00Z', '2027-01-04', '2027-01-04', '2027-01-11']
    ];
    for (const [instant, date, monday, nextMonday] of cases) {
      now = instant;
      const context = timezone + ' / ' + instant;
      const boundaryApp = runtime();
      const boundaryWeek = mount('week', boundaryApp);
      assert.equal(boundaryWeek.data.selectedDate, monday, context);
      assert.equal(boundaryWeek.data.title, '本周计划', context);
      add(boundaryWeek, date, '跑步', '19:00');
      const boundaryToday = mount('today', boundaryApp);
      assert.equal(boundaryToday.data.date, date, context);
      assert.deepEqual(shown(boundaryToday), [[1, '跑步', '19:00']], context);
      const openedWeek = mount('week', boundaryApp);
      const planIds = () => openedWeek.data.days.flatMap(day => day.plans.map(plan => plan.id));
      assert.equal(openedWeek.data.selectedDate, monday, context);
      assert.equal(openedWeek.data.days.length, 7, context);
      assert.deepEqual(planIds(), [1], context);
      openedWeek.showNextWeek();
      assert.equal(openedWeek.data.selectedDate, nextMonday, context);
      assert.equal(openedWeek.data.isNextWeek, true, context);
      assert.deepEqual(planIds(), [], context);
      openedWeek.showCurrentWeek();
      assert.equal(openedWeek.data.selectedDate, monday, context);
      assert.equal(openedWeek.data.isCurrentWeek, true, context);
      assert.deepEqual(planIds(), [1], context);
    }
  }
} finally {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
}
console.log('PASS: empty state data, today-only sorted plans, no invented duration/result, shared navigation, edits/cancellation, Beijing midnight, fresh runtime');
console.log('PASS: today/week agreement across four device timezones, Beijing Sunday/Monday boundary, year boundary and week navigation');
