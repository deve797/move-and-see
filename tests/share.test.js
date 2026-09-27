const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '../miniprogram');
const { pages } = require('../miniprogram/app.json');

test('every page shares the app home with fixed artwork instead of private page content', () => {
  for (const route of pages) {
    const file = path.join(root, route + '.js');
    let page;
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      require: createRequire(file), Page(value) { page = value; }
    });
    page.planId = 'private-plan-id';
    page.data = { beforeMoodNote: 'private note', periodMarked: true };
    for (const from of ['button', 'menu']) {
      const share = page.onShareAppMessage({ from, target: { dataset: { planId: page.planId } } });
      assert.deepEqual(Object.keys(share).sort(), ['imageUrl', 'path', 'title']);
      assert.equal(share.path, '/pages/home/index', route);
      assert.match(share.title, /^Move&See/);
      assert.equal(share.imageUrl, '/assets/morning-stretch.jpg');
      assert.ok(fs.existsSync(path.join(root, share.imageUrl)));
      assert.doesNotMatch(JSON.stringify(share), /private|period|planId/);
      share.path = '/pages/record/index?planId=private-plan-id';
      assert.equal(page.onShareAppMessage().path, '/pages/home/index');
    }
  }
  assert.ok(pages.includes('pages/home/index'));
});
