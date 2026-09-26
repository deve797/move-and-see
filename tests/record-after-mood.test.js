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
function runtime() { return createTestApp(); }
async function mount(name, app, planId, stackLength = 2) {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  const navigation = [];
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => prepareTestApp(app),
    getCurrentPages: () => Array.from({ length: stackLength }, () => ({})),
    Page(value) { definition = value; },
    wx: {
      pageScrollTo() {}, showToast() {},
      navigateBack() { navigation.push({ type: 'back' }); },
      reLaunch(options) { navigation.push({ type: 'reLaunch', url: options.url }); }
    }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)), navigation,
    setData(value) { Object.assign(this.data, value); }
  });
  if (page.onLoad) (await page.onLoad({ planId }));
  if (page.onShow) (await page.onShow());
  return page;
}
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
const choose = (page, value) => page.selectMood(event('value', value));
const input = (page, value) => page.inputNote({ detail: { value } });
const app = runtime();
app.globalData.plans.push(
  { id: 1, date: '2026-09-26', activity: '跑步', startTime: '19:00', beforeMood: 'low', beforeMoodNote: '运动前的备注', result: { status: 'completed' } },
  { id: 2, date: '2026-09-26', activity: '跑步', startTime: '07:00', result: { status: 'completed' } },
  { id: 3, date: '2026-09-26', activity: '瑜伽', startTime: '09:00' },
  { id: 4, date: '2026-09-26', activity: '散步', startTime: '20:00', result: { status: 'incomplete', reason: '下雨' } },
  { id: 5, date: '2026-09-26', activity: '散步', startTime: '21:00', cancelled: true, result: { status: 'completed' } }
);
const snapshot = () => JSON.stringify(app.globalData.plans);
const stableFields = () => JSON.stringify(app.globalData.plans.map(plan => ({
  ...plan, version: undefined, result: plan.result ? { status: plan.result.status, reason: plan.result.reason } : undefined
})));
const originalFields = stableFields();
const original = snapshot();
let firstResult = app.globalData.plans[0].result;
const mood = (await mount('mood', app, '1'));
assert.equal(mood.data.plan.id, 1);
assert.equal(mood.data.plan.activity, '跑步');
assert.equal(mood.data.plan.date, '2026-09-26');
assert.equal(mood.data.plan.startTime, '19:00');
assert.equal(mood.data.selectedMood, '');
assert.equal(mood.data.note, '');
choose(mood, 'good');
const note = '  跑完吹了风，清爽些。\n慢慢走回去。  ';
input(mood, note);
assert.equal(snapshot(), original); // 编辑只是草稿，不能写入结果。
(await mood.confirmMood());
assert.notEqual(app.globalData.plans[0].result, firstResult); // 云端成功后以新快照替换缓存。
assert.equal(firstResult.afterMood, undefined);
firstResult = app.globalData.plans[0].result;
assert.equal(firstResult.status, 'completed');
assert.equal(firstResult.afterMood, 'good');
assert.equal(firstResult.afterMoodNote, note);
assert.equal(mood.navigation.at(-1).type, 'back');
assert.equal(app.globalData.plans[1].result.afterMood, undefined);
assert.equal(stableFields(), originalFields); // 原计划、前感受、结果状态及数量不变。

(await mount('week', app));
const today = (await mount('today', app));
assert.equal(today.data.activities[0].id, 2); // 同名运动的页面顺序与共享数组不同。
today.openBeforeMood(event('id', 1));
assert.equal(today.data.selectedBeforeMood, 'low');
assert.equal(today.data.beforeMoodNote, '运动前的备注');
today.selectBeforeMood(event('value', 'down'));
today.inputBeforeMoodNote({ detail: { value: '修改运动前备注' } });
(await today.confirmBeforeMood());
assert.equal(firstResult.afterMood, 'good');
assert.equal(firstResult.afterMoodNote, note);
today.afterMoodLeave();

const reopened = (await mount('mood', app, 1));
assert.equal(reopened.data.selectedMood, 'good');
assert.equal(reopened.data.note, note);
const saved = snapshot();
choose(reopened, 'invalid');
assert.equal(reopened.data.selectedMood, 'good');
choose(reopened, 'low');
input(reopened, '跳过时不确认的修改');
reopened.goBack();
assert.equal(snapshot(), saved);
assert.equal(reopened.navigation.at(-1).type, 'back');
const afterBack = (await mount('mood', app, 1));
assert.equal(afterBack.data.selectedMood, 'good');
assert.equal(afterBack.data.note, note);
choose(afterBack, 'down');
input(afterBack, '原生返回不提交');
afterBack.onUnload && afterBack.onUnload();
assert.equal(snapshot(), saved);
assert.equal((await mount('mood', app, 1)).data.note, note);

let second = (await mount('mood', app, 2));
assert.equal(second.data.selectedMood, '');
assert.equal(second.data.note, '');
second.goBack();
assert.equal(snapshot(), saved); // 全部跳过不影响已完成结果。
second = (await mount('mood', app, 2));
(await second.confirmMood());
assert.equal(app.globalData.plans[1].result.status, 'completed');
assert.equal(app.globalData.plans[1].result.afterMood, '');
assert.equal(app.globalData.plans[1].result.afterMoodNote, '');
second = (await mount('mood', app, 2));
input(second, '只写备注');
(await second.confirmMood());
assert.equal((await mount('mood', app, 2)).data.note, '只写备注');
assert.equal((await mount('mood', app, 2)).data.selectedMood, '');
second = (await mount('mood', app, 2));
choose(second, 'great');
input(second, '');
(await second.confirmMood());
assert.equal((await mount('mood', app, 2)).data.selectedMood, 'great');
assert.equal((await mount('mood', app, 2)).data.note, '');
assert.equal(firstResult.afterMood, 'good');
assert.equal(firstResult.afterMoodNote, note);
const secondSaved = snapshot();
(await second.confirmMood());
(await second.confirmMood());
assert.equal(snapshot(), secondSaved);
assert.equal(second.navigation.length, 1); // 快速连点确认只返回一页。

for (const id of [3, 4, 5, 999, 'invalid', undefined]) {
  const invalid = (await mount('mood', app, id));
  assert.equal(invalid.data.plan, null);
  choose(invalid, 'good');
  input(invalid, '无效目标不能写入');
  (await invalid.confirmMood());
  assert.equal(snapshot(), secondSaved);
}
const cancelled = (await mount('mood', app, 2));
choose(cancelled, 'low');
app.globalData.plans[1].version += 1;
app.globalData.plans[1].cancelled = true;
(await cancelled.confirmMood());
assert.match(cancelled.data.saveError, /更新|刷新/);
(await cancelled.onShow());
assert.equal(cancelled.data.plan, null);
delete app.globalData.plans[1].cancelled;
assert.equal(app.globalData.plans[1].result.afterMood, 'great');

const record = (await mount('record', app, 1));
record.startCorrection();
(await record.confirmCorrection());
assert.deepEqual(app.globalData.plans[0].result, firstResult); // 同状态确认保留本次运动的感受。
assert.equal(app.globalData.plans[0].result.afterMood, 'good');
const stale = (await mount('mood', app, 1));
choose(stale, 'low');
input(stale, '旧结果页面的草稿');
record.startCorrection();
record.selectCorrectionStatus(event('status', 'incomplete'));
record.selectCorrectionReason(event('reason', '加班'));
(await record.confirmCorrection());
const incompleteSaved = snapshot();
(await stale.confirmMood());
assert.match(stale.data.saveError, /更新|刷新/);
(await stale.onShow());
assert.equal(stale.data.plan, null);
assert.equal(snapshot(), incompleteSaved);
assert.equal(app.globalData.plans[0].result.afterMood, undefined);
record.startCorrection();
record.selectCorrectionStatus(event('status', 'completed'));
(await record.confirmCorrection());
const current = (await mount('mood', app, 1));
assert.equal(current.data.selectedMood, '');
assert.equal(current.data.note, '');
const replacement = { status: 'completed', afterMood: 'great', afterMoodNote: '新的结果' };
app.globalData.plans[0].version += 1;
app.globalData.plans[0].result = replacement;
choose(current, 'down');
input(current, '不能覆盖新结果');
const replacementSaved = snapshot();
(await current.confirmMood());
assert.equal(snapshot(), replacementSaved); // 即使新结果也是完成，也不能接收旧结果草稿。
assert.match(current.data.saveError, /更新|刷新/);
assert.equal(current.data.note, '不能覆盖新结果'); // 冲突保留用户填写。
(await current.onShow());
assert.equal(current.data.selectedMood, 'great');
assert.equal(current.data.note, '新的结果');
assert.equal(app.globalData.plans[0].beforeMood, 'down');
assert.equal(app.globalData.plans[0].beforeMoodNote, '修改运动前备注');

const direct = (await mount('mood', app, 2, 1));
direct.goBack();
assert.deepEqual(direct.navigation, [{ type: 'reLaunch', url: '/pages/today/index' }]);
assert.equal(snapshot(), replacementSaved);
assert.equal((await mount('mood', runtime(), 1)).data.plan, null); // 独立测试 fixture 不共享状态。
console.log('PASS: completed-result after mood/note, plan ID and before-mood isolation, navigation/recreated page, optional/skip/discard, same-status correction, invalid/cancelled/stale result guards, fallback and isolated async fixtures');

})().catch(error => { console.error(error); process.exitCode = 1; });
