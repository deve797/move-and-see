const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

let now = '2026-09-26T04:00:00Z';
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
}
const plain = value => JSON.parse(JSON.stringify(value));
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
const plan = (id, change = {}) => ({ id, date: '2026-09-26', activity: '跑步', startTime: '09:00', ...change });
function runtime() {
  let app;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../miniprogram/app.js'), 'utf8'), { App(value) { app = value; } });
  return app;
}
function mount(name, app, query = {}) {
  const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  let definition;
  const scrolls = [];
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Date: FixedDate, getApp: () => app,
    getCurrentPages: () => [{}, {}], Page(value) { definition = value; },
    wx: { pageScrollTo(value) { scrolls.push(value); }, showToast() {}, navigateBack() {}, reLaunch() {} }
  });
  const page = Object.assign({}, definition, {
    data: plain(definition.data), scrolls,
    setData(value, callback) { Object.assign(this.data, value); if (callback) callback(); }
  });
  if (page.onLoad) page.onLoad(query);
  if (page.onShow) page.onShow();
  return page;
}
function refresh(page, app) {
  const snapshot = JSON.stringify(app.globalData);
  const references = app.globalData.plans.map(item => [item, item.result, item.result && item.result.makeup]);
  page.onShow();
  assert.equal(JSON.stringify(app.globalData), snapshot, '回看只读，不修改备注、计划或数组顺序');
  references.forEach(([item, result, makeup], index) => {
    assert.equal(app.globalData.plans[index], item);
    assert.equal(item.result, result);
    assert.equal(item.result && item.result.makeup, makeup);
  });
  return plain(page.data.moodNotes);
}
function beforeNote(app, id, note) {
  const today = mount('today', app);
  today.openBeforeMood(event('id', id));
  today.inputBeforeMoodNote({ detail: { value: note } });
  today.confirmBeforeMood();
}
function afterNote(app, id, note, makeup = false) {
  const mood = mount('mood', app, { planId: id, makeup: makeup ? '1' : '0' });
  mood.inputNote({ detail: { value: note } });
  mood.confirmMood();
}

const app = runtime();
const review = mount('review', app);
assert.deepEqual(refresh(review, app), []);
assert.equal(review.data.moodNotesExpanded, false);
app.globalData.plans.push(plan(1), plan(2, { activity: '瑜伽', startTime: '08:00' }), plan(3, { result: { status: 'completed' } }));
const originalWords = '  今天有点累。\n先慢慢来🙂 <不用评价> & “原话”  ';
beforeNote(app, 1, originalWords);
mount('record', app, { planId: 1 }).confirmCompleted();
afterNote(app, 1, '  完成后仍然累。\n明天再说。  ');
beforeNote(app, 2, '只写运动前，还没有结果');
afterNote(app, 3, '只写运动后');
let notes = refresh(review, app);
assert.deepEqual(notes.map(item => item.id), ['2-plan', '1-plan', '3-plan']);
assert.deepEqual(notes[1], {
  id: '1-plan', date: '2026-09-26', startTime: '09:00', activity: '跑步', context: '原计划 · 09:00',
  before: originalWords, after: '  完成后仍然累。\n明天再说。  '
});
assert.equal(notes[0].after, '');
assert.equal(notes[2].before, '');
assert.equal(app.globalData.plans[0].beforeMood, ''); // 没有选择心情也可回看备注。
beforeNote(app, 1, '修改后的前备注');
afterNote(app, 1, '');
notes = refresh(review, app);
assert.equal(notes.find(item => item.id === '1-plan').before, '修改后的前备注');
assert.equal(notes.find(item => item.id === '1-plan').after, '');
beforeNote(app, 1, '');
assert.equal(refresh(review, app).some(item => item.id === '1-plan'), false);
afterNote(app, 1, '完成后才写的备注');
const correction = mount('record', app, { planId: 1 });
correction.startCorrection();
correction.selectCorrectionStatus(event('status', 'incomplete'));
correction.selectCorrectionReason(event('reason', '下雨'));
correction.confirmCorrection();
assert.equal(refresh(review, app).some(item => item.id === '1-plan'), false, '修正未完成后不保留旧完成备注');

app.globalData.plans.push(plan(4, { beforeMoodNote: '原计划跑步前', result: { status: 'incomplete', reason: '下雨', afterMoodNote: '无实际运动的残留值' } }));
const makeup = mount('record', app, { planId: 4 });
makeup.startMakeup();
makeup.selectMakeupDate({ detail: { value: '2026-09-26' } });
makeup.selectMakeupActivity({ detail: { value: '5' } });
makeup.confirmMakeup();
afterNote(app, 4, '实际补做散步后', true);
notes = refresh(review, app);
assert.equal(notes.find(item => item.id === '4-plan').before, '原计划跑步前');
assert.equal(notes.find(item => item.id === '4-plan').after, '');
assert.deepEqual(notes.find(item => item.id === '4-motion'), {
  id: '4-motion', date: '2026-09-26', startTime: '', activity: '散步', context: '补做 · 原计划 2026-09-26 09:00 跑步', before: '', after: '实际补做散步后'
});
review.toggleMoodNotes();
assert.equal(review.data.moodNotesExpanded, true);
refresh(review, app);
assert.equal(review.data.moodNotesExpanded, true);
review.collapseMoodNotes();
assert.equal(review.data.moodNotesExpanded, false);
assert.deepEqual(plain(review.scrolls.at(-1)), { selector: '#mood-summary', duration: 0 });
review.toggleMoodNotes();
review.toggleMoodNotes();
assert.equal(review.data.moodNotesExpanded, false);

const boundaryApp = runtime();
boundaryApp.globalData.plans = [
  plan(9, { date: '2026-09-27', beforeMoodNote: '原周运动前', result: { status: 'incomplete', makeup: { date: '2026-09-28', actualActivity: '散步', afterMoodNote: '跨周补做后' } } }),
  plan(8, { date: '2026-09-21', beforeMoodNote: '原计划前', result: { status: 'replacement', actualActivity: '网球', beforeMoodNote: '实际网球前', afterMoodNote: '实际网球后' } }),
  plan(7, { cancelled: true, beforeMoodNote: '取消的计划' }),
  plan(6, { date: '2026-09-20', result: { status: 'incomplete', makeup: { date: '2026-09-21', actualActivity: '瑜伽', afterMoodNote: '归上周' } } }),
  plan(5, { date: '2026-09-28', beforeMoodNote: '下周的计划' }),
  plan(4, { beforeMoodNote: ' \n  ' }),
  plan(3, { beforeMood: 'good', result: { status: 'completed', afterMood: 'great' } }),
  plan(2, { result: { status: 'incomplete', afterMoodNote: '不能视作运动后' } })
];
boundaryApp.globalData.periodDays = { '2026-09-21': true, '2026-09-26': true };
boundaryApp.globalData.periodWalks = { '2026-09-26': { status: 'completed' } };
const boundary = mount('review', boundaryApp);
notes = refresh(boundary, boundaryApp);
assert.deepEqual(notes.map(item => item.id), ['8-motion', '8-plan', '4-plan', '9-plan', '9-motion']);
assert.equal(notes[0].activity, '网球');
assert.equal(notes[0].context, '替代完成 · 原计划 2026-09-21 09:00 跑步');
assert.equal(notes[0].before, '实际网球前');
assert.equal(notes[0].after, '实际网球后');
assert.equal(notes[1].before, '原计划前');
assert.equal(notes[1].after, '');
assert.equal(notes[2].before, ' \n  ');
assert.equal(notes[4].date, '2026-09-28');
assert.equal(notes[4].before, '');
now = '2026-09-27T15:59:59Z';
assert.deepEqual(refresh(boundary, boundaryApp), notes);
now = '2026-09-27T16:00:00Z';
assert.deepEqual(refresh(boundary, boundaryApp).map(item => item.id), ['5-plan'], '北京时间换周，补做不搬移或重复计入');
const restartedApp = runtime();
assert.deepEqual(refresh(mount('review', restartedApp), restartedApp), []);

const template = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/review/index.wxml'), 'utf8');
assert.match(template, /wx:if="\{\{!moodNotes.length\}\}"/);
assert.match(template, /wx:if="\{\{item.before\}\}"/);
assert.match(template, /wx:if="\{\{item.after\}\}"/);
assert.doesNotMatch(template, /moodTextSummary|文字总结示例|示例原话/);
console.log('PASS: confirmed note flows, exact original text, one-sided notes, update/clear/correction and expansion');
console.log('PASS: original/replacement/makeup ownership, actual dates, read-only refresh, empty state and Beijing week scope');
