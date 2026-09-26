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
  const state = { identity: { OPENID: 'owner-one', APPID }, owner: 'owner-one', now: new Date('2026-09-26T04:00:00Z') };
  const logs = [];
  const api = createApi({ db, getIdentity: () => state.identity, getOwner: () => state.owner, now: () => state.now, logError: value => logs.push(value) });
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
  const results = await Promise.all([
    f.main({ action: 'list', collection: 'plans' }, ownerContext),
    f.main({ action: 'list', collection: 'plans' }, otherContext),
    f.main({ action: 'whoami' }, otherContext)
  ]);
  assert.deepEqual(ok(results[0]), { items: [], nextCursor: '' });
  error(results[1], 'FORBIDDEN');
  assert.deepEqual(ok(results[2]), { openid: 'other-user', appid: APPID });
});

test('identity is injected by WeChat; whoami never trusts forged event fields', async () => {
  const f = fixture();
  const event = { action: 'whoami', OPENID: 'forged', APPID: 'forged', context: { OPENID: 'forged' }, headers: { secret: 'private' } };
  assert.deepEqual(ok(await f.api(event)), { openid: 'owner-one', appid: APPID });
  f.state.identity = {};
  error(await f.api(event), 'AUTH_REQUIRED');
  f.state.identity = { OPENID: 'owner-one', APPID: 'other-app' };
  error(await f.api(event), 'APP_MISMATCH');
  f.state.identity = { OPENID: 'other-user', APPID };
  error(await f.save(plan(), { OPENID: 'owner-one' }), 'FORBIDDEN');
  f.state.identity.OPENID = 'owner-one';
  f.state.owner = undefined;
  error(await f.list(), 'OWNER_NOT_CONFIGURED');
  assert.equal(f.db.stats.transactions, 0);
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
  const completed = ok(await f.save({ ...begun, result: { status: 'completed' } }));
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
  const completed = ok(await f.save({ ...saved, result: { status: 'completed', runningData: { durationMinutes: '30.5', distanceKm: '0', heartRate: '' }, afterMood: 'good', feeling: '' } }));
  assert.deepEqual(completed.result.runningData, { durationMinutes: '30.5', distanceKm: '0', heartRate: '' });
  const list = ok(await f.list()).items;
  assert.deepEqual(list[0], completed);
  const corrected = ok(await f.save({ ...completed, result: { status: 'incomplete', reason: '加班' } }));
  assert.deepEqual(corrected.result, { status: 'incomplete', reason: '加班' });
  assert.equal(corrected.beforeMood, 'neutral');
  error(await f.save({ ...corrected, result: { status: 'replacement', actualActivity: '散步' } }), 'INVALID_TRANSITION');
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
  error(await f.save({ ...saved, result: { status: 'completed' } }), 'DAY_VERSION_CONFLICT');
  const completed = ok(await f.save({ ...saved, result: { status: 'completed' } }, { expectedDayVersion: day.version }));
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
