const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

const empty = extra => ({ nickname: '', avatarFileID: '', avatarUrl: '', avatarUnavailable: false, version: 0, ...extra });
const clone = value => JSON.parse(JSON.stringify(value));
const input = value => ({ detail: { value } });
function appWith(profile = empty()) {
  return {
    profile, loads: 0, saves: [],
    async loadProfile() { this.loads += 1; return clone(this.profile); },
    async saveProfile(proposed, version) {
      this.saves.push({ profile: clone(proposed), version });
      if (version !== this.profile.version) throw Object.assign(new Error('资料已更新，请重新读取'), { code: 'VERSION_CONFLICT' });
      this.profile = { ...this.profile, nickname: proposed.nickname, version: version + 1 };
      if (proposed.avatarBase64) Object.assign(this.profile, { avatarFileID: 'cloud://own', avatarUrl: 'https://signed/own' });
      return clone(this.profile);
    }
  };
}
async function mount(app = appWith(), overrides = {}) {
  const file = path.resolve(__dirname, '../miniprogram/pages/profile/index.js');
  let definition;
  const modals = [];
  const toasts = [];
  const wx = {
    showModal(options) { modals.push(options); }, showToast(options) { toasts.push(options); },
    getFileSystemManager() { return { getFileInfo(options) { options.success({ size: 100 }); }, readFile(options) { options.success({ data: 'aW1hZ2U=' }); } }; },
    ...overrides
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { require: createRequire(file), getApp: () => app, wx, Page(value) { definition = value; } });
  const page = Object.assign({}, definition, { data: clone(definition.data), modals, toasts, setData(value) { Object.assign(this.data, value); } });
  await page.onShow();
  return page;
}

test('an unset profile opens with a default avatar and requires a nonempty nickname', async () => {
  const app = appWith();
  const page = await mount(app);
  assert.equal(page.data.profile.nickname, '');
  page.startEditing();
  page.inputNickname(input('   '));
  await page.confirmProfile();
  assert.equal(page.data.canSave, false);
  assert.equal(app.saves.length, 0);
  page.inputNickname(input('🏃'.repeat(20)));
  assert.equal(page.data.nicknameCount, 20);
  assert.equal(page.data.canSave, true);
  page.inputNickname(input('🏃'.repeat(21)));
  assert.equal(page.data.canSave, false);
});

test('save failure preserves draft and saved profile, duplicate taps are blocked, retry succeeds', async () => {
  const app = appWith(empty({ nickname: '原昵称', version: 2 }));
  const page = await mount(app);
  page.startEditing();
  page.inputNickname(input('  新昵称  '));
  const save = app.saveProfile.bind(app);
  let reject;
  let calls = 0;
  app.saveProfile = () => { calls += 1; return new Promise((resolve, fail) => { reject = fail; }); };
  const saving = page.confirmProfile();
  await page.confirmProfile();
  assert.equal(calls, 1);
  assert.equal(page.data.saving, true);
  assert.equal(page.data.profile.nickname, '原昵称');
  reject(new Error('网络暂时不可用'));
  await saving;
  assert.equal(page.data.editing, true);
  assert.equal(page.data.draftNickname, '  新昵称  ');
  assert.match(page.data.saveError, /网络/);
  assert.equal(page.toasts.length, 0);
  app.saveProfile = save;
  await page.confirmProfile();
  assert.equal(page.data.editing, false);
  assert.equal(page.data.profile.nickname, '新昵称');
  assert.equal(page.data.profile.version, 3);
  assert.equal(page.toasts[0].title, '资料已保存');
});

test('returning to an editing page preserves its draft and original version', async () => {
  const app = appWith(empty({ nickname: '原昵称', version: 1 }));
  const page = await mount(app);
  page.startEditing();
  page.inputNickname(input('尚未保存'));
  app.profile = empty({ nickname: '另一端', version: 2 });
  await page.onShow();
  assert.equal(app.loads, 1);
  assert.equal(page.data.draftNickname, '尚未保存');
  await page.confirmProfile();
  assert.equal(page.data.saveConflict, true);
  assert.equal(app.saves[0].version, 1);
  await page.onShow();
  assert.equal(page.data.saveConflict, true);
});

test('conflict recovery discards only after confirmation and reloads the latest profile', async () => {
  const app = appWith(empty({ nickname: '原昵称', version: 1 }));
  const page = await mount(app);
  page.startEditing();
  page.inputNickname(input('未保存'));
  app.profile = empty({ nickname: '最新昵称', version: 2 });
  await page.confirmProfile();
  page.reloadAfterConflict();
  await page.modals.pop().success({ confirm: false });
  assert.equal(page.data.draftNickname, '未保存');
  assert.equal(app.loads, 1);
  page.reloadAfterConflict();
  await page.modals.pop().success({ confirm: true });
  assert.equal(page.data.editing, false);
  assert.equal(page.data.profile.nickname, '最新昵称');
  assert.equal(page.data.saveConflict, false);
  assert.equal(app.loads, 2);
});

test('load failure cannot create a profile and successful retry enables editing', async () => {
  const app = appWith();
  const load = app.loadProfile.bind(app);
  app.loadProfile = async () => { throw new Error('暂时无法读取资料'); };
  const page = await mount(app);
  page.startEditing();
  await page.confirmProfile();
  assert.equal(page.data.editing, false);
  assert.match(page.data.loadError, /读取/);
  assert.equal(app.saves.length, 0);
  app.loadProfile = load;
  await page.retryLoad();
  page.startEditing();
  assert.equal(page.data.loadError, '');
  assert.equal(page.data.editing, true);
});

test('avatar selection stays local until save, cancel clears it without any writes', async () => {
  const app = appWith(empty({ nickname: '原昵称', version: 1 }));
  const page = await mount(app);
  page.startEditing();
  await page.chooseAvatar({ detail: { avatarUrl: 'wxfile://avatar' } });
  assert.equal(page.data.draftAvatarUrl, 'wxfile://avatar');
  assert.equal(page.data.profile.avatarUrl, '');
  assert.equal(page._avatarBase64, 'aW1hZ2U=');
  assert.equal(JSON.stringify(page.data).includes('aW1hZ2U='), false);
  page.cancelEditing();
  assert.equal(page._avatarBase64, undefined);
  assert.equal(page.data.editing, false);
  assert.equal(app.saves.length, 0);
});

test('avatar read failure retains previous selection and saving waits until reading finishes', async () => {
  const app = appWith(empty({ nickname: '原昵称', version: 1 }));
  let info;
  const page = await mount(app, { getFileSystemManager: () => ({ getFileInfo(options) { info = options; } }) });
  page.startEditing();
  page.inputNickname(input('新昵称'));
  const reading = page.chooseAvatar({ detail: { avatarUrl: 'wxfile://avatar' } });
  await page.confirmProfile();
  assert.equal(app.saves.length, 0);
  assert.equal(page.data.avatarReading, true);
  info.fail({ errMsg: 'unreadable' });
  await reading;
  assert.match(page.data.avatarError, /重新选择/);
  assert.equal(page.data.draftAvatarUrl, '');
  assert.equal(page.data.avatarReading, false);
  assert.equal(page.data.draftNickname, '新昵称');
});

test('large avatars are compressed once and still-oversized files are not read or submitted', async () => {
  const app = appWith(empty({ nickname: '原昵称', version: 1 }));
  let compressions = 0;
  let reads = 0;
  const page = await mount(app, {
    getFileSystemManager: () => ({ getFileInfo(options) { options.success({ size: 600 * 1024 }); }, readFile() { reads += 1; } }),
    compressImage(options) { compressions += 1; assert.equal(options.compressedWidth, 256); options.success({ tempFilePath: 'wxfile://compressed' }); }
  });
  page.startEditing();
  await page.chooseAvatar({ detail: { avatarUrl: 'wxfile://large' } });
  assert.equal(compressions, 1);
  assert.equal(reads, 0);
  assert.match(page.data.avatarError, /512 KB/);
  assert.equal(page._avatarBase64, undefined);
});

test('a compressed avatar is sent with the nickname and preview changes only after confirmed save', async () => {
  const app = appWith(empty({ nickname: '原昵称', version: 1 }));
  const page = await mount(app, {
    getFileSystemManager: () => ({ getFileInfo(options) { options.success({ size: options.filePath === 'wxfile://large' ? 600 * 1024 : 100 }); }, readFile(options) { assert.equal(options.filePath, 'wxfile://compressed'); assert.equal(options.encoding, 'base64'); options.success({ data: 'aW1hZ2U=' }); } }),
    compressImage(options) { options.success({ tempFilePath: 'wxfile://compressed' }); }
  });
  page.startEditing();
  await page.chooseAvatar({ detail: { avatarUrl: 'wxfile://large' } });
  assert.equal(page.data.draftAvatarUrl, 'wxfile://compressed');
  await page.confirmProfile();
  assert.deepEqual(app.saves[0], { profile: { nickname: '原昵称', avatarBase64: 'aW1hZ2U=' }, version: 1 });
  assert.equal(page.data.profile.avatarUrl, 'https://signed/own');
  assert.equal(page._avatarBase64, undefined);
});

test('avatar URL failure retains saved nickname and retry refreshes the temporary URL', async () => {
  const app = appWith(empty({ nickname: '已保存', avatarFileID: 'cloud://own', avatarUnavailable: true, version: 2 }));
  const page = await mount(app);
  assert.equal(page.data.profile.nickname, '已保存');
  assert.equal(page.data.profile.avatarUnavailable, true);
  app.profile.avatarUnavailable = false;
  app.profile.avatarUrl = 'https://signed/refreshed';
  await page.retryLoad();
  assert.equal(page.data.profile.avatarUrl, 'https://signed/refreshed');
  page.onAvatarError();
  assert.equal(page.data.avatarFailed, true);
  await page.retryLoad();
  assert.equal(page.data.avatarFailed, false);
});

test('nickname blur synchronizes the value provided by the native nickname control', async () => {
  const app = appWith();
  const page = await mount(app);
  page.startEditing();
  page.focusNickname();
  page.blurNickname(input('微信昵称'));
  assert.equal(page.data.nicknameFocused, false);
  await page.confirmProfile();
  assert.equal(app.profile.nickname, '微信昵称');
});

test('form submission uses the native value and refuses a nickname cleared by the platform', async () => {
  const app = appWith();
  const page = await mount(app);
  page.startEditing();
  page.inputNickname(input('缓存中的昵称'));
  await page.submitProfile({ detail: { value: { nickname: '' } } });
  assert.equal(app.saves.length, 0);
  assert.equal(page.data.draftNickname, '');
  assert.match(page.data.nicknameError, /填写昵称/);
  page.inputNickname(input('新昵称'));
  await page.submitProfile({ detail: { value: { nickname: '原生最终值' } } });
  assert.equal(app.profile.nickname, '原生最终值');
});

test('native nickname rejection and timeout prevent saving until the nickname is corrected', async () => {
  const app = appWith();
  const page = await mount(app);
  page.startEditing();
  page.inputNickname(input('未通过的昵称'));
  page.onNicknameReview({ detail: { pass: false, timeout: false } });
  await page.submitProfile({ detail: { value: { nickname: '未通过的昵称' } } });
  await page.confirmProfile();
  assert.equal(app.saves.length, 0);
  assert.equal(page.data.canSave, false);
  assert.match(page.data.nicknameError, /未通过/);
  page.inputNickname(input('新昵称'));
  page.onNicknameReview({ detail: { pass: false, timeout: true } });
  assert.match(page.data.nicknameError, /暂未校验/);
  assert.equal(page.data.canSave, false);
  page.inputNickname(input('修正昵称'));
  page.onNicknameReview({ detail: { pass: true, timeout: false } });
  await page.submitProfile({ detail: { value: { nickname: '修正昵称' } } });
  assert.equal(app.profile.nickname, '修正昵称');
});
