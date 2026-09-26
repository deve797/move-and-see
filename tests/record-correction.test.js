const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-09-26T04:00:00Z'])); }
}
const app = { globalData: { plans: [
  { id: 1, date: '2026-09-26', activity: '跑步', startTime: '07:00', result: { status: 'completed' } },
  { id: 2, date: '2026-09-26', activity: '跑步', startTime: '08:00', result: { status: 'incomplete', reason: '下雨' } },
  { id: 3, date: '2026-09-27', activity: '瑜伽', startTime: '09:00' },
  { id: 4, date: '2026-09-25', activity: '散步', startTime: '20:00', cancelled: true, result: { status: 'completed' } }
] } };
function mount(name, planId) {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => app,
    Page(value) { definition = value; },
    wx: { pageScrollTo() {}, showToast() {} }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value); }
  });
  if (page.onLoad) page.onLoad(planId === undefined ? {} : { planId: String(planId) });
  if (page.onShow) page.onShow();
  return page;
}
const chooseStatus = (page, status) => page.selectCorrectionStatus({ currentTarget: { dataset: { status } } });
const chooseReason = (page, reason) => page.selectCorrectionReason({ currentTarget: { dataset: { reason } } });
const snapshot = () => JSON.stringify(app.globalData.plans);
const planFields = () => app.globalData.plans.map(({ result, ...plan }) => plan);
const originalFields = JSON.stringify(planFields());
const today = mount('today');
const week = mount('week');
const record = mount('record', 1);
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
record.confirmCorrection();
assert.equal(snapshot(), original);
chooseReason(record, '无效原因');
assert.equal(record.data.canConfirmCorrection, false);
record.setData({ correctionReason: '无效原因', canConfirmCorrection: true });
record.confirmCorrection();
assert.equal(snapshot(), original); // 提交必须重新校验原因。
chooseReason(record, '加班');
assert.equal(record.data.canConfirmCorrection, true);
assert.equal(snapshot(), original); // 草稿不修改共享结果。
record.cancelCorrection();
record.confirmCorrection();
assert.equal(snapshot(), original);
assert.equal(record.data.correcting, false);

record.startCorrection();
chooseStatus(record, 'incomplete');
assert.equal(record.data.correctionReason, '');
chooseReason(record, '加班');
record.confirmCorrection();
assert.equal(app.globalData.plans[0].result.status, 'incomplete');
assert.equal(app.globalData.plans[0].result.reason, '加班');
assert.equal(record.data.plan.result.reason, '加班');
assert.equal(record.data.correcting, false);
assert.equal(JSON.stringify(app.globalData.plans.slice(1)), JSON.stringify(JSON.parse(original).slice(1)));
today.onShow();
week.onShow();
assert.equal(today.data.activities.find(item => item.id === 1).result.status, 'incomplete');
assert.equal(today.data.activities.find(item => item.id === 1).result.reason, '加班');
assert.equal(week.data.days.flatMap(day => day.plans).find(item => item.id === 1).result.status, 'incomplete');
assert.equal(week.data.days.flatMap(day => day.plans).find(item => item.id === 1).result.reason, '加班');
const confirmedResult = app.globalData.plans[0].result;
record.confirmCorrection();
assert.equal(app.globalData.plans[0].result, confirmedResult); // 连点不会产生第二次结果。
const reopened = mount('record', 1);
assert.equal(reopened.data.plan.result.reason, '加班');
reopened.startCorrection();
chooseStatus(reopened, 'completed');
assert.equal(reopened.data.correctionReason, '');
assert.equal(app.globalData.plans[0].result.reason, '加班');
reopened.cancelCorrection();
assert.equal(app.globalData.plans[0].result.reason, '加班');
reopened.startCorrection();
chooseStatus(reopened, 'completed');
reopened.confirmCorrection();
assert.equal(app.globalData.plans[0].result.status, 'completed');
assert.equal(app.globalData.plans[0].result.reason, undefined);
assert.equal(reopened.data.plan.result.reason, undefined);
assert.equal(reopened.data.selectedReason, '');
assert.equal(mount('record', 1).data.completed, true);

const beforeDiscard = snapshot();
const second = mount('record', 2);
second.startCorrection();
chooseReason(second, '临时有事');
second.onHide && second.onHide();
second.onShow();
assert.equal(second.data.correcting, false);
assert.equal(second.data.plan.result.reason, '下雨');
assert.equal(snapshot(), beforeDiscard); // 离开后返回不提交草稿。
second.startCorrection();
chooseStatus(second, 'completed');
chooseStatus(second, 'incomplete');
assert.equal(second.data.canConfirmCorrection, false); // 不复用上次未完成原因。
second.cancelCorrection();
assert.equal(snapshot(), beforeDiscard);

for (const id of [3, 4, 999, 'invalid', undefined]) {
  const invalid = mount('record', id);
  assert.equal(invalid.data.canCorrect, false);
  invalid.startCorrection();
  chooseStatus(invalid, 'incomplete');
  chooseReason(invalid, '加班');
  invalid.confirmCorrection();
  assert.equal(invalid.data.correcting, false);
  assert.equal(snapshot(), beforeDiscard); // 修正不能绕过首次录入或取消状态。
}
const stale = mount('record', 2);
stale.startCorrection();
chooseStatus(stale, 'completed');
app.globalData.plans[1].cancelled = true;
stale.confirmCorrection();
assert.equal(app.globalData.plans[1].result.status, 'incomplete');
delete app.globalData.plans[1].cancelled;
assert.equal(JSON.stringify(planFields()), originalFields); // ID、日期、项目、时间、数量不变。

today.onShow();
week.onShow();
assert.equal(today.data.activities.find(item => item.id === 1).result.status, 'completed');
assert.equal(today.data.activities.find(item => item.id === 1).result.reason, undefined);
assert.equal(week.data.days.flatMap(day => day.plans).find(item => item.id === 1).result.reason, undefined);
console.log('PASS: reason required, draft isolation, correction both ways, clear old reason, discard/back, stable plan fields/count, other-plan isolation, repeat confirmation, invalid/cancelled guards, list refresh');
