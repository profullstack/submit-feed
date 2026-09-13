import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedAddress, isPublicHost, isIPv4, isIPv6, retryAfterSeconds } from '../src/index.js';

test('isBlockedAddress refuses every internal range', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1', 'garbage']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ['93.184.216.34', '172.32.0.1', '100.128.0.1', '2606:2800:220:1:248:1893:25c8:1946', '::ffff:93.184.216.34']) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
  assert.equal(isIPv4('1.2.3.4'), true);
  assert.equal(isIPv4('1.2.3.256'), false);
  assert.equal(isIPv6('::1'), true);
  assert.equal(isIPv6('example.com'), false);
});

test('isPublicHost checks every address and the internal names', async () => {
  assert.equal(await isPublicHost('localhost'), false);
  assert.equal(await isPublicHost('foo.internal'), false);
  assert.equal(await isPublicHost('10.0.0.1'), false);
  assert.equal(await isPublicHost('93.184.216.34'), true);
  assert.equal(await isPublicHost('x.org', { lookup: async () => ['93.184.216.34', '10.0.0.1'] }), false);
  assert.equal(await isPublicHost('x.org', { lookup: async () => ['93.184.216.34'] }), true);
  assert.equal(await isPublicHost('x.org', { lookup: async () => [] }), false);
  assert.equal(await isPublicHost('x.org', { lookup: async () => { throw new Error('nx'); } }), false);
});

test('retryAfterSeconds', () => {
  assert.equal(retryAfterSeconds('120'), 120);
  assert.equal(retryAfterSeconds('9999999'), 86400);
  assert.equal(retryAfterSeconds(new Date(Date.now() + 30_000).toUTCString()) <= 31, true);
  assert.equal(retryAfterSeconds('soon'), null);
  assert.equal(retryAfterSeconds(null), null);
});
