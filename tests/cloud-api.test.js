const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApi, documentId, APPID } = require('../cloudfunctions/moveSeeApi/api');

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function database() {
  let documents = new Map();
  let queue = Promise.resolve();
  let failWrite = false;
  const stats = { transactions: 0 };
  function collection(name, target = () => documents) {
    return {
      doc(id) {
        const key = name + '/' + id;
        return {
          async get() { return { data: target().has(key) ? { ...clone(target().get(key)), _id: id } : null }; },
          async set({ data }) {
            if (failWrite && data._kind === 'request') throw new Error('private SDK diagnostic');
            target().set(key, clone(data));
          }
        };
      },
      where(condition) {
        let limit = 100;
        const query = {
          orderBy(field, direction) { assert.equal(field, '_id'); assert.equal(direction, 'asc'); return query; },
          limit(count) { limit = count; return query; },
          async get() {
            const data = [...target()].filter(([key]) => key.startsWith(name + '/')).map(([key, value]) => ({ ...clone(value), _id: key.slice(name.length + 1) }))
              .filter(doc => Object.entries(condition).every(([key, value]) => value && value.gt !== undefined ? doc[key] > value.gt : doc[key] === value))
              .sort((a, b) => a._id.localeCompare(b._id)).slice(0, limit);
            return { data };
          }
        };
        return query;
      }
    };
  }
  return {
    stats, collection, command: { gt: value => ({ gt: value }) },
    failReceiptWrite(value) { failWrite = value; },
    seed(name, id, data) { documents.set(name + '/' + id, clone(data)); },
    records(name) { return [...documents].filter(([key, data]) => key.startsWith(name + '/') && data._kind === 'record').map(([, data]) => clone(data)); },
    // Serialized, copy-on-write transactions model atomic commit/rollback. The real
    // SDK provides conflict retries; validation must re-read inside its callback.
    runTransaction(callback) {
      const promise = queue.then(async () => {
        stats.transactions += 1;
        const pending = new Map([...documents].map(([key, value]) => [key, clone(value)]));
        const result = await callback({ collection: name => collection(name, () => pending) });
        documents = pending;
        return result;
      });
      queue = promise.catch(() => {});
      return promise;
    }
  };
}
function fixture() {
  const db = database();
  const state = { identity: { OPENID: 'owner-one', APPID }, now: new Date('2026-09-26T04:00:00Z') };
  const logs = [];
  const api = createApi({ db, getIdentity: () => state.identity, now: () => state.now, logError: value => logs.push(value) });
  let sequence = 0;
  return {
    db, state, api, logs,
    save(plan, options = {}) { return api({ action: 'savePlan', plan, expectedVersion: plan.version || 0, requestId: 'request-' + (++sequence), ...options }); },
    day(day, options = {}) { return api({ action: 'saveDay', day, expectedVersion: day.version || 0, requestId: 'request-' + (++sequence), ...options }); },
    list(collection = 'plans', cursor) { return api({ action: 'list', collection, cursor }); }
  };
}
function plan(changes = {}) { return { id: 'plan-one', date: '2026-09-26', startTime: '18:00', activity: '跑步', ...changes }; }
function ok(response) { assert.equal(response.ok, true, JSON.stringify(response)); return response.data; }
function error(response, code) { assert.equal(response.ok, false); assert.equal(response.code, code, JSON.stringify(response)); }

function entrypointFixture() {
  const db = database();
  const exports = {};
  const parsedContexts = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../cloudfunctions/moveSeeApi/index.js'), 'utf8'), {
    exports, Date,
    process: { env: { OWNER_OPENID: 'owner-one', WX_OPENID: 'owner-one', WX_APPID: APPID, WX_CONTEXT_KEYS: 'WX_OPENID,WX_APPID' } },
    require(name) {
      if (name === './api') return { createApi };
      if (name === 'wx-server-sdk') return {
        DYNAMIC_CURRENT_ENV: 'runtime-environment', init() {}, database: () => db,
        getWXContext() { throw new Error('must not read stale process identity'); }
      };
      if (name === '@cloudbase/node-sdk') return {
        parseContext(context) {
          parsedContexts.push(context);
          if (!context || context.malformed) throw new Error('private context diagnostic');
          // Parser output is supplied by the fixture; production parsing is the
          // official pinned SDK, whose environment/environ contract was checked.
          return context.parsed;
        }
      };
      throw new Error('Unexpected dependency');
    }
  });
  return { main: exports.main, db, parsedContexts };
}

test('entrypoint rejects non-WeChat calls on a warm instance with a previous owner identity', async () => {
  const f = entrypointFixture();
  const context = { parsed: { environment: { WX_OPENID: 'owner-one', WX_APPID: APPID } } };
  assert.deepEqual(ok(await f.main({ action: 'whoami' }, context)), { openid: 'owner-one', appid: APPID });
  assert.equal(f.parsedContexts[0], context, 'only the actual handler context reaches the parser');
  const forgedEvent = { action: 'list', collection: 'plans', OPENID: 'owner-one', APPID, context };
  error(await f.main(forgedEvent, { parsed: { environment: {} } }), 'AUTH_REQUIRED');
  error(await f.main(forgedEvent, { parsed: { environ: {} } }), 'AUTH_REQUIRED');
  error(await f.main(forgedEvent, undefined), 'AUTH_REQUIRED');
  const malformed = await f.main(forgedEvent, { malformed: true });
  error(malformed, 'AUTH_REQUIRED');
  assert.equal(JSON.stringify(malformed).includes('private'), false);
  assert.equal(f.db.stats.transactions, 0);
});

test('entrypoint handles both context formats and isolates simultaneous caller identities', async () => {
  const f = entrypointFixture();
  const ownerContext = { parsed: { environ: { WX_OPENID: 'owner-one', WX_APPID: APPID } } };
  const otherContext = { parsed: { environment: { WX_OPENID: 'other-user', WX_APPID: APPID } } };
  const event = { action: 'savePlan', plan: plan(), expectedVersion: 0, requestId: 'same-request' };
  const results = await Promise.all([
    f.main(event, ownerContext),
    f.main({ ...event, plan: plan({ activity: '散步' }) }, otherContext),
    f.main({ action: 'whoami' }, otherContext)
  ]);
  assert.equal(ok(results[0]).activity, '跑步');
  assert.equal(ok(results[1]).activity, '散步');
  assert.deepEqual(ok(results[2]), { openid: 'other-user', appid: APPID });
  const lists = await Promise.all([
    f.main({ action: 'list', collection: 'plans' }, ownerContext),
    f.main({ action: 'list', collection: 'plans' }, otherContext)
  ]);
  assert.deepEqual(ok(lists[0]).items, [results[0].data]);
  assert.deepEqual(ok(lists[1]).items, [results[1].data]);
});

test('identity is injected by WeChat; whoami never trusts forged event fields', async () => {
  const f = fixture();
  const event = { action: 'whoami', OPENID: 'forged', APPID: 'forged', context: { OPENID: 'forged' }, headers: { secret: 'private' } };
  assert.deepEqual(ok(await f.api(event)), { openid: 'owner-one', appid: APPID });
  for (const identity of [{}, { OPENID: '', APPID }, { OPENID: 123, APPID }]) {
    f.state.identity = identity;
    error(await f.api(event), 'AUTH_REQUIRED');
    error(await f.save(plan(), { OPENID: 'owner-one', APPID }), 'AUTH_REQUIRED');
  }
  for (const identity of [{ OPENID: 'owner-one' }, { OPENID: 'owner-one', APPID: 'other-app' }]) {
    f.state.identity = identity;
    error(await f.api(event), 'APP_MISMATCH');
    error(await f.save(plan(), { OPENID: 'owner-one', APPID }), 'APP_MISMATCH');
  }
  assert.equal(f.db.stats.transactions, 0);
});

test('users independently save and replay identical plan IDs, dates and request IDs', async () => {
  const f = fixture();
  const event = { action: 'savePlan', plan: plan(), expectedVersion: 0, requestId: 'same-request' };
  const first = ok(await f.api(event));
  const firstDay = ok(await f.day({ date: first.date, periodMarked: true }, { requestId: 'same-day-request' }));
  f.state.identity = { OPENID: 'other-user', APPID };
  assert.deepEqual(ok(await f.list()).items, []);
  assert.deepEqual(ok(await f.list('day_marks')).items, []);
  const otherEvent = { ...event, plan: plan({ activity: '散步' }), OPENID: 'owner-one', _owner: 'owner-one' };
  const other = ok(await f.api(otherEvent));
  const otherDay = ok(await f.day({ date: first.date, periodMarked: false }, { requestId: 'same-day-request' }));
  assert.deepEqual(ok(await f.api(otherEvent)), other);
  const edited = ok(await f.save({ ...other, startTime: '19:00' }, { expectedDayVersion: otherDay.version }));
  assert.deepEqual(ok(await f.api(otherEvent)), edited);
  assert.deepEqual(ok(await f.list()).items, [edited]);
  assert.deepEqual(ok(await f.list('day_marks')).items, [otherDay]);
  const owners = f.db.records('plans').map(record => record._owner).sort();
  assert.deepEqual(owners, ['other-user', 'owner-one']);
  assert.equal(f.db.records('day_marks').length, 2);
  f.state.identity = { OPENID: 'owner-one', APPID };
  assert.deepEqual(ok(await f.api(event)), first);
  assert.deepEqual(ok(await f.list()).items, [first]);
  assert.deepEqual(ok(await f.list('day_marks')).items, [firstDay]);
  error(await f.save({ ...first, startTime: '20:00' }), 'DAY_VERSION_CONFLICT');
  ok(await f.save({ ...first, startTime: '20:00' }, { expectedDayVersion: firstDay.version }));
});

test('forged ownership, foreign versions and physical IDs cannot read or mutate another user', async () => {
  const f = fixture();
  const first = ok(await f.save(plan()));
  const firstDay = ok(await f.day({ date: first.date, periodMarked: true }));
  f.state.identity = { OPENID: 'other-user', APPID };
  assert.deepEqual(ok(await f.api({ action: 'list', collection: 'plans', _owner: 'owner-one', OPENID: 'owner-one' })).items, []);
  assert.deepEqual(ok(await f.list('plans', documentId('owner-one', first.id))).items, []);
  error(await f.save({ ...first, cancelled: true }, { OPENID: 'owner-one' }), 'VERSION_CONFLICT');
  error(await f.day({ ...firstDay, periodMarked: false }), 'VERSION_CONFLICT');
  error(await f.save(plan({ _owner: 'owner-one' })), 'INVALID_ARGUMENT');
  error(await f.day({ date: first.date, periodMarked: true, _owner: 'owner-one' }), 'INVALID_ARGUMENT');
  error(await f.save(plan({ _id: documentId('owner-one', first.id) })), 'INVALID_ARGUMENT');
  const guessed = ok(await f.save(plan({ id: documentId('owner-one', first.id) })));
  assert.deepEqual(ok(await f.list()).items, [guessed]);
  f.state.identity = { OPENID: 'owner-one', APPID };
  assert.deepEqual(ok(await f.list()).items, [first]);
  assert.deepEqual(ok(await f.list('day_marks')).items, [firstDay]);
});

test('existing owner records keep their document IDs and remain editable without migration', async () => {
  const f = fixture();
  const existing = { ...plan(), version: 4, createdAt: '2026-09-20T04:00:00.000Z', updatedAt: '2026-09-25T04:00:00.000Z', _owner: 'owner-one', _kind: 'record' };
  const id = documentId('owner-one', existing.id);
  f.db.seed('plans', id, existing);
  const listed = ok(await f.list()).items[0];
  const edited = ok(await f.save({ ...listed, startTime: '19:00' }));
  assert.equal(edited.version, 5);
  assert.equal(edited.createdAt, existing.createdAt);
  assert.equal(f.db.records('plans').length, 1);
  assert.equal((await f.db.collection('plans').doc(id).get()).data.startTime, '19:00');
});

test('transaction ownership checks reject a foreign record or day in a caller document slot', async () => {
  for (const collection of ['plans', 'day_marks']) {
    const f = fixture();
    const value = collection === 'plans' ? { ...plan(), version: 1 } : { date: '2026-09-26', periodMarked: true, version: 1 };
    const id = documentId('owner-one', collection === 'plans' ? value.id : value.date);
    f.db.seed(collection, id, { ...value, _owner: 'other-user', _kind: 'record' });
    const before = f.db.records(collection);
    error(await f.save(plan(), { expectedVersion: collection === 'plans' ? 1 : 0, expectedDayVersion: 1 }), 'FORBIDDEN');
    assert.deepEqual(f.db.records(collection), before);
    assert.deepEqual(ok(await f.list(collection)).items, []);
  }
});

test('invalid dates, enums, notes, nested fields and forged ownership never write', async () => {
  const f = fixture();
  for (const change of [
    { date: '2026-02-30' }, { date: '2026-9-26' }, { startTime: '24:00' }, { activity: '未知' },
    { id: 1 }, { id: '../other' }, { beforeMood: 'awesome' }, { beforeMoodNote: '字'.repeat(201) },
    { _owner: 'other-user' }, { _id: 'another-document' }, { cancelled: 'false' }
  ]) error(await f.save(plan(change)), 'INVALID_ARGUMENT');
  const saved = ok(await f.save(plan()));
  for (const result of [
    { status: 'completed', runningData: { durationMinutes: '-1' } },
    { status: 'completed', runningData: { distanceKm: 'Infinity' } },
    { status: 'completed', runningData: { heartRate: NaN } },
    { status: 'completed', afterMood: 5 }, { status: 'completed', afterMoodNote: '字'.repeat(201) },
    { status: 'completed', feeling: '疼痛' }, { status: 'incomplete', reason: '猜测原因' },
    { status: 'replacement', actualActivity: '跑步', runningData: {} }
  ]) error(await f.save({ ...saved, result }), 'INVALID_ARGUMENT');
  assert.equal(f.db.records('plans')[0].version, 1);
  assert.equal(f.db.records('plans')[0].result, undefined);
});

test('create/edit/cancel persists one business record and rejects stale versions', async () => {
  const f = fixture();
  const original = ok(await f.save(plan({ _dayVersion: 0 })));
  assert.equal(original.version, 1);
  assert.equal(original._owner, undefined);
  assert.equal(original._dayVersion, undefined);
  const edited = ok(await f.save({ ...original, startTime: '19:00' }));
  error(await f.save({ ...original, startTime: '20:00' }), 'VERSION_CONFLICT');
  const cancelled = ok(await f.save({ ...edited, cancelled: true }));
  assert.equal(ok(await f.list()).items[0].cancelled, true);
  error(await f.save({ ...cancelled, cancelled: false }), 'INVALID_TRANSITION');
  assert.equal(f.db.records('plans').length, 1);
  assert.equal(f.db.records('plans')[0].startTime, '19:00');
});

test('begun or completed schedules cannot be edited or cancelled', async () => {
  const f = fixture();
  const begun = ok(await f.save(plan({ startTime: '07:00' })));
  error(await f.save({ ...begun, startTime: '20:00' }), 'INVALID_TRANSITION');
  error(await f.save({ ...begun, cancelled: true }), 'INVALID_TRANSITION');
  const completed = ok(await f.save({ ...begun, result: { status: 'completed', actualDate: begun.date } }));
  error(await f.save({ ...completed, result: undefined }), 'INVALID_TRANSITION');
  error(await f.save({ ...completed, cancelled: true }), 'INVALID_TRANSITION');
});

test('request receipts prevent duplicate writes, changed payload reuse and late replay', async () => {
  const f = fixture();
  const event = { action: 'savePlan', plan: plan(), expectedVersion: 0, requestId: 'same-request' };
  const first = ok(await f.api(event));
  assert.deepEqual(ok(await f.api(event)), first);
  error(await f.api({ ...event, plan: plan({ startTime: '19:00' }) }), 'REQUEST_CONFLICT');
  const edited = ok(await f.save({ ...first, startTime: '20:00' }));
  assert.deepEqual(ok(await f.api(event)), edited);
  assert.equal(f.db.records('plans').length, 1);
  assert.equal(f.db.records('plans')[0].version, 2);
  assert.equal(ok(await f.list()).items.length, 1, 'internal receipts must be excluded');
});

test('concurrent stale writes yield one success and failed transactions leave no partial data', async () => {
  const f = fixture();
  const saved = ok(await f.save(plan()));
  const outcomes = await Promise.all([f.save({ ...saved, startTime: '19:00' }), f.save({ ...saved, startTime: '20:00' })]);
  assert.equal(outcomes.filter(item => item.ok).length, 1);
  error(outcomes.find(item => !item.ok), 'VERSION_CONFLICT');
  const before = clone(f.db.records('plans'));
  f.db.failReceiptWrite(true);
  const failure = await f.save({ ...ok(await f.list()).items[0], startTime: '21:00' });
  error(failure, 'INTERNAL_ERROR');
  assert.equal(JSON.stringify(failure).includes('private'), false);
  assert.equal(f.logs.length, 1);
  assert.deepEqual(Object.keys(f.logs[0]), ['code', 'requestId']);
  assert.match(f.logs[0].requestId, /^[a-f0-9]{16}$/);
  assert.deepEqual(f.db.records('plans'), before);
});

test('running blanks, zeros, optional feelings and results survive round trips', async () => {
  const f = fixture();
  const saved = ok(await f.save(plan({ beforeMood: 'neutral', beforeMoodNote: '' })));
  const completed = ok(await f.save({ ...saved, result: { status: 'completed', actualDate: saved.date, runningData: { durationMinutes: '30.5', distanceKm: '0', heartRate: '' }, afterMood: 'good', feeling: '' } }));
  assert.deepEqual(completed.result.runningData, { durationMinutes: '30.5', distanceKm: '0', heartRate: '' });
  const list = ok(await f.list()).items;
  assert.deepEqual(list[0], completed);
  const corrected = ok(await f.save({ ...completed, result: { status: 'incomplete', reason: '加班' } }));
  assert.deepEqual(corrected.result, { status: 'incomplete', reason: '加班' });
  assert.equal(corrected.beforeMood, 'neutral');
  error(await f.save({ ...corrected, result: { status: 'replacement', actualActivity: '散步' } }), 'INVALID_TRANSITION');
});

for (const status of ['completed', 'replacement']) {
  test(status + ' requires a valid actual date within the plan-to-today interval', async () => {
    const f = fixture();
    const saved = ok(await f.save(plan({ date: '2026-09-20' })));
    const result = status === 'replacement' ? { status, actualActivity: '散步' } : { status };
    error(await f.save({ ...saved, result }), 'INVALID_TRANSITION');
    for (const actualDate of ['', null, 20260926, {}, '2026-9-26', '2026-02-30']) {
      error(await f.save({ ...saved, result: { ...result, actualDate } }), 'INVALID_ARGUMENT');
    }
    for (const actualDate of ['2026-09-19', '2026-09-27']) {
      error(await f.save({ ...saved, result: { ...result, actualDate } }), 'INVALID_TRANSITION');
    }
    assert.deepEqual(ok(await f.list()).items, [saved], 'invalid dates never change the plan');
    const completed = ok(await f.save({ ...saved, result: { ...result, actualDate: '2026-09-26' } }));
    assert.deepEqual(completed.result, { ...result, actualDate: '2026-09-26' });
    assert.equal(completed.date, '2026-09-20');
    assert.equal(completed.startTime, '18:00');
    assert.equal(completed.result.reason, undefined);
    assert.equal(completed.result.makeup, undefined);
    assert.deepEqual(ok(await f.list()).items, [completed]);
  });
}

test('future dates reject all new results until Beijing midnight and allow same-day early completion', async () => {
  for (const result of [
    { status: 'completed', actualDate: '2026-09-27' },
    { status: 'replacement', actualActivity: '散步', actualDate: '2026-09-27' },
    { status: 'incomplete', reason: '加班' }
  ]) {
    const f = fixture();
    f.state.now = new Date('2026-09-26T15:59:59.999Z');
    const saved = ok(await f.save(plan({ date: '2026-09-27', startTime: '23:50' })));
    error(await f.save({ ...saved, result }), 'INVALID_TRANSITION');
    assert.deepEqual(ok(await f.list()).items, [saved]);
    f.state.now = new Date('2026-09-26T16:00:00.000Z');
    const completed = ok(await f.save({ ...saved, result }));
    assert.deepEqual(completed.result, result);
    assert.equal(completed.startTime, '23:50', 'the scheduled time does not block a same-day result');
  }
});

test('changing incomplete to completed requires an explicit date while incomplete cannot carry actualDate', async () => {
  const f = fixture();
  const saved = ok(await f.save(plan({ date: '2026-09-20', beforeMood: 'neutral', beforeMoodNote: '原计划备注' })));
  error(await f.save({ ...saved, result: { status: 'incomplete', reason: '加班', actualDate: '2026-09-20' } }), 'INVALID_ARGUMENT');
  const missed = ok(await f.save({ ...saved, result: { status: 'incomplete', reason: '加班' } }));
  error(await f.save({ ...missed, result: { status: 'completed' } }), 'INVALID_TRANSITION');
  const completed = ok(await f.save({ ...missed, result: { status: 'completed', actualDate: '2026-09-20' } }));
  assert.deepEqual(completed.result, { status: 'completed', actualDate: '2026-09-20' });
  assert.equal(completed.beforeMood, 'neutral');
  assert.equal(completed.beforeMoodNote, '原计划备注');
  const corrected = ok(await f.save({ ...completed, result: { status: 'incomplete', reason: '下雨' } }));
  assert.deepEqual(corrected.result, { status: 'incomplete', reason: '下雨' });
});

test('legacy completed and replacement results preserve unknown actual dates without migration', async () => {
  for (const result of [
    { status: 'completed', afterMood: 'good', runningData: { durationMinutes: '30', distanceKm: '5', heartRate: '' } },
    { status: 'replacement', actualActivity: '散步' }
  ]) {
    const f = fixture();
    const legacy = { ...plan({ date: '2026-09-20' }), result, version: 4, createdAt: '2026-09-20T04:00:00.000Z', updatedAt: '2026-09-20T05:00:00.000Z', _owner: 'owner-one', _kind: 'record' };
    f.db.seed('plans', documentId('owner-one', legacy.id), legacy);
    const listed = ok(await f.list()).items[0];
    assert.deepEqual(listed.result, result);
    const saved = ok(await f.save({ ...listed, beforeMoodNote: '补充原计划备注' }));
    assert.deepEqual(saved.result, result);
    assert.equal(saved.createdAt, legacy.createdAt);
    assert.equal(saved.version, 5);
    if (result.status === 'completed') {
      const felt = ok(await f.save({ ...saved, result: { ...saved.result, feeling: '轻松' } }));
      assert.deepEqual(felt.result, { ...result, feeling: '轻松' });
      assert.equal(felt.result.actualDate, undefined);
      const dated = ok(await f.save({ ...felt, result: { ...felt.result, actualDate: '2026-09-21' } }));
      assert.equal(dated.result.actualDate, '2026-09-21');
    } else {
      error(await f.save({ ...saved, result: { ...saved.result, actualDate: '2026-09-21' } }), 'INVALID_TRANSITION');
    }
  }
});

test('legacy future results stay unchanged while new result transitions remain blocked', async () => {
  const f = fixture();
  const legacy = { ...plan({ date: '2026-09-27' }), result: { status: 'completed' }, version: 2, _owner: 'owner-one', _kind: 'record' };
  f.db.seed('plans', documentId('owner-one', legacy.id), legacy);
  const listed = ok(await f.list()).items[0];
  const felt = ok(await f.save({ ...listed, result: { ...listed.result, afterMood: 'good' } }));
  assert.deepEqual(felt.result, { status: 'completed', afterMood: 'good' });
  error(await f.save({ ...felt, result: { status: 'incomplete', reason: '加班' } }), 'INVALID_TRANSITION');
  error(await f.save({ ...felt, result: { ...felt.result, actualDate: '2026-09-27' } }), 'INVALID_TRANSITION');
});

test('actual-date corrections preserve other data and retain version, receipt and rollback guarantees', async () => {
  const f = fixture();
  const saved = ok(await f.save(plan({ date: '2026-09-20', beforeMood: 'neutral', beforeMoodNote: '原计划备注' })));
  const result = { status: 'completed', actualDate: '2026-09-23', afterMood: 'good', afterMoodNote: '运动后备注', feeling: '轻松', runningData: { durationMinutes: '30.5', distanceKm: '0', heartRate: '' } };
  const event = { action: 'savePlan', plan: { ...saved, result }, expectedVersion: saved.version, requestId: 'completed-once' };
  const completed = ok(await f.api(event));
  assert.deepEqual(ok(await f.api(event)), completed);
  error(await f.api({ ...event, plan: { ...event.plan, result: { ...result, actualDate: '2026-09-24' } } }), 'REQUEST_CONFLICT');
  for (const actualDate of [undefined, '2026-09-19', '2026-09-27']) {
    error(await f.save({ ...completed, result: { ...result, actualDate } }), 'INVALID_TRANSITION');
  }
  const corrected = ok(await f.save({ ...completed, result: { ...result, actualDate: '2026-09-24' } }));
  assert.deepEqual(corrected.result, { ...result, actualDate: '2026-09-24' });
  assert.equal(corrected.version, 3);
  assert.equal(corrected.createdAt, saved.createdAt);
  assert.equal(corrected.date, saved.date);
  assert.equal(corrected.startTime, saved.startTime);
  assert.equal(corrected.beforeMoodNote, saved.beforeMoodNote);
  assert.deepEqual(ok(await f.api(event)), corrected, 'replaying an old receipt returns the current record');
  error(await f.save({ ...completed, result: { ...result, actualDate: '2026-09-25' } }), 'VERSION_CONFLICT');
  f.db.failReceiptWrite(true);
  error(await f.save({ ...corrected, result: { ...result, actualDate: '2026-09-25' } }), 'INTERNAL_ERROR');
  assert.deepEqual(ok(await f.list()).items, [corrected]);
});

test('replacement actual dates remain immutable along with the existing result', async () => {
  const f = fixture();
  const saved = ok(await f.save(plan({ date: '2026-09-20' })));
  const replaced = ok(await f.save({ ...saved, result: { status: 'replacement', actualActivity: '散步', actualDate: '2026-09-23' } }));
  for (const actualDate of [undefined, '2026-09-24']) {
    error(await f.save({ ...replaced, result: { ...replaced.result, actualDate } }), 'INVALID_TRANSITION');
  }
  const annotated = ok(await f.save({ ...replaced, beforeMoodNote: '原计划备注' }));
  assert.deepEqual(annotated.result, replaced.result);
});

test('makeup preserves original failure, accepts cross-week date and protects immutable makeup', async () => {
  const f = fixture();
  const saved = ok(await f.save(plan({ date: '2026-09-20' })));
  error(await f.save({ ...saved, result: { status: 'incomplete', reason: '' } }), 'INVALID_TRANSITION');
  const missed = ok(await f.save({ ...saved, result: { status: 'incomplete', reason: '加班' } }));
  for (const date of ['2026-09-19', '2026-09-27']) error(await f.save({ ...missed, result: { ...missed.result, makeup: { date, actualActivity: '跑步' } } }), 'INVALID_TRANSITION');
  const madeUp = ok(await f.save({ ...missed, result: { ...missed.result, makeup: { date: '2026-09-26', actualActivity: '散步' } } }));
  assert.equal(madeUp.date, '2026-09-20');
  assert.equal(madeUp.result.reason, '加班');
  error(await f.save({ ...madeUp, result: { ...madeUp.result, reason: '下雨' } }), 'INVALID_TRANSITION');
  error(await f.save({ ...madeUp, result: { status: 'completed' } }), 'INVALID_TRANSITION');
  error(await f.save({ ...madeUp, result: { ...madeUp.result, makeup: { date: '2026-09-25', actualActivity: '散步' } } }), 'INVALID_TRANSITION');
  ok(await f.save({ ...madeUp, result: { ...madeUp.result, makeup: { ...madeUp.result.makeup, afterMood: 'great', feeling: '适中' } } }));
  const sameDay = ok(await f.save(plan({ id: 'same-day-makeup' })));
  const sameDayMissed = ok(await f.save({ ...sameDay, result: { status: 'incomplete', reason: '临时有事' } }));
  const sameDayMakeup = ok(await f.save({ ...sameDayMissed, result: { ...sameDayMissed.result, makeup: { date: sameDay.date, actualActivity: '散步' } } }));
  assert.deepEqual(sameDayMakeup.result, { status: 'incomplete', reason: '临时有事', makeup: { date: '2026-09-26', actualActivity: '散步' } });
});

test('day changes preserve optional walks and use Beijing midnight on the server', async () => {
  const f = fixture();
  error(await f.day({ date: '2026-09-25', periodMarked: true }), 'INVALID_TRANSITION');
  let day = ok(await f.day({ date: '2026-09-26', periodMarked: true }));
  error(await f.day({ ...day, periodWalk: { status: 'completed' } }), 'INVALID_TRANSITION');
  day = ok(await f.day({ ...day, periodWalk: { status: 'pending' } }));
  day = ok(await f.day({ ...day, periodWalk: { status: 'completed' } }));
  error(await f.day({ ...day, periodMarked: false, periodWalk: undefined }), 'INVALID_TRANSITION');
  day = ok(await f.day({ ...day, periodMarked: false }));
  assert.equal(day.periodWalk.status, 'completed');
  day = ok(await f.day({ ...day, periodMarked: true }));
  f.state.now = new Date('2026-09-26T16:00:00Z');
  error(await f.day({ ...day, periodMarked: false }), 'INVALID_TRANSITION');
  ok(await f.day({ date: '2026-09-27', periodMarked: true }));
});

test('day version guards every plan mutation and period corrections allow a missing reason', async () => {
  const f = fixture();
  const saved = ok(await f.save(plan()));
  const day = ok(await f.day({ date: saved.date, periodMarked: true }));
  error(await f.save({ ...saved, result: { status: 'completed', actualDate: saved.date } }), 'DAY_VERSION_CONFLICT');
  const completed = ok(await f.save({ ...saved, result: { status: 'completed', actualDate: saved.date } }, { expectedDayVersion: day.version }));
  const missed = ok(await f.save({ ...completed, result: { status: 'incomplete', reason: '' } }, { expectedDayVersion: day.version }));
  const unmarked = ok(await f.day({ ...day, periodMarked: false }));
  error(await f.save({ ...missed, beforeMood: 'good' }, { expectedDayVersion: day.version }), 'DAY_VERSION_CONFLICT');
  // Removing a mistaken period mark must not rewrite historical results.
  ok(await f.save({ ...missed, beforeMood: 'good' }, { expectedDayVersion: unmarked.version }));
});

test('pagination excludes receipts and other owners, returning only business fields', async () => {
  const f = fixture();
  for (let index = 0; index < 103; index += 1) {
    const record = { ...plan({ id: 'item-' + index }), version: 1, _owner: 'owner-one', _kind: 'record' };
    f.db.seed('plans', documentId('owner-one', record.id), record);
  }
  f.db.seed('plans', documentId('other-user', 'private'), { ...plan(), _owner: 'other-user', _kind: 'record', version: 1 });
  f.db.seed('plans', 'r_receipt', { _owner: 'owner-one', _kind: 'request', payloadHash: 'private' });
  const first = ok(await f.list());
  const second = ok(await f.list('plans', first.nextCursor));
  assert.equal(first.items.length, 100);
  assert.equal(second.items.length, 3);
  assert.equal(second.nextCursor, '');
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 103);
  assert.equal(first.items.some(item => '_owner' in item || '_kind' in item || '_id' in item), false);
  error(await f.list('arbitrary'), 'INVALID_ARGUMENT');
  error(await f.list('plans', { gt: '' }), 'INVALID_ARGUMENT');
});
