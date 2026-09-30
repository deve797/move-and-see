const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const { createApi, APPID } = require('../cloudfunctions/moveSeeApi/api');
const { profileId, MAX_AVATAR_BYTES } = require('../cloudfunctions/moveSeeApi/profile');

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6BlAAAAAASUVORK5CYII=', 'base64');
const blank = { nickname: '', avatarFileID: '', avatarUrl: '', avatarUnavailable: false, version: 0 };

function database() {
  let documents = new Map();
  let queue = Promise.resolve();
  const state = { failReceipt: false, failAfterCommit: false, beforeTransaction: null };
  const stats = { reads: 0, transactions: 0 };
  function collection(name, target = () => documents) {
    assert.equal(name, 'profiles');
    return {
      doc(id) {
        return {
          async get() {
            stats.reads += 1;
            return { data: target().has(id) ? { ...clone(target().get(id)), _id: id } : null };
          },
          async set({ data }) {
            if (state.failReceipt && data._kind === 'request') throw new Error('private database diagnostic');
            target().set(id, clone(data));
          }
        };
      }
    };
  }
  return {
    state, stats, collection,
    seed(id, value) { documents.set(id, clone(value)); },
    snapshot() { return clone([...documents]); },
    records() { return [...documents.values()].filter(value => value._kind === 'profile').map(clone); },
    // Serialized copy-on-write transactions exercise atomic profile + receipt
    // commit and rollback. SDK retry behavior is not reproduced by this fake.
    runTransaction(callback) {
      const promise = queue.then(async () => {
        stats.transactions += 1;
        if (state.beforeTransaction) {
          const before = state.beforeTransaction;
          state.beforeTransaction = null;
          before();
        }
        const pending = new Map([...documents].map(([id, value]) => [id, clone(value)]));
        const result = await callback({ collection: name => collection(name, () => pending) });
        documents = pending;
        if (state.failAfterCommit) throw new Error('commit succeeded but response was lost');
        return result;
      });
      queue = promise.catch(() => {});
      return promise;
    }
  };
}

function fixture() {
  const db = database();
  const state = { identity: { OPENID: 'owner-one', APPID }, now: new Date('2026-09-30T04:00:00Z'), uploadFails: false, signFails: false, uploadResult: null, signResult: null };
  const uploads = [];
  const signatures = [];
  const deleted = [];
  const stored = new Set();
  const logs = [];
  const files = {
    async uploadFile(input) {
      uploads.push({ cloudPath: input.cloudPath, fileContent: Buffer.from(input.fileContent) });
      if (state.uploadFails) throw new Error('private upload diagnostic');
      const fileID = 'cloud://environment.bucket/' + input.cloudPath;
      stored.add(fileID);
      return state.uploadResult || { fileID };
    },
    async getTempFileURL(input) {
      signatures.push(clone(input));
      if (state.signFails) throw new Error('private signature diagnostic');
      return state.signResult || { fileList: input.fileList.map(item => ({ fileID: item.fileID, tempFileURL: 'https://images.example/' + item.fileID.split('/').pop(), status: 0 })) };
    },
    async deleteFile(input) { deleted.push(clone(input)); }
  };
  const api = createApi({ db, files, getIdentity: () => state.identity, now: () => state.now, logError: value => logs.push(value) });
  let sequence = 0;
  return {
    db, state, api, uploads, signatures, deleted, stored, logs,
    get(extra = {}) { return api({ action: 'getProfile', ...extra }); },
    save(profile, extra = {}) { return api({ action: 'saveProfile', profile, expectedVersion: 0, requestId: 'request-' + (++sequence), ...extra }); }
  };
}

function ok(response) { assert.equal(response.ok, true, JSON.stringify(response)); return response.data; }
function error(response, code) { assert.equal(response.ok, false, JSON.stringify(response)); assert.equal(response.code, code, JSON.stringify(response)); }
function event(profile, changes = {}) { return { action: 'saveProfile', profile, expectedVersion: 0, requestId: 'save-once', ...changes }; }

test('first profile read returns an empty profile without creating records or files', async () => {
  const f = fixture();
  assert.deepEqual(ok(await f.get()), blank);
  assert.deepEqual(f.db.snapshot(), []);
  assert.equal(f.db.stats.transactions, 0);
  assert.deepEqual(f.uploads, []);
  assert.deepEqual(f.signatures, []);
});

test('profile endpoints require trusted WeChat identity and the expected app before reading data', async () => {
  for (const identity of [{}, { OPENID: '', APPID }, { OPENID: 123, APPID }, { OPENID: 'owner-one', APPID: 'other-app' }]) {
    const f = fixture();
    f.state.identity = identity;
    const code = identity.OPENID === 'owner-one' ? 'APP_MISMATCH' : 'AUTH_REQUIRED';
    error(await f.get({ OPENID: 'owner-one', APPID }), code);
    error(await f.save({ nickname: '小明' }, { OPENID: 'owner-one', APPID }), code);
    assert.equal(f.db.stats.reads, 0);
    assert.deepEqual(f.uploads, []);
  }
});

test('nicknames accept 1 to 20 Unicode code points, trim edges, and persist across reads', async () => {
  for (const nickname of ['明', '中'.repeat(20), '🏃'.repeat(20), '  小明 🏃  ']) {
    const f = fixture();
    const saved = ok(await f.save({ nickname }));
    assert.deepEqual(saved, { ...blank, nickname: nickname.trim(), version: 1 });
    assert.deepEqual(ok(await f.get()), saved);
    assert.equal(f.db.records()[0]._owner, 'owner-one');
    assert.equal(f.db.records()[0].createdAt, f.state.now.toISOString());
    assert.deepEqual(Object.keys(saved).sort(), Object.keys(blank).sort(), 'internal owner, receipt and timestamps are not exposed');
  }
});

test('invalid nicknames and profile shapes do not create data', async () => {
  for (const nickname of [undefined, null, 42, '', '   ', '中'.repeat(21), '🏃'.repeat(21), '小\n明', '小\x00明', '小\x7f明']) {
    const f = fixture();
    error(await f.save({ nickname }), 'INVALID_NICKNAME');
    assert.deepEqual(f.db.snapshot(), []);
  }
  for (const profile of [undefined, null, [], '小明']) {
    const f = fixture();
    error(await f.save(profile), 'INVALID_ARGUMENT');
    assert.deepEqual(f.db.snapshot(), []);
  }
});

test('only nickname and image bytes can be written, never client-supplied ownership or file references', async () => {
  for (const [key, value] of Object.entries({ _owner: 'owner-two', avatarFileID: 'cloud://other/private.png', avatarUrl: 'https://other.example/private.png', fileID: 'cloud://other/private.png', url: 'https://other.example', version: 99 })) {
    const f = fixture();
    error(await f.save({ nickname: '小明', [key]: value }), 'INVALID_ARGUMENT');
    assert.deepEqual(f.db.snapshot(), []);
    assert.deepEqual(f.uploads, []);
    assert.deepEqual(f.signatures, []);
  }
});

test('A and B can use the same request ID without reading or changing each other', async () => {
  const f = fixture();
  const first = ok(await f.save({ nickname: '甲', avatarBase64: png.toString('base64') }, { requestId: 'shared-request' }));
  f.state.identity.OPENID = 'owner-two';
  assert.deepEqual(ok(await f.get({ owner: 'owner-one', _owner: 'owner-one', OPENID: 'owner-one', documentId: profileId('owner-one') })), blank);
  const second = ok(await f.save({ nickname: '乙', avatarBase64: png.toString('base64') }, { requestId: 'shared-request', _owner: 'owner-one' }));
  assert.notEqual(first.avatarFileID, second.avatarFileID);
  assert.equal(second.avatarFileID.includes('/avatars/' + hash('owner-two') + '/'), true);
  assert.deepEqual(ok(await f.get()), second);
  f.state.identity.OPENID = 'owner-one';
  assert.deepEqual(ok(await f.get({ owner: 'owner-two' })), first);
  assert.equal(f.db.records().length, 2);
  assert.equal(f.db.snapshot().length, 4, 'each owner has an independent profile and receipt');
});

test('profile reads and writes reject stored records whose owner or kind does not match', async () => {
  for (const changes of [{ _owner: 'owner-two' }, { _kind: 'request' }]) {
    const f = fixture();
    f.db.seed(profileId('owner-one'), { nickname: 'private', avatarFileID: '', version: 1, _owner: 'owner-one', _kind: 'profile', ...changes });
    const before = f.db.snapshot();
    error(await f.get(), 'FORBIDDEN');
    error(await f.save({ nickname: 'overwrite' }, { expectedVersion: 1 }), 'FORBIDDEN');
    assert.deepEqual(f.db.snapshot(), before);
  }
});

test('save rejects missing or invalid request IDs and versions before any upload', async () => {
  for (const changes of [{ requestId: '' }, { requestId: 'request/other' }, { requestId: 'x'.repeat(101) }, { expectedVersion: -1 }, { expectedVersion: 0.5 }, { expectedVersion: '0' }, { expectedVersion: undefined }]) {
    const f = fixture();
    error(await f.api(event({ nickname: '小明', avatarBase64: png.toString('base64') }, changes)), 'INVALID_ARGUMENT');
    assert.deepEqual(f.db.snapshot(), []);
    assert.deepEqual(f.uploads, []);
  }
});

test('avatar upload uses content-addressed own paths and returns a temporary HTTPS image URL', async () => {
  const f = fixture();
  const saved = ok(await f.save({ nickname: '小明', avatarBase64: png.toString('base64') }));
  const cloudPath = 'avatars/' + hash('owner-one') + '/' + hash(png) + '.png';
  assert.equal(f.uploads[0].cloudPath, cloudPath);
  assert.deepEqual(f.uploads[0].fileContent, png);
  assert.equal(saved.avatarFileID, 'cloud://environment.bucket/' + cloudPath);
  assert.equal(saved.avatarUrl.startsWith('https://'), true);
  assert.equal(saved.avatarUnavailable, false);
  assert.deepEqual(f.signatures, [{ fileList: [{ fileID: saved.avatarFileID, maxAge: 600 }] }]);
  assert.deepEqual(ok(await f.get()), saved);
  assert.equal(f.db.records()[0].avatarUrl, undefined, 'expiring URLs are not persisted');
  assert.equal(f.db.records()[0].avatarBase64, undefined, 'image bytes are not persisted in the database');
});

test('supported image signatures select JPG and WebP extensions', async () => {
  for (const [bytes, extension] of [[Buffer.from([255, 216, 255, 224, 0, 0]), 'jpg'], [Buffer.from('RIFF0000WEBPVP8 '), 'webp']]) {
    const f = fixture();
    const saved = ok(await f.save({ nickname: '小明', avatarBase64: bytes.toString('base64') }));
    assert.equal(saved.avatarFileID.endsWith('.' + extension), true);
  }
});

test('avatars enforce 512 KB decoded limit and canonical base64 of supported image types', async () => {
  const tooLarge = Buffer.alloc(MAX_AVATAR_BYTES + 1);
  png.copy(tooLarge);
  for (const avatarBase64 of ['', null, 123, 'not-base64', png.toString('base64') + '\n', tooLarge.toString('base64'), Buffer.from('GIF89a').toString('base64'), Buffer.from('<svg></svg>').toString('base64')]) {
    const f = fixture();
    error(await f.save({ nickname: '小明', avatarBase64 }), 'INVALID_AVATAR');
    assert.deepEqual(f.db.snapshot(), []);
    assert.deepEqual(f.uploads, []);
  }
  const f = fixture();
  const boundary = Buffer.alloc(MAX_AVATAR_BYTES);
  png.copy(boundary);
  ok(await f.save({ nickname: '小明', avatarBase64: boundary.toString('base64') }));
  assert.equal(f.uploads[0].fileContent.length, MAX_AVATAR_BYTES);
});

test('an upload failure leaves profile and receipt untouched and hides SDK diagnostics', async () => {
  const f = fixture();
  const initial = ok(await f.save({ nickname: '原昵称' }));
  const before = f.db.snapshot();
  f.state.uploadFails = true;
  const response = await f.save({ nickname: '新昵称', avatarBase64: png.toString('base64') }, { expectedVersion: 1 });
  error(response, 'INTERNAL_ERROR');
  assert.deepEqual(f.db.snapshot(), before);
  assert.deepEqual(ok(await f.get()), initial);
  assert.equal(JSON.stringify(response).includes('private'), false);
  assert.equal(JSON.stringify(f.logs).includes('private'), false);
});

test('invalid upload responses cannot persist or sign an arbitrary file ID', async () => {
  for (const fileID of ['https://images.example/photo.png', 'cloud://other/avatars/other-owner/photo.png', 'cloud://environment.bucket/arbitrary.png']) {
    const f = fixture();
    f.state.uploadResult = { fileID };
    error(await f.save({ nickname: '小明', avatarBase64: png.toString('base64') }), 'AVATAR_UPLOAD_FAILED');
    assert.deepEqual(f.db.snapshot(), []);
    assert.deepEqual(f.signatures, []);
  }
});

test('failed receipt write rolls back the entire profile change and retains immutable uploaded files', async () => {
  const f = fixture();
  const initial = ok(await f.save({ nickname: '原昵称' }));
  const before = f.db.snapshot();
  f.db.state.failReceipt = true;
  error(await f.save({ nickname: '新昵称', avatarBase64: png.toString('base64') }, { expectedVersion: 1 }), 'INTERNAL_ERROR');
  assert.deepEqual(f.db.snapshot(), before);
  assert.deepEqual(ok(await f.get()), initial);
  assert.equal(f.stored.size, 1);
  assert.deepEqual(f.deleted, [], 'failure cannot prove that no commit used the uploaded content');
});

test('a lost transaction response retains the committed avatar and retry recovers without a second write', async () => {
  const f = fixture();
  const request = event({ nickname: '小明', avatarBase64: png.toString('base64') });
  f.db.state.failAfterCommit = true;
  error(await f.api(request), 'INTERNAL_ERROR');
  assert.equal(f.db.records().length, 1);
  assert.equal(f.db.snapshot().length, 2);
  assert.deepEqual(f.deleted, []);
  f.db.state.failAfterCommit = false;
  const recovered = ok(await f.api(request));
  assert.equal(recovered.version, 1);
  assert.equal(f.stored.has(recovered.avatarFileID), true);
  assert.equal(f.uploads.length, 1);
  assert.equal(f.db.stats.transactions, 1);
});

test('repeating the same request is idempotent, including late retries after later edits', async () => {
  const f = fixture();
  const request = event({ nickname: '初始', avatarBase64: png.toString('base64') });
  const initial = ok(await f.api(request));
  assert.deepEqual(ok(await f.api(request)), initial);
  const before = f.db.snapshot();
  error(await f.api({ ...request, profile: { ...request.profile, nickname: '改写' } }), 'REQUEST_CONFLICT');
  assert.deepEqual(f.db.snapshot(), before);
  f.state.now = new Date('2026-09-30T05:00:00Z');
  const latest = ok(await f.save({ nickname: '最新' }, { expectedVersion: 1 }));
  assert.equal(latest.avatarFileID, initial.avatarFileID);
  assert.equal(latest.version, 2);
  assert.deepEqual(ok(await f.api(request)), latest, 'an old receipt must not restore old nickname or avatar');
  assert.equal(f.uploads.length, 1);
  assert.equal(f.db.stats.transactions, 2);
  assert.equal(f.db.records()[0].createdAt, '2026-09-30T04:00:00.000Z');
  assert.equal(f.db.records()[0].updatedAt, '2026-09-30T05:00:00.000Z');
});

test('concurrent retries share one profile version and one receipt', async () => {
  const f = fixture();
  const request = event({ nickname: '小明', avatarBase64: png.toString('base64') });
  const responses = await Promise.all([f.api(request), f.api(request)]);
  assert.deepEqual(ok(responses[0]), ok(responses[1]));
  assert.equal(f.db.records()[0].version, 1);
  assert.equal(f.db.snapshot().length, 2);
  assert.equal(f.stored.size, 1, 'duplicate uploads resolve to the same immutable content path');
});

test('stale versions fail before upload and competing transactions cannot overwrite the winner', async () => {
  const f = fixture();
  const initial = ok(await f.save({ nickname: '初始' }));
  error(await f.save({ nickname: '过期', avatarBase64: png.toString('base64') }), 'VERSION_CONFLICT');
  assert.deepEqual(f.uploads, []);
  assert.deepEqual(ok(await f.get()), initial);
  const responses = await Promise.all([
    f.save({ nickname: '修改甲' }, { expectedVersion: 1 }),
    f.save({ nickname: '修改乙' }, { expectedVersion: 1 })
  ]);
  assert.equal(responses.filter(response => response.ok).length, 1);
  error(responses.find(response => !response.ok), 'VERSION_CONFLICT');
  assert.equal(ok(await f.get()).version, 2);
  assert.equal(f.db.snapshot().length, 3);
});

test('a version change after upload is rechecked inside the transaction and never deletes a file', async () => {
  const f = fixture();
  f.db.state.beforeTransaction = () => f.db.seed(profileId('owner-one'), { nickname: '并发更新', avatarFileID: '', version: 1, _owner: 'owner-one', _kind: 'profile' });
  error(await f.save({ nickname: '过期提交', avatarBase64: png.toString('base64') }), 'VERSION_CONFLICT');
  assert.equal(ok(await f.get()).nickname, '并发更新');
  assert.equal(f.db.snapshot().length, 1, 'the rejected change creates no receipt');
  assert.equal(f.uploads.length, 1);
  assert.deepEqual(f.deleted, []);
});

test('signature failure after a committed save remains success with an unavailable avatar marker', async () => {
  const f = fixture();
  f.state.signFails = true;
  const saved = ok(await f.save({ nickname: '小明', avatarBase64: png.toString('base64') }));
  assert.equal(saved.version, 1);
  assert.equal(saved.avatarUrl, '');
  assert.equal(saved.avatarUnavailable, true);
  assert.equal(f.db.records()[0].nickname, '小明');
  assert.deepEqual(f.logs, [{ code: 'AVATAR_UNAVAILABLE' }]);
  f.state.signFails = false;
  const restored = ok(await f.get());
  assert.equal(restored.version, 1);
  assert.equal(restored.avatarUnavailable, false);
  assert.equal(restored.avatarUrl.startsWith('https://'), true);
});

test('failed or insecure signed URL results remain unavailable without undoing a save', async () => {
  for (const change of [{ status: -1 }, { code: 'FAIL' }, { tempFileURL: 'http://insecure.example/avatar' }, { fileID: 'cloud://unrelated/file' }]) {
    const f = fixture();
    const fileID = 'cloud://environment.bucket/avatars/' + hash('owner-one') + '/' + hash(png) + '.png';
    f.state.signResult = { fileList: [{ fileID, status: 0, tempFileURL: 'https://images.example/avatar', ...change }] };
    const saved = ok(await f.save({ nickname: '小明', avatarBase64: png.toString('base64') }));
    assert.equal(saved.avatarUnavailable, true);
    assert.equal(saved.avatarUrl, '');
    assert.equal(f.db.records()[0].version, 1);
  }
});

test('getProfile refuses to sign any stored avatar outside the authenticated user content path', async () => {
  for (const avatarFileID of [
    'cloud://environment.bucket/avatars/' + hash('owner-two') + '/' + hash(png) + '.png',
    'cloud://environment.bucket/avatars/' + hash('owner-one') + '/arbitrary.png',
    'cloud://environment.bucket/avatars/' + hash('owner-one') + '/' + hash(png) + '.svg',
    'https://external.example/avatar.png'
  ]) {
    const f = fixture();
    f.db.seed(profileId('owner-one'), { nickname: '小明', avatarFileID, version: 1, _owner: 'owner-one', _kind: 'profile' });
    error(await f.get(), 'FORBIDDEN');
    assert.deepEqual(f.signatures, []);
  }
});
