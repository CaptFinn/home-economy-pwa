// Bare assertions over the pure modules, run by ./check.sh. No framework: the
// sibling Apps Script project checks itself the same way, and one runnable
// file beats a toolchain for a two-person app.
import assert from 'node:assert/strict';
import * as fmt from './app/fmt.js';

assert.equal(fmt.peso(1500), '₱1,500.00', 'pesos get a sign-free peso format');
assert.equal(fmt.peso(0), '₱0.00', 'zero formats');
assert.equal(fmt.peso(-1240.5), '−₱1,240.50', 'a negative keeps a real minus sign');
assert.equal(fmt.signed(-1240.5), '−₱1,240.50', 'signed shows the minus');
assert.equal(fmt.signed(1240.5), '+₱1,240.50', 'and a plus for money in');
assert.equal(fmt.day('2026-09-16'), 'sep 16', 'dates read like the Apps Script app');
assert.equal(fmt.day(''), '', 'a blank date formats to nothing');
assert.equal(fmt.today(new Date(2026, 8, 16, 1, 0)), '2026-09-16',
  'today uses local parts, never toISOString');

console.log('fmt self-check passed');
