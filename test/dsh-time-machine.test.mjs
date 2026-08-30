import test from 'node:test';
import assert from 'node:assert/strict';
import { name, Config } from '../lib/index.js';

test('dsh-time-machine exports valid name and schema', () => {
  assert.equal(name, '@goodandready-private/dsh-time-machine');
  assert.ok(Config);
});
