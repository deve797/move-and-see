const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createTestApp } = require('./helpers/runtime');
const { resultCategory, actualExerciseDate } = require('../miniprogram/utils/exercise-result');
const weeklyProgress = require('../miniprogram/utils/weekly-progress');

const plain = value => JSON.parse(JSON.stringify(value));
const plan = (id, date, result, extra = {}) => ({ id, date, activity: '跑步', startTime: '09:00', result, ...extra });
async function mount(name, app, query = {}, now = '2026-09-27T04:00:00Z') {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
  }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => app,
    Page(value) { definition = value; }, wx: { pageScrollTo() {} }
  });
  const page = Object.assign({}, definition, {
    data: plain(definition.data),
    setData(value, callback) { Object.assign(this.data, value); if (callback) callback(); }
  });
  if (page.onLoad) await page.onLoad(query);
  if (page.onShow) await page.onShow();
  return page;
}

test('结果分类兼容旧记录，并按实际日期判断跨日补做', () => {
  const cases = [
    [undefined, '', ''],
    [{ status: 'completed' }, 'completed', ''],
    [{ status: 'completed', actualDate: '2026-09-21' }, 'completed', '2026-09-21'],
    [{ status: 'completed', actualDate: '2026-09-22' }, 'makeup', '2026-09-22'],
    [{ status: 'replacement', actualActivity: '散步' }, 'replacement', ''],
    [{ status: 'replacement', actualDate: '2026-09-21' }, 'replacement', '2026-09-21'],
    [{ status: 'replacement', actualDate: '2026-09-22' }, 'makeup', '2026-09-22'],
    [{ status: 'incomplete' }, 'incomplete', ''],
    [{ status: 'incomplete', makeup: { date: '2026-09-23' }, actualDate: '2026-09-22' }, 'makeup', '2026-09-23']
  ];
  for (const [result, category, date] of cases) {
    const source = plan(1, '2026-09-21', result);
    assert.equal(resultCategory(source), category);
    assert.equal(actualExerciseDate(source), date);
  }
});

test('周计划和回看展示新补做与实际日期，统计不搬动原计划周', async () => {
  const app = createTestApp({ plans: [
    plan(1, '2026-09-21', { status: 'completed', actualDate: '2026-09-23' }),
    plan(2, '2026-09-22', { status: 'replacement', actualDate: '2026-09-24', actualActivity: '散步' }),
    plan(3, '2026-09-26', { status: 'completed', actualDate: '2026-09-26' }),
    plan(4, '2026-09-26', { status: 'replacement', actualDate: '2026-09-26', actualActivity: '瑜伽' }),
    plan(5, '2026-09-26', { status: 'completed' }),
    plan(6, '2026-09-25', { status: 'incomplete', reason: '下雨', makeup: { date: '2026-09-26', actualActivity: '徒步' } }),
    plan(7, '2026-09-23', { status: 'incomplete', reason: '加班' })
  ] });
  const original = JSON.stringify(app.globalData);
  const week = await mount('week', app);
  const shown = week.data.days.flatMap(day => day.plans);
  assert.deepEqual(shown.filter(item => item.resultCategory === 'makeup').map(item => item.id), [1, 2, 6]);
  assert.equal(shown.find(item => item.id === 1).actualActivity, '跑步');
  assert.equal(shown.find(item => item.id === 2).actualActivity, '散步');
  assert.equal(shown.find(item => item.id === 5).actualDate, '');
  const review = await mount('review', app);
  const groups = plain(review.data.resultGroups);
  assert.deepEqual(groups.map(group => group.plans.map(item => item.id)), [[3, 5], [4], [1, 2, 6], [7]]);
  assert.deepEqual(plain(review.data.weeklyProgress), { completed: 6, total: 7 });
  assert.equal(groups[2].plans[0].actualDate, '2026-09-23');
  assert.equal(groups[2].plans[2].result.reason, '下雨');
  assert.deepEqual(plain(review.data.reasonGroups), [
    { reason: '加班', count: 1, makeupCount: 0 },
    { reason: '下雨', count: 1, makeupCount: 1 }
  ]);
  assert.equal(JSON.stringify(app.globalData), original, '页面派生字段不能写入源记录');
  const crossWeek = [plan(8, '2026-09-27', { status: 'completed', actualDate: '2026-09-28' })];
  assert.deepEqual(weeklyProgress(crossWeek, {}, '2026-09-27'), { completed: 1, total: 1 });
  assert.deepEqual(weeklyProgress(crossWeek, {}, '2026-09-28'), { completed: 0, total: 0 });
});

test('今天显示保存的实际日期，旧完成记录不补造日期', async () => {
  const app = createTestApp({ plans: [
    plan(1, '2026-09-27', { status: 'completed', actualDate: '2026-09-27' }),
    plan(2, '2026-09-27', { status: 'replacement', actualDate: '2026-09-27', actualActivity: '瑜伽' }),
    plan(3, '2026-09-27', { status: 'completed' })
  ] });
  const today = await mount('today', app);
  assert.deepEqual(plain(today.data.activities.map(item => [item.id, item.resultCategory, item.actualDate, item.actualActivity])), [
    [1, 'completed', '2026-09-27', '跑步'], [2, 'replacement', '2026-09-27', '瑜伽'], [3, 'completed', '', '跑步']
  ]);
});

test('跨日心情不与原计划拼接，实际运动备注使用实际日期', async () => {
  const app = createTestApp({ plans: [
    plan(1, '2026-09-21', { status: 'completed', actualDate: '2026-09-22', afterMood: 'great', afterMoodNote: '第二天跑步后' }, { beforeMood: 'low', beforeMoodNote: '原计划前' }),
    plan(2, '2026-09-23', { status: 'completed', actualDate: '2026-09-23', afterMood: 'good', afterMoodNote: '当天运动后' }, { beforeMood: 'neutral', beforeMoodNote: '当天运动前' }),
    plan(3, '2026-09-24', { status: 'replacement', actualDate: '2026-09-25', actualActivity: '散步', beforeMood: 'down', afterMood: 'good', beforeMoodNote: '实际散步前', afterMoodNote: '实际散步后' }, { beforeMood: 'great', beforeMoodNote: '原跑步前' }),
    plan(4, '2026-09-26', { status: 'completed', afterMood: 'good' }, { beforeMood: 'good' })
  ] });
  const review = await mount('review', app);
  assert.deepEqual(plain(review.data.moodComparison), { improved: 2, same: 1, declined: 0, total: 3 });
  const notes = plain(review.data.moodNotes);
  assert.equal(notes.find(item => item.id === '1-plan').after, '');
  assert.deepEqual(notes.find(item => item.id === '1-motion'), {
    id: '1-motion', date: '2026-09-22', startTime: '', activity: '跑步',
    context: '补做 · 原计划 2026-09-21 09:00 跑步', before: '', after: '第二天跑步后'
  });
  assert.equal(notes.find(item => item.id === '2-plan').after, '当天运动后');
  assert.equal(notes.find(item => item.id === '3-motion').date, '2026-09-25');
  assert.equal(notes.find(item => item.id === '3-motion').before, '实际散步前');
  assert.equal(notes.find(item => item.id === '3-motion').startTime, '');
});

test('心情页用实际日期，不把原计划开始时刻当成实际时刻', async () => {
  const app = createTestApp({ plans: [
    plan(1, '2026-09-21', { status: 'completed', actualDate: '2026-09-22' }),
    plan(2, '2026-09-23', { status: 'completed', actualDate: '2026-09-23' }),
    plan(3, '2026-09-24', { status: 'completed' }),
    plan(4, '2026-09-25', { status: 'incomplete', makeup: { date: '2026-09-26', actualActivity: '瑜伽' } })
  ] });
  for (const [id, date, time, makeup] of [[1, '2026-09-22', '', '0'], [2, '2026-09-23', '', '0'], [3, '2026-09-24', '09:00', '0'], [4, '2026-09-26', '', '1']]) {
    const mood = await mount('mood', app, { planId: id, makeup });
    assert.equal(mood.data.plan.date, date);
    assert.equal(mood.data.plan.startTime, time);
  }
});
