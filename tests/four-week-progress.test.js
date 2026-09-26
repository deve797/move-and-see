const assert = require('node:assert/strict');
const fourWeekProgress = require('../miniprogram/utils/four-week-progress');

const plans = [
  { date: '2026-09-14', result: { status: 'completed' } },
  { date: '2026-09-15' },
  { date: '2026-09-20' },
  { date: '2026-09-21', result: { status: 'completed' } },
  { date: '2026-09-22', result: { status: 'replacement' } },
  { date: '2026-09-25', result: { status: 'incomplete', reason: '下雨' } },
  { date: '2026-09-27' },
  { date: '2026-09-26', result: { status: 'completed' } },
  { date: '2026-09-24', cancelled: true, result: { status: 'completed' } },
  { date: '2026-09-28', result: { status: 'completed' } },
  { date: '2026-08-30', result: { status: 'completed' } }
];
const periodDays = { '2026-09-26': true };
const snapshot = JSON.stringify({ plans, periodDays });
let weeks = fourWeekProgress(plans, periodDays, '2026-09-26');
assert.deepEqual(weeks.map(week => [week.startDate, week.endDate, week.isCurrent]), [
  ['2026-08-31', '2026-09-06', false], ['2026-09-07', '2026-09-13', false],
  ['2026-09-14', '2026-09-20', false], ['2026-09-21', '2026-09-27', true]
]);
assert.deepEqual(weeks.map(week => [week.completed, week.total, week.rate]), [[0, 0, null], [0, 0, null], [1, 3, 33], [2, 4, 50]]);
assert.equal(weeks[0].emptyLabel, '无数据');
assert.equal(weeks[1].emptyLabel, '无数据');
assert.equal(JSON.stringify({ plans, periodDays }), snapshot);

plans[5].result.makeup = { date: '2026-09-28', actualActivity: '散步' };
weeks = fourWeekProgress(plans, periodDays, '2026-09-28');
assert.deepEqual(weeks.map(week => [week.completed, week.total, week.rate]), [[0, 0, null], [1, 3, 33], [3, 4, 75], [1, 1, 100]]);
plans[9].result = undefined;
assert.equal(fourWeekProgress(plans, periodDays, '2026-09-28')[3].rate, 0, '有有效计划但未完成才是 0%');

const emptyWeeks = fourWeekProgress([
  { date: '2026-08-31', cancelled: true },
  { date: '2026-09-07', result: { status: 'completed' } }
], { '2026-09-07': true }, '2026-09-26');
assert.deepEqual(emptyWeeks.map(week => [week.rate, week.emptyLabel]), [
  [null, '无考核计划'], [null, '无考核计划'], [null, '无数据'], [null, '无考核计划']
]);
assert.deepEqual(fourWeekProgress([], {}, '2026-09-26').map(week => week.emptyLabel), ['无数据', '无数据', '无数据', '无考核计划']);
assert.deepEqual(fourWeekProgress([], {}, '2027-01-03').map(week => [week.startDate, week.endDate]), [
  ['2026-12-07', '2026-12-13'], ['2026-12-14', '2026-12-20'], ['2026-12-21', '2026-12-27'], ['2026-12-28', '2027-01-03']
]);
assert.deepEqual(fourWeekProgress([], {}, '2028-03-01')[3], {
  startDate: '2028-02-28', endDate: '2028-03-05', isCurrent: true, completed: 0, total: 0, rate: null, emptyLabel: '无考核计划'
});
console.log('PASS: four consecutive Monday-Sunday weeks, current marker, percentages, original-week makeup and read-only calculation');
console.log('PASS: missing history vs cancelled/exempt/empty current week, real zero rate, cross-year and leap-day bounds');
