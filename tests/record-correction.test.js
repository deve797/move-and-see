(async () => {
const { createTestApp, prepareTestApp } = require('./helpers/runtime');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

let now = '2026-09-26T04:00:00Z';
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
}
const app = { globalData: { plans: [
  { id: 1, date: '2026-09-26', activity: '跑步', startTime: '07:00', result: { status: 'completed' } },
  { id: 2, date: '2026-09-26', activity: '跑步', startTime: '08:00', result: { status: 'incomplete', reason: '下雨' } },
  { id: 3, date: '2026-09-27', activity: '瑜伽', startTime: '09:00' },
  { id: 4, date: '2026-09-25', activity: '散步', startTime: '20:00', cancelled: true, result: { status: 'completed' } }
] } };
async function mount(name, planId) {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => prepareTestApp(app),
    Page(value) { definition = value; },
    wx: { showToast() {}, pageScrollTo() {}, showToast() {} }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value); }
  });
  if (page.onLoad) (await page.onLoad(planId === undefined ? {} : { planId: String(planId) }));
  if (page.onShow) (await page.onShow());
  return page;
}
const chooseStatus = (page, status) => page.selectCorrectionStatus({ currentTarget: { dataset: { status } } });
const chooseReason = (page, reason) => page.selectCorrectionReason({ currentTarget: { dataset: { reason } } });
const snapshot = () => JSON.stringify(app.globalData.plans, (key, value) => key === 'version' ? undefined : value);
const planFields = () => app.globalData.plans.map(({ result, version, ...plan }) => plan);
const originalFields = JSON.stringify(planFields());
const today = (await mount('today'));
const week = (await mount('week'));
const record = (await mount('record', 1));
const original = snapshot();
assert.equal(record.data.canCorrect, true);
record.startCorrection();
assert.equal(record.data.correcting, true);
assert.equal(record.data.correctionStatus, 'completed');
chooseStatus(record, 'unsupported');
assert.equal(record.data.correctionStatus, 'completed');
chooseStatus(record, 'incomplete');
assert.equal(record.data.correctionReason, '');
assert.equal(record.data.canConfirmCorrection, false);
(await record.confirmCorrection());
assert.equal(snapshot(), original);
chooseReason(record, '无效原因');
assert.equal(record.data.canConfirmCorrection, false);
record.setData({ correctionReason: '无效原因', canConfirmCorrection: true });
(await record.confirmCorrection());
assert.equal(snapshot(), original); // 提交必须重新校验原因。
chooseReason(record, '加班');
assert.equal(record.data.canConfirmCorrection, true);
assert.equal(snapshot(), original); // 草稿不修改共享结果。
record.cancelCorrection();
(await record.confirmCorrection());
assert.equal(snapshot(), original);
assert.equal(record.data.correcting, false);

record.startCorrection();
chooseStatus(record, 'incomplete');
assert.equal(record.data.correctionReason, '');
chooseReason(record, '加班');
(await record.confirmCorrection());
assert.equal(app.globalData.plans[0].result.status, 'incomplete');
assert.equal(app.globalData.plans[0].result.reason, '加班');
assert.equal(record.data.plan.result.reason, '加班');
assert.equal(record.data.correcting, false);
assert.equal(JSON.stringify(app.globalData.plans.slice(1)), JSON.stringify(JSON.parse(original).slice(1)));
(await today.onShow());
(await week.onShow());
assert.equal(today.data.activities.find(item => item.id === 1).result.status, 'incomplete');
assert.equal(today.data.activities.find(item => item.id === 1).result.reason, '加班');
assert.equal(week.data.days.flatMap(day => day.plans).find(item => item.id === 1).result.status, 'incomplete');
assert.equal(week.data.days.flatMap(day => day.plans).find(item => item.id === 1).result.reason, '加班');
const confirmedResult = app.globalData.plans[0].result;
(await record.confirmCorrection());
assert.equal(app.globalData.plans[0].result, confirmedResult); // 连点不会产生第二次结果。
const reopened = (await mount('record', 1));
assert.equal(reopened.data.plan.result.reason, '加班');
reopened.startCorrection();
chooseStatus(reopened, 'completed');
assert.equal(reopened.data.correctionReason, '');
assert.equal(app.globalData.plans[0].result.reason, '加班');
reopened.cancelCorrection();
assert.equal(app.globalData.plans[0].result.reason, '加班');
reopened.startCorrection();
chooseStatus(reopened, 'completed');
(await reopened.confirmCorrection());
assert.equal(app.globalData.plans[0].result.status, 'completed');
assert.equal(app.globalData.plans[0].result.reason, undefined);
assert.equal(reopened.data.plan.result.reason, undefined);
assert.equal(reopened.data.selectedReason, '');
assert.equal((await mount('record', 1)).data.completed, true);

const beforeDiscard = snapshot();
const second = (await mount('record', 2));
second.startCorrection();
chooseReason(second, '临时有事');
second.onHide && second.onHide();
(await second.onShow());
assert.equal(second.data.correcting, true);
assert.equal(second.data.correctionReason, '临时有事');
assert.equal(second.data.plan.result.reason, '下雨');
assert.equal(snapshot(), beforeDiscard); // 返回只保留草稿，不自动提交。
second.cancelCorrection();
second.startCorrection();
chooseStatus(second, 'completed');
chooseStatus(second, 'incomplete');
assert.equal(second.data.canConfirmCorrection, false); // 不复用上次未完成原因。
second.cancelCorrection();
assert.equal(snapshot(), beforeDiscard);

for (const id of [3, 4, 999, 'invalid', undefined]) {
  const invalid = (await mount('record', id));
  assert.equal(invalid.data.canCorrect, false);
  invalid.startCorrection();
  chooseStatus(invalid, 'incomplete');
  chooseReason(invalid, '加班');
  (await invalid.confirmCorrection());
  assert.equal(invalid.data.correcting, false);
  assert.equal(snapshot(), beforeDiscard); // 修正不能绕过首次录入或取消状态。
}
const stale = (await mount('record', 2));
stale.startCorrection();
chooseStatus(stale, 'completed');
app.globalData.plans[1].version = (app.globalData.plans[1].version || 0) + 1;
app.globalData.plans[1].cancelled = true;
(await stale.confirmCorrection());
assert.equal(app.globalData.plans[1].result.status, 'incomplete');
delete app.globalData.plans[1].cancelled;
assert.equal(JSON.stringify(planFields()), originalFields); // ID、日期、项目、时间、数量不变。

(await today.onShow());
(await week.onShow());
assert.equal(today.data.activities.find(item => item.id === 1).result.status, 'completed');
assert.equal(today.data.activities.find(item => item.id === 1).result.reason, undefined);
assert.equal(week.data.days.flatMap(day => day.plans).find(item => item.id === 1).result.reason, undefined);
console.log('PASS: reason required, draft isolation, correction both ways, clear old reason, discard/back, stable plan fields/count, other-plan isolation, repeat confirmation, invalid/cancelled guards, list refresh');

const setPeriod = async marked => (await today.setPeriod({ currentTarget: { dataset: { marked } } }));
(await setPeriod(true));
const markedResults = snapshot();
const withReason = (await mount('record', 2));
assert.equal(withReason.data.canCorrect, true, '免考核不锁死已有结果的修正');
withReason.startCorrection();
assert.equal(withReason.data.correctionReason, '下雨');
const originalResult = app.globalData.plans[1].result;
(await withReason.confirmCorrection());
assert.deepEqual(app.globalData.plans[1].result, originalResult);
withReason.startCorrection();
chooseStatus(withReason, 'completed');
withReason.cancelCorrection();
assert.equal(snapshot(), markedResults, '原样确认和放弃修正都保留原原因');

const exempt = (await mount('record', 1));
exempt.startCorrection();
chooseStatus(exempt, 'incomplete');
assert.equal(exempt.data.canConfirmCorrection, true, '免考核修正未完成无需原因');
assert.equal(snapshot(), markedResults, '选择正确结果仍只更新草稿');
exempt.setData({ correctionReason: '无效原因' });
(await exempt.confirmCorrection());
assert.equal(snapshot(), markedResults, '免填原因不代表接受非法原因');
exempt.setData({ correctionReason: '' });
(await exempt.confirmCorrection());
assert.equal(app.globalData.plans[0].result.status, 'incomplete');
assert.equal(app.globalData.plans[0].result.reason, '');
const reasonFreeResult = app.globalData.plans[0].result;
(await exempt.confirmCorrection());
assert.deepEqual(app.globalData.plans[0].result, reasonFreeResult);
exempt.startCorrection();
assert.equal(exempt.data.canConfirmCorrection, true);
(await exempt.confirmCorrection());
assert.deepEqual(app.globalData.plans[0].result, reasonFreeResult, '原样确认不重建无原因结果');

exempt.startCorrection();
chooseStatus(exempt, 'completed');
(await setPeriod(false));
(await exempt.confirmCorrection());
assert.deepEqual(app.globalData.plans[0].result, reasonFreeResult, '取消免考核后拒绝此前打开的修正草稿');
assert.equal(exempt.data.correcting, true);
assert.match(exempt.data.saveError, /更新|刷新/);
(await exempt.onShow());
assert.equal(exempt.data.saveConflict, true);
assert.equal(exempt.data.correctionStatus, 'completed');
exempt.cancelCorrection(); // 明确放弃后才刷新日期标记和版本。
assert.equal(exempt.data.periodExempt, false);
exempt.startCorrection();
assert.equal(exempt.data.canConfirmCorrection, false, '普通未完成记录重新修正仍要求原因');
(await exempt.confirmCorrection());
assert.deepEqual(app.globalData.plans[0].result, reasonFreeResult);
chooseReason(exempt, '加班');
(await setPeriod(true));
(await exempt.confirmCorrection());
assert.deepEqual(app.globalData.plans[0].result, reasonFreeResult, '标记免考核后也拒绝原普通修正草稿');
assert.equal(exempt.data.correcting, true);
assert.match(exempt.data.saveError, /更新|刷新/);

now = '2026-09-26T16:00:00Z'; // 北京时间次日，同一次运行中重新打开昨天的记录。
(await today.onShow());
const historical = (await mount('record', 1));
assert.equal(historical.data.periodExempt, true);
assert.equal(historical.data.canCorrect, true);
historical.startCorrection();
chooseStatus(historical, 'completed');
(await historical.confirmCorrection());
assert.equal(app.globalData.plans[0].result.status, 'completed');
historical.startCorrection();
chooseStatus(historical, 'incomplete');
assert.equal(historical.data.canConfirmCorrection, true);
(await historical.confirmCorrection());
assert.equal(app.globalData.plans[0].result.status, 'incomplete');
assert.equal(app.globalData.plans[0].result.reason, '');
assert.equal(app.globalData.periodDays['2026-09-26'], true);
assert.equal(JSON.stringify(planFields()), originalFields);
assert.deepEqual(app.globalData.plans[1].result, originalResult, '只修正指定计划');
assert.equal((await mount('review')).data.reasonGroups.some(group => !group.reason), false, '无原因不生成虚构原因组');
console.log('PASS: period-exempt correction across Beijing midnight, optional reasons, unchanged/discarded results, two-way stale marker guards and normal reason validation');

})().catch(error => { console.error(error); process.exitCode = 1; });
