const test = require('node:test');
const assert = require('node:assert/strict');
const createStore = require('../miniprogram/utils/cloud-store');

function state() {
  return { plans: [], periodDays: {}, periodWalks: {}, dayVersions: {}, cloudLoaded: false };
}
function setup(handler) {
  const data = state();
  const calls = [];
  const store = createStore({ async callFunction(request) {
    calls.push(request);
    return { result: await handler(request.data, calls.length) };
  } }, data, 'verified-env');
  return { store, data, calls };
}
const ok = data => ({ ok: true, data });
const emptyPage = () => ok({ items: [], nextCursor: '' });

test('loading reads every page and reconstructs day flags without losing hidden walks', async () => {
  const { store, data, calls } = setup(request => {
    if (request.collection === 'plans') return ok(request.cursor
      ? { items: [{ id: 'second', version: 2 }], nextCursor: '' }
      : { items: [{ id: 'first', version: 1 }], nextCursor: 'cursor-1' });
    return ok({ items: [
      { date: '2026-09-26', periodMarked: true, version: 2 },
      { date: '2026-09-25', periodMarked: false, periodWalk: { status: 'completed' }, version: 3 }
    ], nextCursor: '' });
  });
  const originalArray = data.plans;
  await store.loadData();
  assert.equal(data.plans, originalArray);
  assert.deepEqual(data.plans.map(plan => plan.id), ['first', 'second']);
  assert.deepEqual(data.periodDays, { '2026-09-26': true });
  assert.deepEqual(store.getDay('2026-09-25'), {
    date: '2026-09-25', periodMarked: false, periodWalk: { status: 'completed' }, version: 3
  });
  assert.equal(data.cloudLoaded, true);
  assert.ok(calls.every(call => call.config.env === 'verified-env' && call.name === 'moveSeeApi'));
});

test('a partial read failure leaves the previous successful snapshot intact', async () => {
  const { store, data } = setup(request => {
    if (request.collection === 'plans') return ok({ items: [{ id: 'new' }], nextCursor: '' });
    throw new Error('offline');
  });
  data.plans.push({ id: 'old' });
  data.periodDays['2026-09-26'] = true;
  await assert.rejects(store.loadData(), /网络/);
  assert.deepEqual(data.plans, [{ id: 'old' }]);
  assert.equal(data.periodDays['2026-09-26'], true);
  assert.equal(data.cloudLoaded, false);
  assert.equal(data.cloudLoading, false);
  assert.match(data.cloudError, /网络/);
});

test('overlapping loads share one read and a later failure can be retried', async () => {
  let first = true;
  const { store, calls } = setup(() => {
    if (first) { first = false; throw new Error('offline'); }
    return emptyPage();
  });
  const a = store.loadData();
  const b = store.loadData();
  assert.equal(a, b);
  await assert.rejects(a);
  await store.loadData();
  assert.equal(calls.length, 3);
});

test('saving never changes cached records before cloud success and retains the day version snapshot', async () => {
  let accept;
  const { store, data, calls } = setup(request => request.action === 'list' ? emptyPage() : new Promise(resolve => { accept = () => resolve(ok({ ...request.plan, version: 2 })); }));
  await store.loadData();
  const old = { id: 'p-one', date: '2026-09-26', version: 1 };
  data.plans.push(old);
  data.dayVersions[old.date] = 5;
  const draft = { ...old, beforeMood: 'good', _dayVersion: 4 };
  const saving = store.savePlan(draft);
  await Promise.resolve();
  assert.equal(data.plans[0], old);
  assert.equal(calls.at(-1).data.expectedDayVersion, 4);
  assert.equal(calls.at(-1).data.plan._dayVersion, undefined);
  accept();
  await saving;
  assert.equal(data.plans[0].beforeMood, 'good');
  assert.equal(data.plans[0].version, 2);
  assert.equal(old.beforeMood, undefined);
  assert.equal(draft._dayVersion, 4);
});

test('response loss retry reuses the request ID and does not duplicate the saved plan', async () => {
  let first = true;
  let committed;
  const { store, data, calls } = setup(request => {
    if (request.action === 'list') return emptyPage();
    if (!committed) committed = { ...request.plan, version: 1 };
    if (first) { first = false; throw new Error('response lost after commit'); }
    return ok(committed);
  });
  await store.loadData();
  const draft = { id: 'stable-plan-id', date: '2026-09-26' };
  await assert.rejects(store.savePlan(draft), /网络/);
  assert.equal(data.plans.length, 0);
  await store.savePlan(draft);
  const writes = calls.filter(call => call.data.action === 'savePlan');
  assert.equal(writes[0].data.requestId, writes[1].data.requestId);
  assert.equal(data.plans.length, 1);
});

test('server version and authorization failures preserve data and propagate explicit errors', async () => {
  let failure = 'VERSION_CONFLICT';
  const { store, data } = setup(request => request.action === 'list' ? emptyPage() : { ok: false, code: failure, message: '记录已更新，请重新加载' });
  await store.loadData();
  const saved = { id: 'p-one', version: 2 };
  data.plans.push(saved);
  await assert.rejects(store.savePlan({ id: 'p-one', version: 1 }), { code: 'VERSION_CONFLICT' });
  assert.equal(data.plans[0], saved);
  failure = 'FORBIDDEN';
  await assert.rejects(store.savePlan({ id: 'p-two' }), { code: 'FORBIDDEN' });
  assert.deepEqual(data.plans, [saved]);
});

test('day writes retain hidden walk state and only advance after confirmed success', async () => {
  const { store, data } = setup(request => request.action === 'list' ? emptyPage() : ok({ ...request.day, version: 2 }));
  await store.loadData();
  data.periodDays['2026-09-26'] = true;
  data.periodWalks['2026-09-26'] = { status: 'incomplete' };
  data.dayVersions['2026-09-26'] = 1;
  const day = store.getDay('2026-09-26');
  day.periodMarked = false;
  await store.saveDay(day);
  assert.equal(data.periodDays[day.date], undefined);
  assert.deepEqual(data.periodWalks[day.date], { status: 'incomplete' });
  assert.equal(data.dayVersions[day.date], 2);
});

test('writes are blocked before a successful initial load', async () => {
  const { store, calls } = setup(emptyPage);
  await assert.rejects(store.savePlan({ id: 'p-one' }), /先成功加载/);
  assert.equal(calls.length, 0);
});
