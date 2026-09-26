function createCloudStore(cloud, state, env) {
  let queue = Promise.resolve();
  let loading;
  const requests = new Map();

  function newId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
  }
  function serial(work) {
    const result = queue.then(work);
    // Keep later requests usable after a failed request; the caller still receives the rejection.
    queue = result.then(() => undefined, () => undefined);
    return result;
  }
  async function call(data) {
    let response;
    try {
      response = await cloud.callFunction({ name: 'moveSeeApi', config: { env }, data });
    } catch (cause) {
      const error = new Error('未能确认云端保存或读取结果，请检查网络后重试');
      error.code = 'NETWORK';
      throw error;
    }
    const result = response.result;
    if (!result || !result.ok) {
      const error = new Error(result && result.message || '云端请求失败，请稍后重试');
      error.code = result && result.code || 'SERVER';
      throw error;
    }
    return result.data;
  }
  async function readAll(collection) {
    const items = [];
    let cursor = '';
    do {
      const page = await call({ action: 'list', collection, cursor });
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  }
  function loadData() {
    if (loading) return loading;
    state.cloudLoading = true;
    loading = serial(async () => {
      try {
        const plans = await readAll('plans');
        const days = await readAll('day_marks');
        const periodDays = {};
        const periodWalks = {};
        const dayVersions = {};
        days.forEach(day => {
          if (day.periodMarked) periodDays[day.date] = true;
          if (day.periodWalk) periodWalks[day.date] = day.periodWalk;
          dayVersions[day.date] = day.version;
        });
        // Publish the entire successful read together; partial results never erase cached records.
        state.plans.splice(0, state.plans.length, ...plans);
        Object.assign(state, { periodDays, periodWalks, dayVersions, cloudLoaded: true, cloudError: '' });
        return state;
      } catch (error) {
        state.cloudError = error.message;
        throw error;
      } finally {
        state.cloudLoading = false;
        loading = null;
      }
    });
    return loading;
  }
  function getDay(date) {
    const day = {
      date, periodMarked: state.periodDays[date] === true,
      version: state.dayVersions[date] || 0
    };
    if (state.periodWalks[date]) day.periodWalk = { ...state.periodWalks[date] };
    return day;
  }
  function save(action, payload) {
    const key = JSON.stringify({ action, ...payload });
    if (!requests.has(key)) requests.set(key, newId());
    const requestId = requests.get(key);
    return serial(async () => {
      if (!state.cloudLoaded) throw new Error('请先成功加载云端记录，再保存');
      const saved = await call({ action, ...payload, requestId });
      if (action === 'savePlan') {
        const index = state.plans.findIndex(plan => String(plan.id) === String(saved.id));
        if (index < 0) state.plans.push(saved);
        else state.plans.splice(index, 1, saved);
      } else {
        if (saved.periodMarked) state.periodDays[saved.date] = true;
        else delete state.periodDays[saved.date];
        if (saved.periodWalk) state.periodWalks[saved.date] = saved.periodWalk;
        else delete state.periodWalks[saved.date];
        state.dayVersions[saved.date] = saved.version;
      }
      requests.delete(key);
      return saved;
    });
  }
  function savePlan(proposed) {
    const plan = JSON.parse(JSON.stringify(proposed));
    const expectedDayVersion = plan._dayVersion === undefined ? state.dayVersions[plan.date] || 0 : plan._dayVersion;
    delete plan._dayVersion;
    return save('savePlan', { plan, expectedVersion: plan.version || 0, expectedDayVersion });
  }
  function saveDay(proposed) {
    const day = JSON.parse(JSON.stringify(proposed));
    return save('saveDay', { day, expectedVersion: day.version || 0 });
  }
  return { loadData, savePlan, saveDay, getDay, newPlanId: newId };
}

module.exports = createCloudStore;
