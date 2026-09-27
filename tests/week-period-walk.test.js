const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createTestApp } = require('./helpers/runtime');

const clone = value => JSON.parse(JSON.stringify(value));
async function mount(name, app, now) {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
  }
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => app,
    Page(value) { definition = value; }, wx: { pageScrollTo() {} }
  });
  const page = Object.assign({}, definition, {
    data: clone(definition.data),
    setData(value) { Object.assign(this.data, value); }
  });
  if (page.onLoad) page.onLoad({});
  await page.onShow();
  return page;
}
const day = (page, date) => page.data.days.find(item => item.date === date);

test('saved voluntary walks remain readable after midnight and across week navigation', async () => {
  const app = createTestApp({
    periodDays: { '2026-09-25': true, '2026-09-26': true },
    periodWalks: {
      '2026-09-25': { status: 'incomplete' },
      '2026-09-26': { status: 'completed' },
      '2026-09-27': { status: 'pending' }
    }
  });
  const original = clone(app.globalData);
  app.saveDay = app.savePlan = async () => assert.fail('history must only read saved records');
  const week = await mount('week', app, '2026-09-26T16:00:00Z');
  assert.equal(day(week, '2026-09-25').periodWalk.status, 'incomplete');
  assert.equal(day(week, '2026-09-26').periodWalk.status, 'completed');
  assert.equal(day(week, '2026-09-27').periodWalk.status, 'pending');
  assert.equal(day(week, '2026-09-24').periodWalk, null);
  week.showNextWeek();
  assert.ok(week.data.days.every(item => item.periodWalk === null));
  week.selectWeek({ detail: { value: '2026-09-26' } });
  assert.equal(day(week, '2026-09-26').periodWalk.status, 'completed');
  const nextWeek = await mount('week', app, '2026-09-27T16:00:00Z');
  assert.equal(nextWeek.data.selectedDate, '2026-09-28');
  nextWeek.selectWeek({ detail: { value: '2026-09-26' } });
  assert.equal(day(nextWeek, '2026-09-26').periodWalk.status, 'completed');
  assert.deepEqual(app.globalData, original);
});

test('walk history survives unmarking and stays separate from ordinary plans and progress', async () => {
  const app = createTestApp({
    plans: [{ id: 'walk-plan', date: '2026-09-26', startTime: '09:00', activity: '散步', result: { status: 'incomplete', reason: '下雨' } }],
    periodWalks: { '2026-09-26': { status: 'completed' } }
  });
  const original = clone(app.globalData);
  const week = await mount('week', app, '2026-09-27T04:00:00Z');
  const saturday = day(week, '2026-09-26');
  assert.equal(saturday.periodWalk.status, 'completed');
  assert.equal(saturday.plans.length, 1);
  assert.equal(saturday.plans[0].result.status, 'incomplete');
  assert.equal(saturday.plans[0].periodExempt, false);
  const today = await mount('today', app, '2026-09-27T04:00:00Z');
  const review = await mount('review', app, '2026-09-27T04:00:00Z');
  assert.deepEqual(clone(today.data.weeklyProgress), { completed: 0, total: 1 });
  assert.deepEqual(clone(review.data.weeklyProgress), { completed: 0, total: 1 });
  assert.equal(review.data.resultGroups.find(group => group.key === 'incomplete').plans.length, 1);
  assert.deepEqual(app.globalData, original);
});
