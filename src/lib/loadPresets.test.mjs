// node --test src/lib/loadPresets.test.mjs
// Test types, speed presets and the plain-language load description on the load test form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEST_TYPES, describeLoad, duration, matchTestType, speedPresetFor, testTypeLabel, testTypeValues } from './loadPresets.js';

const LIMITS = { maxVus: null, maxDurationSec: 600 };

test('every test type fits the default limits and is recognised again from its numbers', () => {
  for (const type of TEST_TYPES) {
    const v = testTypeValues(type.id, LIMITS);
    assert.ok(Number(v.rampUpSec) + Number(v.durationSec) <= 600, type.id);
    assert.ok(Number(v.durationSec) >= 10, type.id);
    assert.equal(matchTestType(v, LIMITS), type.id);
  }
  assert.deepEqual(testTypeValues('soak', LIMITS), { vus: '20', rampUpSec: '30', durationSec: '570', maxErrorRatePct: '1' });
  assert.equal(matchTestType({ vus: 7, rampUpSec: 0, durationSec: 30 }, LIMITS), 'custom');
  assert.equal(testTypeLabel('spike'), 'Sudden rush');
  assert.equal(testTypeLabel('custom'), 'Custom');
});

test('test types shrink to fit tighter limits', () => {
  const tight = { maxVus: 50, maxDurationSec: 120 };
  for (const type of TEST_TYPES) {
    const v = testTypeValues(type.id, tight);
    assert.ok(Number(v.vus) <= 50, type.id);
    assert.ok(Number(v.rampUpSec) + Number(v.durationSec) <= 120, type.id);
    assert.equal(matchTestType(v, tight), type.id);
  }
  assert.deepEqual(testTypeValues('stress', tight), { vus: '50', rampUpSec: '60', durationSec: '60', maxErrorRatePct: '5' });
});

test('speedPresetFor names the p95 limit', () => {
  assert.equal(speedPresetFor(''), 'off');
  assert.equal(speedPresetFor(null), 'off');
  assert.equal(speedPresetFor('500'), 'fast');
  assert.equal(speedPresetFor(1000), 'ok');
  assert.equal(speedPresetFor('750'), 'custom');
});

test('describeLoad explains the shape and estimates requests', () => {
  assert.equal(duration(45), '45 s');
  assert.equal(duration(150), '2 min 30 s');
  assert.equal(duration(600), '10 min');

  const ramp = describeLoad({ vus: '200', rampUpSec: '30', durationSec: '120', kind: 'request' });
  assert.equal(ramp.text, 'Users go from 0 to 200 over 30 s, then all 200 users keep going for 2 min (2 min 30 s in total).');
  // (200*30/2 + 200*120) user-seconds / 0.2 s per request = 135,000, shown to two figures; 1,000 a second at full load.
  assert.equal(ramp.estimate, 'About 140,000 requests, 1,000 a second at full load, if responses take ~200 ms.');
  assert.match(ramp.warning, /No pauses between requests/);

  const flow = describeLoad({ vus: 2, rampUpSec: '', durationSec: 30, kind: 'scenario', steps: [{ thinkTimeSec: '1' }, { thinkTimeSec: '0.6' }] });
  assert.equal(flow.text, '2 users start at once and keep going for 30 s.');
  // One pass: 2 × 0.2 s + 1.6 s think = 2 s; 2 users × 30 s / 2 s × 2 steps = 60 requests.
  assert.equal(flow.estimate, 'About 60 requests, 2 a second at full load, if responses take ~200 ms.');
  assert.equal(flow.warning, null);

  assert.equal(describeLoad({ vus: '', rampUpSec: '0', durationSec: '30' }), null);
  assert.equal(describeLoad({ vus: '5', rampUpSec: '-1', durationSec: '30' }), null);
});
