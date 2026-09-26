(async () => {
const { createTestApp, prepareTestApp } = require('./helpers/runtime');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

async function mount(app, planId) {
  const file = path.resolve(__dirname, '../miniprogram/pages/record/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), getApp: () => prepareTestApp(app), Page(value) { definition = value; },
    wx: { showToast() {}, pageScrollTo() {}, showToast() {} }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value); }
  });
  (await page.onLoad({ planId }));
  (await page.onShow());
  return page;
}
function input(page, field, value) {
  page.inputRunningData({ currentTarget: { dataset: { field } }, detail: { value } });
}

const app = { globalData: { plans: [
  { id: 1, activity: '跑步', date: '2026-09-26', startTime: '19:00' },
  { id: 2, activity: '跑步', date: '2026-09-26', startTime: '07:00', beforeMood: 'low', result: {
    status: 'completed', feeling: '适中', afterMood: 'good', afterMoodNote: '跑完心情不错',
    runningData: { durationMinutes: '30', distanceKm: '5', heartRate: '135' }
  } },
  { id: 3, activity: '瑜伽', date: '2026-09-26', startTime: '09:00', result: { status: 'completed' } },
  { id: 4, activity: '跑步', date: '2026-09-26', startTime: '10:00', result: { status: 'incomplete', reason: '下雨' } }
] } };
const snapshot = () => JSON.stringify(app.globalData.plans);
const original = snapshot();
const page = (await mount(app, 1));
assert.equal(page.data.runningPace, '');
input(page, 'durationMinutes', '30');
assert.equal(page.data.runningPace, '');
input(page, 'distanceKm', '5');
assert.equal(page.data.runningPace, '6′00″/公里');
input(page, 'durationMinutes', '35');
assert.equal(page.data.runningPace, '7′00″/公里');
input(page, 'distanceKm', '7');
assert.equal(page.data.runningPace, '5′00″/公里');
for (const value of ['', '0', '-2', 'abc']) {
  input(page, 'distanceKm', value);
  assert.equal(page.data.runningPace, '');
}
input(page, 'distanceKm', '5');
assert.equal(page.data.runningPace, '7′00″/公里');
input(page, 'durationMinutes', '');
assert.equal(page.data.runningPace, '');
input(page, 'durationMinutes', '30');
input(page, 'heartRate', '145');
assert.equal(page.data.runningPace, '6′00″/公里');
input(page, 'durationMinutes', ' 30 ');
input(page, 'distanceKm', ' 5 ');
assert.equal(page.data.runningPace, '6′00″/公里');
assert.equal(snapshot(), original); // 配速预览不写入计划或结果。

(await page.confirmCompleted());
assert.equal((await mount(app, 1)).data.runningPace, '6′00″/公里');
const completed = (await mount(app, 2));
assert.equal(completed.data.runningPace, '6′00″/公里');
input(completed, 'distanceKm', '4');
assert.equal(completed.data.runningPace, '7′30″/公里');
(await completed.confirmRunningData());
assert.equal((await mount(app, 2)).data.runningPace, '7′30″/公里');
assert.equal((await mount(app, 1)).data.runningPace, '6′00″/公里');
assert.equal(app.globalData.plans[1].beforeMood, 'low');
assert.equal(app.globalData.plans[1].result.feeling, '适中');
assert.equal(app.globalData.plans[1].result.afterMood, 'good');
assert.equal(app.globalData.plans[1].result.afterMoodNote, '跑完心情不错');
assert.equal(app.globalData.plans[1].result.status, 'completed');
assert.equal(app.globalData.plans.length, 4);

input(completed, 'distanceKm', '0');
assert.equal(completed.data.runningPace, '');
(await completed.confirmRunningData());
assert.equal((await mount(app, 2)).data.runningPace, '');
const beforePreview = snapshot();
input(completed, 'distanceKm', '10');
assert.equal(completed.data.runningPace, '3′00″/公里');
assert.equal((await mount(app, 2)).data.runningPace, ''); // 未确认的输入不改变重开后的数据。
assert.equal(snapshot(), beforePreview);

for (const id of [3, 4, 999]) assert.equal((await mount(app, id)).data.runningPace, '');
app.globalData.plans[0].cancelled = true;
(await page.onShow());
assert.equal(page.data.runningPace, '');
assert.equal(snapshot().includes('runningPace'), false); // 始终从时长和距离派生，不存第二份配速。

console.log('PASS: record pace input/recalculation, missing/zero/invalid clearing, confirmed-data reload, plan/mood/feeling isolation and no stored pace');

})().catch(error => { console.error(error); process.exitCode = 1; });
