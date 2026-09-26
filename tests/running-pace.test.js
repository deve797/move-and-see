const assert = require('node:assert/strict');
const formatRunningPace = require('../miniprogram/utils/running-pace');

assert.equal(formatRunningPace('30', '5'), '6′00″/公里');
assert.equal(formatRunningPace('35', '5'), '7′00″/公里');
assert.equal(formatRunningPace('30', '4'), '7′30″/公里');
assert.equal(formatRunningPace(32.5, 5), '6′30″/公里');
assert.equal(formatRunningPace('30', '4.8'), '6′15″/公里');
assert.equal(formatRunningPace('1.999', '1'), '2′00″/公里');
assert.equal(formatRunningPace('6.0833333333', '1'), '6′05″/公里');
assert.equal(formatRunningPace(' 30 ', ' 5 '), '6′00″/公里');
assert.equal(formatRunningPace('3', '.5'), '6′00″/公里');

for (const missingOrInvalid of ['', ' ', null, undefined, 'abc', '1.2.3', '-1', -1, NaN, Infinity, 'Infinity', '0x10', true]) {
  assert.equal(formatRunningPace(missingOrInvalid, '5'), '');
  assert.equal(formatRunningPace('30', missingOrInvalid), '');
}
assert.equal(formatRunningPace('30', '0'), '');
assert.equal(formatRunningPace('30', '0.0'), '');
assert.equal(formatRunningPace('0', '5'), '');

console.log('PASS: running pace, duration/distance changes, decimal values, nearest-second rounding and carry, missing/invalid/zero values');
