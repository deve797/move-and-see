const activities = ['瑜伽', '跑步', '力量训练', '徒步', '网球', '散步'];
const moods = ['', 'low', 'down', 'neutral', 'good', 'great'];
const reasons = ['', '加班', '下雨', '身体不适', '临时有事', '其他'];
const feelings = ['', '轻松', '适中', '吃力'];

class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function ensure(condition, code = 'INVALID_ARGUMENT', message = '填写内容不正确，请检查后重试') {
  if (!condition) throw new ApiError(code, message);
}
function object(value, keys) {
  ensure(value && typeof value === 'object' && !Array.isArray(value));
  ensure(Object.keys(value).every(key => keys.includes(key)));
}
function date(value) {
  ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value));
  const parsed = new Date(value + 'T00:00:00Z');
  ensure(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value);
  return value;
}
function today(now) { return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10); }
function identifier(value) {
  ensure(typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value));
  return value;
}
function choice(value, values) { ensure(values.includes(value)); return value; }
function text(value) { ensure(typeof value === 'string' && value.length <= 200); return value; }
function motionFields(source, target) {
  if (source.afterMood !== undefined) target.afterMood = choice(source.afterMood, moods);
  if (source.afterMoodNote !== undefined) target.afterMoodNote = text(source.afterMoodNote);
  if (source.feeling !== undefined) target.feeling = choice(source.feeling, feelings);
}
function runningData(source) {
  const fields = ['durationMinutes', 'distanceKm', 'heartRate'];
  object(source, fields);
  const result = {};
  fields.forEach(key => {
    const raw = source[key] === undefined ? '' : source[key];
    ensure(typeof raw === 'string' || typeof raw === 'number');
    const value = String(raw).trim();
    ensure(value === '' || (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) && Number.isFinite(Number(value))));
    result[key] = value;
  });
  return result;
}
function resultFields(source, activity) {
  object(source, ['status', 'reason', 'actualActivity', 'afterMood', 'afterMoodNote', 'feeling', 'runningData', 'makeup']);
  const status = choice(source.status, ['completed', 'incomplete', 'replacement']);
  const result = { status };
  if (status === 'completed') {
    ensure(source.reason === undefined && source.actualActivity === undefined && source.makeup === undefined);
    motionFields(source, result);
    if (source.runningData !== undefined) {
      ensure(activity === '跑步');
      result.runningData = runningData(source.runningData);
    }
  } else if (status === 'replacement') {
    object(source, ['status', 'actualActivity']);
    result.actualActivity = choice(source.actualActivity, activities);
  } else {
    object(source, ['status', 'reason', 'makeup']);
    result.reason = choice(source.reason === undefined ? '' : source.reason, reasons);
    if (source.makeup !== undefined) {
      object(source.makeup, ['date', 'actualActivity', 'afterMood', 'afterMoodNote', 'feeling']);
      result.makeup = { date: date(source.makeup.date), actualActivity: choice(source.makeup.actualActivity, activities) };
      motionFields(source.makeup, result.makeup);
    }
  }
  return result;
}
function planFields(source) {
  object(source, ['id', 'date', 'activity', 'startTime', 'cancelled', 'beforeMood', 'beforeMoodNote', 'result', 'version', 'createdAt', 'updatedAt', '_dayVersion']);
  ensure(typeof source.startTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(source.startTime));
  const plan = { id: identifier(source.id), date: date(source.date), activity: choice(source.activity, activities), startTime: source.startTime };
  if (source.cancelled !== undefined) { ensure(typeof source.cancelled === 'boolean'); plan.cancelled = source.cancelled; }
  if (source.beforeMood !== undefined) plan.beforeMood = choice(source.beforeMood, moods);
  if (source.beforeMoodNote !== undefined) plan.beforeMoodNote = text(source.beforeMoodNote);
  if (source.result !== undefined && source.result !== null) plan.result = resultFields(source.result, plan.activity);
  return plan;
}
function dayFields(source) {
  object(source, ['date', 'periodMarked', 'periodWalk', 'version', 'createdAt', 'updatedAt']);
  ensure(typeof source.periodMarked === 'boolean');
  const day = { date: date(source.date), periodMarked: source.periodMarked };
  if (source.periodWalk !== undefined && source.periodWalk !== null) {
    object(source.periodWalk, ['status']);
    day.periodWalk = { status: choice(source.periodWalk.status, ['pending', 'completed', 'incomplete']) };
  }
  return day;
}
function stable(value) {
  if (value === undefined) return 'undefined';
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
}
function equal(left, right) { return stable(left) === stable(right); }
function transition(condition, message) { ensure(condition, 'INVALID_TRANSITION', message || '记录状态已变化，请刷新后重试'); }
function isFuture(plan, now) { return new Date(plan.date + 'T' + plan.startTime + ':00+08:00').getTime() > now.getTime(); }
function checkPlan(next, previous, day, now) {
  const oldResult = previous && previous.result;
  const result = next.result;
  if (!previous) {
    transition(!next.cancelled && !result, '请先创建安排，再记录运动结果');
    return;
  }
  transition(!previous.cancelled, '已取消的安排不能修改');
  const changedSchedule = ['date', 'startTime', 'activity'].some(key => previous[key] !== next[key]);
  if (changedSchedule || next.cancelled) {
    transition(!oldResult && isFuture(previous, now), '已开始或已有结果的安排不能修改、取消');
    transition(!changedSchedule || isFuture(next, now), '修改后的安排时间须在未来');
    transition(!result, '调整安排和记录结果请分别进行');
  }
  if (!result) { transition(!oldResult, '已有运动结果不能删除'); return; }
  if (oldResult && oldResult.status === 'replacement') {
    transition(equal(oldResult, result), '替代完成结果暂不支持修正');
    return;
  }
  if (oldResult && oldResult.makeup) {
    transition(result.status === 'incomplete' && result.reason === oldResult.reason && result.makeup && result.makeup.date === oldResult.makeup.date && result.makeup.actualActivity === oldResult.makeup.actualActivity, '原未完成原因和补做日期、项目须保留');
    return;
  }
  if (oldResult && oldResult.status !== result.status) {
    transition(['completed', 'incomplete'].includes(result.status), '已有结果不能改为替代完成');
  }
  if (result.status === 'incomplete') {
    const changedReason = !oldResult || oldResult.status !== 'incomplete' || result.reason !== oldResult.reason;
    if (changedReason) transition(Boolean(result.reason) || Boolean(day && day.periodMarked), '未完成请选择原因');
    if (!oldResult && day && day.periodMarked) transition(false, '生理期当天可不记录未完成结果');
    if (result.makeup) {
      transition(oldResult && oldResult.status === 'incomplete' && oldResult.reason === result.reason, '补做须保留原未完成结果和原因');
      transition(result.makeup.date >= next.date && result.makeup.date <= today(now), '补做日期须在原计划当天至今天之间');
    }
  }
}
function checkDay(next, previous, now) {
  transition(next.date === today(now), '只能修改北京时间当天的标记');
  const oldWalk = previous ? previous.periodWalk : undefined;
  if (oldWalk) transition(Boolean(next.periodWalk), '取消标记时仍需保留散步记录');
  if (!equal(oldWalk, next.periodWalk)) {
    transition(next.periodMarked, '请先标记当天生理期');
    if (!oldWalk) transition(next.periodWalk && next.periodWalk.status === 'pending', '请先选择自愿散步');
  }
}

module.exports = { ApiError, ensure, identifier, planFields, dayFields, checkPlan, checkDay, stable };
