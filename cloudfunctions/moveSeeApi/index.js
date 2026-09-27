const cloud = require('wx-server-sdk');
const { parseContext } = require('@cloudbase/node-sdk');
const { createApi } = require('./api');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });

exports.main = (event, context) => {
  let identity = {};
  try {
    // getWXContext reads process.env, which may retain the preceding caller's
    // identity on a warm instance. Only this invocation's context is trusted.
    const parsed = parseContext(context);
    const environment = parsed.environment || parsed.environ || {};
    identity = { OPENID: environment.WX_OPENID, APPID: environment.WX_APPID };
  } catch (_) {
    // Missing or malformed invocation context is unauthenticated; never fall back.
  }
  return createApi({
    db,
    getIdentity: () => identity,
    now: () => new Date()
  })(event);
};
