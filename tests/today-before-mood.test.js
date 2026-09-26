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
async function mount(name, app, planId) {
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
  if (page.onLoad) (await page.onLoad({ planId }));
  if (page.onShow) (await page.onShow());
  return page;
}
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
const open = (page, id) => page.openBeforeMood(event('id', id));
const choose = (page, value) => page.selectBeforeMood(event('value', value));
const input = (page, value) => page.inputBeforeMoodNote({ detail: { value } });
const app = runtime();
app.globalData.plans.push(
  { id: 1, date: '2026-09-26', activity: '跑步', startTime: '19:00' },
  { id: 2, date: '2026-09-26', activity: '跑步', startTime: '07:00', result: { status: 'completed' } },
  { id: 3, date: '2026-09-27', activity: '瑜伽', startTime: '09:00' },
  { id: 4, date: '2026-09-26', activity: '散步', startTime: '20:00', cancelled: true }
);
const snapshot = () => JSON.stringify(app.globalData.plans);
const activity = (page, id) => page.data.activities.find(item => item.id === id);
const baseFields = () => JSON.stringify(app.globalData.plans.map(({ beforeMood, beforeMoodNote, version, ...plan }) => plan));
const originalFields = baseFields();
const original = snapshot();
const today = (await mount('today', app));
assert.equal(activity(today, 1).beforeMood, '');
assert.equal(activity(today, 1).beforeMoodNote, '');
assert.equal(today.data.activities[0].id, 2); // 页面排序与共享数组顺序不同。
open(today, 1);
assert.equal(today.data.moodSheetOpen, true);
assert.equal(today.data.moodActivityTime, '19:00');
choose(today, 'good');
const note = '  有点累，想出去走走。\n慢慢开始。  ';
input(today, note);
assert.equal(snapshot(), original); // 选择与输入只是草稿。
(await today.confirmBeforeMood());
assert.equal(app.globalData.plans[0].beforeMood, 'good');
assert.equal(app.globalData.plans[0].beforeMoodNote, note);
assert.equal(activity(today, 1).beforeMoodLabel, '不错');
assert.equal(activity(today, 1).beforeMoodNote, note);
assert.equal(activity(today, 2).beforeMood, '');
const saved = snapshot();
(await today.confirmBeforeMood());
assert.equal(snapshot(), saved);
today.afterMoodLeave();

(await mount('week', app)); // 离开后返回同一实例，再重新创建今天页。
(await today.onShow());
assert.equal(activity(today, 1).beforeMoodLabel, '不错');
const reopened = (await mount('today', app));
open(reopened, 1);
assert.equal(reopened.data.selectedBeforeMood, 'good');
assert.equal(reopened.data.beforeMoodNote, note);
choose(reopened, 'low');
input(reopened, '未确认的修改');
reopened.closeBeforeMood();
(await reopened.confirmBeforeMood());
reopened.afterMoodLeave();
assert.equal(snapshot(), saved);
open(reopened, 1);
assert.equal(reopened.data.selectedBeforeMood, 'good');
assert.equal(reopened.data.beforeMoodNote, note);
choose(reopened, 'down');
input(reopened, '离页放弃');
(await reopened.onShow());
assert.equal(snapshot(), saved);
assert.equal(reopened.data.moodSheetOpen, false);
open(reopened, 1);
choose(reopened, 'low');
reopened.afterMoodLeave(); // 原生返回收起也不提交。
assert.equal(snapshot(), saved);

open(reopened, 2);
assert.equal(reopened.data.selectedBeforeMood, '');
assert.equal(reopened.data.beforeMoodNote, '');
input(reopened, '只写备注');
(await reopened.confirmBeforeMood());
reopened.afterMoodLeave();
assert.equal(app.globalData.plans[1].beforeMood, '');
assert.equal(app.globalData.plans[1].beforeMoodNote, '只写备注');
assert.equal(app.globalData.plans[0].beforeMoodNote, note);
open(reopened, 2);
choose(reopened, 'great');
input(reopened, '');
(await reopened.confirmBeforeMood());
reopened.afterMoodLeave();
assert.equal(app.globalData.plans[1].beforeMood, 'great');
assert.equal(app.globalData.plans[1].beforeMoodNote, '');
open(reopened, 1);
input(reopened, '');
(await reopened.confirmBeforeMood());
reopened.afterMoodLeave();
assert.equal(app.globalData.plans[0].beforeMood, 'good');
assert.equal(app.globalData.plans[0].beforeMoodNote, '');
assert.equal(app.globalData.plans[1].beforeMood, 'great');
assert.equal(baseFields(), originalFields); // 感受不改变原计划、结果和数量。

const emptyApp = runtime();
emptyApp.globalData.plans.push({ id: 1, date: '2026-09-26', activity: '跑步', startTime: '19:00' });
const blank = (await mount('today', emptyApp));
open(blank, 1);
(await blank.confirmBeforeMood());
assert.equal(blank.data.moodSheetOpen, false);
assert.equal(emptyApp.globalData.plans[0].beforeMood, '');
assert.equal(emptyApp.globalData.plans[0].beforeMoodNote, '');
assert.equal(emptyApp.globalData.plans[0].result, undefined);

const protectedState = snapshot();
for (const id of [3, 4, 999, 'invalid', undefined]) {
  open(reopened, id);
  assert.equal(reopened.data.moodSheetOpen, false);
  (await reopened.confirmBeforeMood());
  assert.equal(snapshot(), protectedState);
}
open(reopened, 1);
choose(reopened, 'invalid');
assert.equal(reopened.data.selectedBeforeMood, 'good');
choose(reopened, 'low');
app.globalData.plans[0].version += 1;
app.globalData.plans[0].cancelled = true;
(await reopened.confirmBeforeMood());
delete app.globalData.plans[0].cancelled;
assert.deepEqual(JSON.parse(snapshot()).map(({ version, ...plan }) => plan), JSON.parse(protectedState).map(({ version, ...plan }) => plan)); // 冲突不能覆盖已取消的计划。
assert.match(reopened.data.saveError, /更新|刷新/);

const record = (await mount('record', app, 1));
(await record.confirmCompleted());
record.startCorrection();
record.selectCorrectionStatus(event('status', 'incomplete'));
record.selectCorrectionReason(event('reason', '下雨'));
(await record.confirmCorrection());
assert.equal(app.globalData.plans[0].result.reason, '下雨');
assert.equal(app.globalData.plans[0].beforeMood, 'good');
(await reopened.onShow());
assert.equal(activity(reopened, 1).beforeMoodLabel, '不错');
assert.equal(activity(reopened, 2).beforeMoodLabel, '很好');
assert.equal((await mount('today', runtime())).data.activities.length, 0);
console.log('PASS: per-plan before mood/note, sorted same-name isolation, navigation/recreated page, optional fields, discard/native close, repeat confirmation, stable plans/results, cancelled guards, result correction, isolated async fixtures');

})().catch(error => { console.error(error); process.exitCode = 1; });
