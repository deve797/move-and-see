function createProfileStore(cloud, state, env) {
  let queue = Promise.resolve();
  let loading;
  const requests = new Map();
  const pending = new Map();

  function serial(work) {
    const result = queue.then(work);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }
  async function call(data) {
    let response;
    try {
      response = await cloud.callFunction({ name: 'moveSeeApi', config: { env }, data });
    } catch (cause) {
      const error = new Error('未能确认资料的保存或读取结果，请检查网络后重试');
      error.code = 'NETWORK';
      throw error;
    }
    const result = response.result;
    if (!result || !result.ok) {
      const error = new Error(result && result.message || '资料请求失败，请稍后重试');
      error.code = result && result.code || 'SERVER';
      throw error;
    }
    return result.data;
  }
  function loadProfile() {
    if (loading) return loading;
    loading = serial(async () => {
      try {
        const profile = await call({ action: 'getProfile' });
        state.profile = profile;
        state.profileLoaded = true;
        return profile;
      } catch (error) {
        state.profileLoaded = false;
        throw error;
      } finally {
        loading = null;
      }
    });
    return loading;
  }
  function saveProfile(proposed, expectedVersion) {
    const profile = { nickname: proposed.nickname.trim() };
    if (proposed.avatarBase64 !== undefined) profile.avatarBase64 = proposed.avatarBase64;
    const payload = { profile, expectedVersion };
    const key = JSON.stringify(payload);
    if (pending.has(key)) return pending.get(key);
    if (!requests.has(key)) requests.set(key, Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12));
    const requestId = requests.get(key);
    const saving = serial(async () => {
      try {
        if (!state.profileLoaded) throw new Error('请先成功读取个人资料，再保存');
        const saved = await call({ action: 'saveProfile', ...payload, requestId });
        state.profile = saved;
        requests.delete(key);
        return saved;
      } finally {
        pending.delete(key);
      }
    });
    pending.set(key, saving);
    return saving;
  }
  return { loadProfile, saveProfile };
}

module.exports = createProfileStore;
