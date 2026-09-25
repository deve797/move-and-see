const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const motion = require('../miniprogram/utils/exercise-motion');

// 循环边界、瑜伽放回胸前，以及所有取帧区域均落在素材内。
for (const [kind, spec] of Object.entries(motion.motions)) {
  const asset = fs.readFileSync(path.resolve(__dirname, '../miniprogram' + spec.src));
  const imageWidth = asset.readUInt32BE(16);
  const imageHeight = asset.readUInt32BE(20);
  assert.equal(imageWidth, imageHeight * 2); // 两种动作均为 4 × 2 的正方形帧。
  assert.equal(motion.frameAt(kind, 0), 0);
  assert.equal(motion.frameAt(kind, spec.duration), 0);
  const frames = new Set();
  for (let ms = 0; ms < spec.duration; ms += 10) frames.add(motion.frameAt(kind, ms));
  assert.equal(frames.size, spec.count);
  for (const frame of frames) {
    const rect = motion.frameRect(kind, frame, imageWidth, imageHeight);
    assert.ok(rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.x + rect.width <= imageWidth && rect.y + rect.height <= imageHeight);
  }
}
assert.equal(motion.frameAt('yoga', 3200), 7);
assert.equal(motion.frameAt('yoga', 1000), motion.frameAt('yoga', 5400));
const raised = motion.frameRect('yoga', 7, 1774, 887);
assert.equal(raised.y, 424); // 指尖最上端 y=428，不能用均等行界 443.5 切掉。
assert.equal(raised.x + raised.width / 2, 1524); // 对齐该帧实际人物中心。

const componentFile = path.resolve(__dirname, '../miniprogram/components/exercise-motion/index.js');
let definition;
let now = 1000;
vm.runInNewContext(fs.readFileSync(componentFile, 'utf8'), {
  require: () => motion,
  Component: value => { definition = value; },
  wx: { getWindowInfo: () => ({ pixelRatio: 3 }) },
  Date: { now: () => now }
});

function mount() {
  const callbacks = new Map();
  const draws = [];
  const picture = { width: 1774, height: 887 };
  let observe;
  let disconnected = false;
  let nextId = 0;
  const canvas = {
    createImage: () => picture,
    getContext: () => ({ clearRect() {}, drawImage: (...args) => draws.push(args) }),
    requestAnimationFrame: callback => { callbacks.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: id => callbacks.delete(id)
  };
  const component = {
    data: { kind: 'yoga', ready: false },
    setData(value) { Object.assign(this.data, value); },
    createSelectorQuery() {
      return { select() { return this; }, fields() { return this; }, exec(fn) { fn([{ node: canvas, width: 190, height: 190 }]); } };
    },
    createIntersectionObserver() {
      return {
        relativeToViewport() { return this; },
        observe(selector, fn) { observe = fn; },
        disconnect() { disconnected = true; }
      };
    }
  };
  Object.assign(component, definition.methods);
  definition.lifetimes.attached.call(component);
  definition.lifetimes.ready.call(component);
  return {
    component, picture, canvas, callbacks, draws,
    visible(value) { observe({ intersectionRatio: value ? 1 : 0 }); },
    disconnected: () => disconnected,
    advance(ms) {
      now += ms;
      const pending = Array.from(callbacks.values());
      callbacks.clear();
      pending.forEach(fn => fn());
    }
  };
}

const m = mount();
assert.equal(m.component.data.ready, false); // 图片尚未加载，保留原插画。
m.picture.onload();
assert.equal(m.component.data.ready, true);
assert.equal(m.canvas.width, 380); // DPR 上限 2。
assert.equal(m.callbacks.size, 0); // 屏幕外不启动。
m.visible(true);
assert.equal(m.callbacks.size, 1);
m.advance(1000);
assert.ok(m.component._lastFrame > 0);
m.component.updatePlayback();
assert.equal(m.callbacks.size, 1); // 多次恢复不叠加动画循环。
m.visible(false);
assert.equal(m.callbacks.size, 0);
const pausedFrame = m.component._lastFrame;
m.advance(3000);
assert.equal(m.component._lastFrame, pausedFrame);
m.visible(true);
m.advance(1);
assert.equal(m.component._lastFrame, pausedFrame); // 恢复不追赶暂停时间。
m.visible(false);
assert.equal(m.callbacks.size, 0);
m.visible(true);
definition.pageLifetimes.hide.call(m.component);
assert.equal(m.callbacks.size, 0);
definition.pageLifetimes.show.call(m.component);
assert.equal(m.callbacks.size, 1);
definition.lifetimes.detached.call(m.component);
assert.equal(m.callbacks.size, 0);
assert.equal(m.disconnected(), true);

const failed = mount();
failed.picture.onerror();
assert.equal(failed.component.data.ready, false);
assert.equal(failed.callbacks.size, 0);
const removed = mount();
definition.lifetimes.detached.call(removed.component);
removed.picture.onload();
assert.equal(removed.component.data.ready, false); // 加载期间离开，不重新启动。
console.log('PASS: frame bounds, full cycles, pause/resume, visibility, cleanup, load failure');
