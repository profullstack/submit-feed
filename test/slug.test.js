import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, uniqueSlug } from '../src/core.js';

test('slugify keeps unicode letters by default and folds accents', () => {
  assert.equal(slugify('Café  Society!'), 'cafe-society');
  assert.equal(slugify("Rock 'n' Roll"), 'rock-n-roll');
  assert.equal(slugify('ブログ'), 'ブログ');
  assert.equal(slugify('ブログ', { ascii: true }), '');
  assert.equal(slugify('!!!'), '');
  assert.equal(slugify('a'.repeat(100), { maxLength: 60 }).length, 60);
});

test('uniqueSlug falls back and suffixes', () => {
  assert.equal(uniqueSlug('!!!', { fallbackUrl: 'https://www.example.org/feed' }), 'example-org');
  assert.equal(uniqueSlug('', {}), 'untitled');
  const taken = new Set(['show', 'show-2']);
  assert.equal(uniqueSlug('Show', { taken: (s) => taken.has(s) }), 'show-3');
  assert.equal(uniqueSlug('api', { reserved: ['api'] }), 'api-2');
});
