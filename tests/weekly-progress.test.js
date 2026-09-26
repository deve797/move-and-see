const assert = require('node:assert/strict');
const weeklyProgress = require('../miniprogram/utils/weekly-progress');

const plans = [
  { id: 1, date: '2026-09-21', result: { status: 'completed', feeling: '轻松' } },
  { id: 2, date: '2026-09-22', result: { status: 'replacement', actualActivity: '散步' } },
  { id: 3, date: '2026-09-25', result: { status: 'incomplete', reason: '下雨' } },
  { id: 4, date: '2026-09-27' },
  { id: 5, date: '2026-09-26', result: { status: 'completed' } },
  { id: 6, date: '2026-09-24', cancelled: true, result: { status: 'completed' } },
  { id: 7, date: '2026-09-20', result: { status: 'completed' } },
  { id: 8, date: '2026-09-28', result: { status: 'completed' } }
];
const periodDays = { '2026-09-26': true };
const check = (date, completed, total) => assert.deepEqual(weeklyProgress(plans, periodDays, date), { completed, total });
const snapshot = () => JSON.stringify({ plans, periodDays });
const references = plans.map(plan => ({ plan, result: plan.result }));
let before = snapshot();
check('2026-09-21', 2, 4); // 周日未来计划也计入周一查看的分母。
check('2026-09-26', 2, 4);
check('2026-09-27', 2, 4);
check('2026-09-28', 1, 1);
assert.equal(snapshot(), before);

plans[2].result.makeup = { date: '2026-09-28', actualActivity: '散步', afterMood: 'good' };
before = snapshot();
for (let repeat = 0; repeat < 3; repeat++) {
  check('2026-09-25', 3, 4);
  check('2026-09-28', 1, 1); // 跨周补做只更新原计划所属周。
}
assert.equal(snapshot(), before);
assert.equal(plans[2].date, '2026-09-25');
assert.equal(plans[2].result.status, 'incomplete');
assert.equal(plans[2].result.reason, '下雨');
references.forEach((reference, index) => {
  assert.equal(plans[index], reference.plan);
  assert.equal(plans[index].result, reference.result);
});

periodDays['2026-09-26'] = false;
check('2026-09-26', 4, 5); // 只有 true 是免考核，取消标记恢复既有完成记录。
periodDays['2026-09-26'] = true;
check('2026-09-26', 3, 4);
periodDays['2026-09-25'] = true;
check('2026-09-26', 2, 3); // 已补做的原计划免考核时也同时剔除分子、分母。
delete periodDays['2026-09-25'];
check('2026-09-26', 3, 4);
plans[0].cancelled = true;
check('2026-09-26', 2, 3);
plans[0].cancelled = false;
check('2026-09-26', 3, 4);
assert.deepEqual(weeklyProgress([], {}, '2026-09-26'), { completed: 0, total: 0 });
assert.deepEqual(weeklyProgress([plans[4], plans[5]], periodDays, '2026-09-26'), { completed: 0, total: 0 });

const yearPlans = [
  { date: '2026-12-27', result: { status: 'completed' } },
  { date: '2026-12-28', result: { status: 'completed' } },
  { date: '2027-01-01', result: { status: 'replacement', actualActivity: '瑜伽' } },
  { date: '2027-01-03' },
  { date: '2027-01-04', result: { status: 'completed' } }
];
for (const date of ['2026-12-28', '2026-12-31', '2027-01-01', '2027-01-03']) {
  assert.deepEqual(weeklyProgress(yearPlans, {}, date), { completed: 2, total: 3 }, date);
}
assert.deepEqual(weeklyProgress(yearPlans, {}, '2027-01-04'), { completed: 1, total: 1 });
console.log('PASS: 2/4 to original-week 3/4, makeup-week isolation, future denominator and repeated read-only calculation');
console.log('PASS: cancelled/exempt completed and makeup records, marker restoration, empty/all-exempt state and cross-year Monday-Sunday bounds');
