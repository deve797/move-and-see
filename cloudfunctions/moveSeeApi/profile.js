const crypto = require('crypto');
const { ensure, identifier, stable } = require('./validation');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const profileId = owner => 'p_' + hash(owner);
const MAX_AVATAR_BYTES = 512 * 1024;

function avatarImage(value) {
  ensure(typeof value === 'string' && value.length > 0 && value.length <= Math.ceil(MAX_AVATAR_BYTES / 3) * 4,
    'INVALID_AVATAR', '请选择不超过 512 KB 的头像');
  const buffer = Buffer.from(value, 'base64');
  ensure(buffer.length <= MAX_AVATAR_BYTES && buffer.toString('base64') === value, 'INVALID_AVATAR', '头像读取失败，请重新选择');
  let extension;
  if (buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) extension = 'jpg';
  else if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) extension = 'png';
  else if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') extension = 'webp';
  ensure(extension, 'INVALID_AVATAR', '请选择 JPG、PNG 或 WebP 图片');
  return { buffer, extension };
}

function checkOwner(document, owner, kind = 'profile') {
  ensure(!document || (document._owner === owner && document._kind === kind), 'FORBIDDEN', '资料归属不匹配');
}

async function presentProfile(document, owner, files, logError) {
  checkOwner(document, owner);
  const result = {
    nickname: document ? document.nickname : '',
    avatarFileID: document ? document.avatarFileID : '',
    avatarUrl: '', avatarUnavailable: false,
    version: document ? document.version : 0
  };
  if (result.avatarFileID) {
    const expectedPath = new RegExp('^cloud://[^/]+/avatars/' + hash(owner) + '/[a-f0-9]{64}\\.(jpg|png|webp)$');
    ensure(expectedPath.test(result.avatarFileID), 'FORBIDDEN', '头像归属不匹配');
    try {
      const response = await files.getTempFileURL({ fileList: [{ fileID: result.avatarFileID, maxAge: 600 }] });
      const file = response.fileList && response.fileList.find(item => item.fileID === result.avatarFileID);
      ensure(file && (!file.status || file.status === 0) && (!file.code || file.code === 'SUCCESS') && /^https:\/\//.test(file.tempFileURL), 'AVATAR_UNAVAILABLE', '头像暂未加载');
      result.avatarUrl = file.tempFileURL;
    } catch (_) {
      result.avatarUnavailable = true;
      logError({ code: 'AVATAR_UNAVAILABLE' });
    }
  }
  return result;
}

async function profileAction({ event, owner, db, files, now, logError }) {
  const id = profileId(owner);
  const reference = db.collection('profiles').doc(id);
  if (event.action === 'getProfile') {
    return presentProfile((await reference.get()).data, owner, files, logError);
  }
  const source = event.profile;
  ensure(source && typeof source === 'object' && !Array.isArray(source) && Object.keys(source).every(key => ['nickname', 'avatarBase64'].includes(key)));
  ensure(typeof source.nickname === 'string', 'INVALID_NICKNAME', '请填写昵称');
  const nickname = source.nickname.trim();
  ensure([...nickname].length >= 1 && [...nickname].length <= 20 && !/[\x00-\x1f\x7f]/.test(nickname), 'INVALID_NICKNAME', '昵称请填写 1–20 个字');
  const avatar = source.avatarBase64 === undefined ? null : avatarImage(source.avatarBase64);
  ensure(Number.isInteger(event.expectedVersion) && event.expectedVersion >= 0);
  const requestId = identifier(event.requestId);
  const payloadHash = hash(stable({ nickname, avatar: avatar ? hash(avatar.buffer) : null, expectedVersion: event.expectedVersion }));
  const receiptId = 'r_' + hash(owner + '\n' + requestId);
  function checkReceipt(receipt, previous) {
    checkOwner(previous, owner);
    checkOwner(receipt, owner, 'request');
    if (!receipt) return false;
    ensure(receipt.payloadHash === payloadHash && receipt.documentId === id, 'REQUEST_CONFLICT', '请勿复用已提交的请求编号');
    ensure(previous, 'INTERNAL_ERROR', '资料暂时无法读取，请稍后重试');
    return true;
  }
  const [currentResult, receiptResult] = await Promise.all([reference.get(), db.collection('profiles').doc(receiptId).get()]);
  const current = currentResult.data;
  if (checkReceipt(receiptResult.data, current)) return presentProfile(current, owner, files, logError);
  ensure((current ? current.version : 0) === event.expectedVersion, 'VERSION_CONFLICT', '资料已更新，请重新读取后再修改');
  let avatarFileID = current ? current.avatarFileID : '';
  if (avatar) {
    const cloudPath = 'avatars/' + hash(owner) + '/' + hash(avatar.buffer) + '.' + avatar.extension;
    const uploaded = await files.uploadFile({ cloudPath, fileContent: avatar.buffer });
    ensure(uploaded && typeof uploaded.fileID === 'string' && uploaded.fileID.startsWith('cloud://') && uploaded.fileID.endsWith('/' + cloudPath), 'AVATAR_UPLOAD_FAILED', '头像未能保存，请重试');
    avatarFileID = uploaded.fileID;
  }
  const saved = await db.runTransaction(async transaction => {
    const target = transaction.collection('profiles').doc(id);
    const receiptTarget = transaction.collection('profiles').doc(receiptId);
    const previous = (await target.get()).data;
    const receipt = (await receiptTarget.get()).data;
    if (checkReceipt(receipt, previous)) return previous;
    ensure((previous ? previous.version : 0) === event.expectedVersion, 'VERSION_CONFLICT', '资料已更新，请重新读取后再修改');
    const timestamp = now().toISOString();
    const document = {
      nickname, avatarFileID, version: event.expectedVersion + 1,
      createdAt: previous ? previous.createdAt : timestamp, updatedAt: timestamp,
      _owner: owner, _kind: 'profile'
    };
    await target.set({ data: document });
    await receiptTarget.set({ data: { _owner: owner, _kind: 'request', documentId: id, payloadHash, createdAt: timestamp } });
    return document;
  });
  // Keep immutable files on an ambiguous database failure: deleting them could
  // break an already committed profile. Retries reuse the same content path.
  return presentProfile(saved, owner, files, logError);
}

module.exports = { profileAction, profileId, MAX_AVATAR_BYTES };
