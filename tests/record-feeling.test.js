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

async function mount(name, app, planId) {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => prepareTestApp(app),
    getCurrentPages: () => [{}, {}],
    Page(value) { definition = value; },
    wx: { showToast() {}, pageScrollTo() {}, navigateBack() {} }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value); }
  });
  (await page.onLoad({ planId }));
  (await page.onShow());
  return page;
}
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
const choose = async (page, value) => (await page.selectFeeling(event('feeling', value)));
const app = { globalData: { plans: [
  { id: 1, date: '2026-09-26', activity: '跑步', startTime: '19:00', beforeMood: 'low', beforeMoodNote: '运动前有点累。', result: { status: 'completed', afterMood: 'good', afterMoodNote: '跑完清爽些。' } },
  { id: 2, date: '2026-09-26', activity: '跑步', startTime: '07:00', result: { status: 'completed' } },
  { id: 3, date: '2026-09-26', activity: '瑜伽', startTime: '09:00' },
  { id: 4, date: '2026-09-26', activity: '散步', startTime: '20:00', result: { status: 'incomplete', reason: '下雨' } },
  { id: 5, date: '2026-09-26', activity: '散步', startTime: '21:00', cancelled: true, result: { status: 'completed' } }
] } };
const snapshot = () => JSON.stringify(app.globalData.plans, (key, value) => key === 'version' ? undefined : value);
const withoutFeeling = () => JSON.stringify(app.globalData.plans.map(plan => {
  if (!plan.result) return plan;
  const { feeling, ...result } = plan.result;
  return { ...plan, version: undefined, result };
}));
const originalFields = withoutFeeling();
const currentResult = () => app.globalData.plans[0].result;
const record = (await mount('record', app, '1'));
assert.equal(record.data.selectedFeeling, '');
assert.equal(currentResult().feeling, undefined); // 不填不写默认值，也不影响完成。
for (const value of ['轻松', '适中', '吃力']) {
  (await choose(record, value));
  assert.equal(record.data.selectedFeeling, value);
  assert.equal(currentResult().feeling, value);
  assert.equal(currentResult().status, 'completed');
  assert.equal((await mount('record', app, 1)).data.selectedFeeling, value);
  assert.equal(withoutFeeling(), originalFields);
  assert.equal(app.globalData.plans[1].result.feeling, undefined);
}
const saved = snapshot();
(await choose(record, 'invalid'));
(await choose(record, undefined));
assert.equal(snapshot(), saved);
(await choose(record, '吃力'));
assert.equal(currentResult().feeling, '吃力'); // 重复点击没有第二个结果。
(await choose(record, ''));
assert.equal(currentResult().feeling, '');
assert.equal((await mount('record', app, 1)).data.selectedFeeling, '');
assert.equal(withoutFeeling(), originalFields);

const second = (await mount('record', app, 2));
assert.equal(second.data.selectedFeeling, '');
(await second.onShow());
assert.equal(app.globalData.plans[1].result.feeling, undefined); // 跳过保持空值。
(await choose(second, '轻松'));
assert.equal(currentResult().feeling, '');
assert.equal((await mount('record', app, 2)).data.selectedFeeling, '轻松');
(await choose(record, '适中'));
const mood = (await mount('mood', app, 1));
mood.selectMood(event('value', 'great'));
mood.inputNote({ detail: { value: '更新运动后心情。' } });
(await mood.confirmMood());
assert.equal(currentResult().feeling, '适中');
assert.equal(currentResult().afterMood, 'great');
assert.equal(currentResult().afterMoodNote, '更新运动后心情。');
const moodUpdatedFields = withoutFeeling();
(await record.onShow());
(await choose(record, '轻松'));
assert.equal(withoutFeeling(), moodUpdatedFields); // 双向修改互不覆盖。

record.startCorrection();
const beforeCorrection = snapshot();
(await choose(record, '吃力'));
assert.equal(snapshot(), beforeCorrection); // 修正期间隐藏体感，不能改写。
record.cancelCorrection();
assert.equal(record.data.selectedFeeling, '轻松');
record.startCorrection();
(await record.confirmCorrection());
assert.equal(snapshot(), beforeCorrection); // 同状态确认保留体感。
record.startCorrection();
record.selectCorrectionStatus(event('status', 'incomplete'));
record.selectCorrectionReason(event('reason', '加班'));
(await record.confirmCorrection());
assert.equal(app.globalData.plans[0].result.feeling, undefined);
assert.equal(record.data.selectedFeeling, '');
(await choose(record, '吃力'));
assert.equal(app.globalData.plans[0].result.feeling, undefined);
record.startCorrection();
record.selectCorrectionStatus(event('status', 'completed'));
(await record.confirmCorrection());
assert.equal((await mount('record', app, 1)).data.selectedFeeling, '');
assert.equal(app.globalData.plans[0].beforeMood, 'low');
assert.equal(app.globalData.plans[0].beforeMoodNote, '运动前有点累。');

const current = snapshot();
for (const id of [3, 4, 5, 999, 'invalid', undefined]) {
  const invalid = (await mount('record', app, id));
  (await choose(invalid, '轻松'));
  (await choose(invalid, ''));
  assert.equal(snapshot(), current);
}
let stale = (await mount('record', app, 2));
app.globalData.plans[1].version += 1;
app.globalData.plans[1].result = { status: 'completed', feeling: '吃力' };
const replacement = snapshot();
(await choose(stale, '适中'));
assert.equal(snapshot(), replacement);
assert.match(stale.data.saveError, /更新|刷新/);
(await stale.onShow());
assert.equal(stale.data.saveConflict, true);
stale = (await mount('record', app, 2)); // 退出重进读取最新结果。
assert.equal(stale.data.selectedFeeling, '吃力');
app.globalData.plans[1].version += 1;
app.globalData.plans[1].cancelled = true;
const cancelled = snapshot();
(await choose(stale, ''));
assert.equal(snapshot(), cancelled);
(await stale.onShow());
assert.equal(stale.data.saveConflict, true);
stale = (await mount('record', app, 2));
assert.equal(stale.data.plan, null);
assert.equal(stale.data.selectedFeeling, '');
console.log('PASS: optional feeling, exclusive choices/reopen/edit/clear, plan/result/mood isolation, same-name plans, correction lifecycle and invalid/cancelled/stale result guards');

})().catch(error => { console.error(error); process.exitCode = 1; });
