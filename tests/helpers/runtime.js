const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

// Page tests use an isolated, asynchronous server double. Cloud persistence and
// transport contracts are tested separately in cloud-store.test.js.
function createTestApp(globalData = {}) {
  return prepareTestApp({ globalData });
}

function prepareTestApp(app) {
  if (app.loadData) return app;
  const data = app.globalData;
  data.plans ||= [];
  data.periodDays ||= {};
  data.periodWalks ||= {};
  data.dayVersions ||= {};
  let nextId = 0;
  let failure;
  function checkFailure() {
    if (!failure) return;
    const error = failure;
    failure = undefined;
    throw error;
  }
  function checkVersion(actual, expected, code = 'VERSION_CONFLICT') {
    if ((actual || 0) !== (expected || 0)) {
      const error = new Error('记录已更新，请刷新后重试');
      error.code = code;
      throw error;
    }
  }
  Object.assign(app, {
    rejectNext(error = new Error('网络暂时不可用')) { failure = error; },
    async loadData() { checkFailure(); return data; },
    newPlanId() {
      nextId = Math.max(nextId, ...data.plans.map(plan => Number(plan.id) || 0)) + 1;
      return String(nextId);
    },
    async savePlan(proposed) {
      checkFailure();
      const index = data.plans.findIndex(plan => String(plan.id) === String(proposed.id));
      checkVersion(index < 0 ? 0 : data.plans[index].version, proposed.version);
      if (proposed._dayVersion !== undefined) checkVersion(data.dayVersions[proposed.date], proposed._dayVersion, 'DAY_VERSION_CONFLICT');
      const saved = { ...clone(proposed), version: (proposed.version || 0) + 1 };
      delete saved._dayVersion;
      if (index < 0) data.plans.push(saved);
      else data.plans[index] = saved;
      return clone(saved);
    },
    getDay(date) {
      return {
        date, periodMarked: data.periodDays[date] === true,
        periodWalk: clone(data.periodWalks[date] || null),
        version: data.dayVersions[date] || 0
      };
    },
    async saveDay(proposed) {
      checkFailure();
      checkVersion(data.dayVersions[proposed.date], proposed.version);
      const saved = { ...clone(proposed), version: (proposed.version || 0) + 1 };
      if (saved.periodMarked) data.periodDays[saved.date] = true;
      else delete data.periodDays[saved.date];
      if (saved.periodWalk) data.periodWalks[saved.date] = clone(saved.periodWalk);
      else delete data.periodWalks[saved.date];
      data.dayVersions[saved.date] = saved.version;
      return clone(saved);
    }
  });
  return app;
}

module.exports = { createTestApp, prepareTestApp };
