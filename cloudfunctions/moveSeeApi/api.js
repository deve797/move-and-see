const crypto = require('crypto');
const { ApiError, ensure, identifier, planFields, dayFields, checkPlan, checkDay, stable } = require('./validation');
const APPID = 'wx2c23ae79d174802d';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const documentId = (owner, id) => 'd_' + hash(owner + '\n' + id);
function publicRecord(document) {
  const { _id, _owner, _kind, ...record } = document;
  return record;
}
function createApi({ db, getIdentity, getOwner, now, logError = value => console.error(JSON.stringify(value)) }) {
  return async event => {
    try {
      const identity = getIdentity() || {};
      ensure(typeof identity.OPENID === 'string' && identity.OPENID.length > 0, 'AUTH_REQUIRED', '请从微信小程序打开');
      ensure(identity.APPID === APPID, 'APP_MISMATCH', '小程序身份不匹配');
      ensure(event && typeof event === 'object' && !Array.isArray(event));
      if (event.action === 'whoami') return { ok: true, data: { openid: identity.OPENID, appid: identity.APPID } };
      const owner = getOwner();
      ensure(typeof owner === 'string' && owner.length > 0, 'OWNER_NOT_CONFIGURED', '尚未配置本人账号');
      ensure(identity.OPENID === owner, 'FORBIDDEN', '仅本人账号可以使用');
      if (event.action === 'list') {
        ensure(['plans', 'day_marks'].includes(event.collection));
        ensure(event.cursor === undefined || event.cursor === '' || /^d_[a-f0-9]{64}$/.test(event.cursor));
        const query = { _owner: owner, _kind: 'record' };
        if (event.cursor) query._id = db.command.gt(event.cursor);
        const result = await db.collection(event.collection).where(query).orderBy('_id', 'asc').limit(100).get();
        return { ok: true, data: { items: result.data.map(publicRecord), nextCursor: result.data.length === 100 ? result.data[99]._id : '' } };
      }
      ensure(['savePlan', 'saveDay'].includes(event.action));
      const isPlan = event.action === 'savePlan';
      const next = isPlan ? planFields(event.plan) : dayFields(event.day);
      const collection = isPlan ? 'plans' : 'day_marks';
      const id = documentId(owner, isPlan ? next.id : next.date);
      const requestId = identifier(event.requestId);
      ensure(Number.isInteger(event.expectedVersion) && event.expectedVersion >= 0);
      const expectedDayVersion = event.expectedDayVersion === undefined ? 0 : event.expectedDayVersion;
      ensure(Number.isInteger(expectedDayVersion) && expectedDayVersion >= 0);
      const payloadHash = hash(stable({ action: event.action, next, expectedVersion: event.expectedVersion, expectedDayVersion }));
      // Receipts share the collection but never appear in business queries.
      const receiptId = 'r_' + hash(owner + '\n' + requestId);
      const saved = await db.runTransaction(async transaction => {
        const reference = transaction.collection(collection).doc(id);
        const receiptReference = transaction.collection(collection).doc(receiptId);
        const previous = (await reference.get()).data;
        const receipt = (await receiptReference.get()).data;
        ensure(!previous || (previous._owner === owner && previous._kind === 'record'), 'FORBIDDEN', '记录归属不匹配');
        if (receipt) {
          ensure(receipt._owner === owner && receipt.payloadHash === payloadHash && receipt.documentId === id, 'REQUEST_CONFLICT', '请勿复用已提交的请求编号');
          ensure(Boolean(previous), 'INTERNAL_ERROR', '记录暂时无法读取，请稍后重试');
          return publicRecord(previous);
        }
        ensure((previous ? previous.version : 0) === event.expectedVersion, 'VERSION_CONFLICT', '记录已更新，请刷新后重试');
        const currentTime = now();
        if (isPlan) {
          const day = (await transaction.collection('day_marks').doc(documentId(owner, next.date)).get()).data;
          ensure(!day || (day._owner === owner && day._kind === 'record'), 'FORBIDDEN', '记录归属不匹配');
          ensure((day ? day.version : 0) === expectedDayVersion, 'DAY_VERSION_CONFLICT', '当天标记已变化，请刷新后重试');
          checkPlan(next, previous, day, currentTime);
        } else checkDay(next, previous, currentTime);
        const timestamp = currentTime.toISOString();
        const document = { ...next, version: event.expectedVersion + 1, createdAt: previous ? previous.createdAt : timestamp, updatedAt: timestamp, _owner: owner, _kind: 'record' };
        await reference.set({ data: document });
        await receiptReference.set({ data: { _owner: owner, _kind: 'request', documentId: id, payloadHash, createdAt: timestamp } });
        return publicRecord(document);
      });
      return { ok: true, data: saved };
    } catch (error) {
      if (!(error instanceof ApiError)) {
        const requestId = event && typeof event.requestId === 'string' ? hash(event.requestId).slice(0, 16) : 'unavailable';
        logError({ code: 'INTERNAL_ERROR', requestId });
      }
      return error instanceof ApiError
        ? { ok: false, code: error.code, message: error.message }
        : { ok: false, code: 'INTERNAL_ERROR', message: '暂时无法连接云端，请稍后重试' };
    }
  };
}
module.exports = { createApi, documentId, APPID };
