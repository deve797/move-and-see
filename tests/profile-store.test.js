const test = require('node:test');
const assert = require('node:assert/strict');
const createStore = require('../miniprogram/utils/profile-store');

const empty = () => ({ nickname: '', avatarFileID: '', avatarUrl: '', avatarUnavailable: false, version: 0 });
const ok = data => ({ ok: true, data });
function setup(handler) {
  const state = { profile: null, profileLoaded: false };
  const calls = [];
  const store = createStore({ async callFunction(request) {
    calls.push(request);
    return { result: await handler(request.data) };
  } }, state, 'verified-env');
  return { store, state, calls };
}

test('profile requests use the configured function and environment without a client identity', async () => {
  const { store, state, calls } = setup(() => ok(empty()));
  await store.loadProfile();
  assert.deepEqual(state.profile, empty());
  assert.equal(state.profileLoaded, true);
  assert.deepEqual(calls, [{ name: 'moveSeeApi', config: { env: 'verified-env' }, data: { action: 'getProfile' } }]);
});

test('saving only sends editable fields and publishes the confirmed response', async () => {
  let accept;
  const { store, state, calls } = setup(request => request.action === 'getProfile' ? ok(empty()) : new Promise(resolve => {
    accept = () => resolve(ok({ ...empty(), nickname: request.profile.nickname, avatarFileID: 'cloud://own', avatarUrl: 'https://signed/own', version: 1 }));
  }));
  await store.loadProfile();
  const original = state.profile;
  const proposed = { nickname: '  小林  ', avatarBase64: 'aW1hZ2U=', avatarFileID: 'cloud://other', avatarUrl: 'https://other', _owner: 'another' };
  const saving = store.saveProfile(proposed, 0);
  await Promise.resolve();
  assert.equal(state.profile, original);
  assert.deepEqual(calls.at(-1).data.profile, { nickname: '小林', avatarBase64: 'aW1hZ2U=' });
  assert.equal(calls.at(-1).data.expectedVersion, 0);
  accept();
  const saved = await saving;
  assert.equal(state.profile, saved);
  assert.equal(saved.version, 1);
  assert.equal(proposed.nickname, '  小林  ');
});

test('response-loss retry preserves the request ID, payload and version', async () => {
  let first = true;
  const saved = { ...empty(), nickname: '小林', version: 1 };
  const { store, state, calls } = setup(request => {
    if (request.action === 'getProfile') return ok(empty());
    if (first) { first = false; throw new Error('response lost after commit'); }
    return ok(saved);
  });
  await store.loadProfile();
  await assert.rejects(store.saveProfile({ nickname: '小林' }, 0), { code: 'NETWORK' });
  assert.equal(state.profile.nickname, '');
  await store.saveProfile({ nickname: '小林' }, 0);
  assert.deepEqual(calls[1].data, calls[2].data);
  assert.equal(state.profile.version, 1);
});

test('overlapping saves share one request and changing a failed draft gets a new ID', async () => {
  let reject;
  const { store, calls } = setup(request => request.action === 'getProfile' ? ok(empty()) : new Promise((resolve, fail) => { reject = fail; }));
  await store.loadProfile();
  const first = store.saveProfile({ nickname: '小林' }, 0);
  assert.equal(store.saveProfile({ nickname: '小林' }, 0), first);
  await Promise.resolve();
  reject(new Error('offline'));
  await assert.rejects(first);
  const changed = store.saveProfile({ nickname: '小果' }, 0);
  await Promise.resolve();
  assert.notEqual(calls[1].data.requestId, calls[2].data.requestId);
  reject(new Error('offline'));
  await assert.rejects(changed);
});

test('failed initial and later reads prevent writes without erasing the last saved snapshot', async () => {
  let failing = true;
  const { store, state, calls } = setup(() => {
    if (failing) throw new Error('offline');
    return ok({ ...empty(), nickname: '已保存', version: 2 });
  });
  await assert.rejects(store.loadProfile());
  await assert.rejects(store.saveProfile({ nickname: '不能保存' }, 0), /先成功读取/);
  assert.equal(calls.length, 1);
  failing = false;
  await store.loadProfile();
  failing = true;
  await assert.rejects(store.loadProfile());
  await assert.rejects(store.saveProfile({ nickname: '不能保存' }, 2), /先成功读取/);
  assert.equal(state.profile.nickname, '已保存');
  assert.equal(state.profileLoaded, false);
});

test('version conflict and avatar URL failure keep their explicit states', async () => {
  const profile = { ...empty(), nickname: '已保存', avatarFileID: 'cloud://own', avatarUnavailable: true, version: 2 };
  const { store, state } = setup(request => request.action === 'getProfile' ? ok(profile) : { ok: false, code: 'VERSION_CONFLICT', message: '资料已更新，请重新读取' });
  await store.loadProfile();
  assert.equal(state.profile.avatarUnavailable, true);
  await assert.rejects(store.saveProfile({ nickname: '旧草稿' }, 1), { code: 'VERSION_CONFLICT' });
  assert.equal(state.profile, profile);
});

test('independent WeChat app sessions do not reuse another session profile or request state', async () => {
  const first = setup(() => ok({ ...empty(), nickname: '甲', version: 1 }));
  const second = setup(() => ok({ ...empty(), nickname: '乙', version: 1 }));
  await first.store.loadProfile();
  assert.equal(second.state.profile, null);
  await second.store.loadProfile();
  assert.equal(first.state.profile.nickname, '甲');
  assert.equal(second.state.profile.nickname, '乙');
});
