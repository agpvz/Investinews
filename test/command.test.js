import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, suggest } from '../public/js/command.js';

test('parses global functions with arguments', () => {
  assert.deepEqual(parseCommand('top mkt'), { type: 'func', fn: 'TOP', args: ['MKT'], argsRaw: 'mkt' });
  assert.equal(parseCommand('NI AI').fn, 'NI');
  assert.equal(parseCommand('nse rate cut').argsRaw, 'rate cut');
  assert.equal(parseCommand('W ADD NI tariffs').argsRaw, 'ADD NI tariffs');
  assert.equal(parseCommand('BACK').fn, 'MENU');
  assert.equal(parseCommand('crypto').fn, 'CRYP');
});

test('parses numbers and empty input', () => {
  assert.deepEqual(parseCommand(' 12 '), { type: 'number', n: 12 });
  assert.deepEqual(parseCommand(''), { type: 'empty' });
});

test('parses security forms', () => {
  assert.deepEqual(parseCommand('aapl cn'), { type: 'security', fn: 'CN', symbol: 'AAPL', ticker: 'AAPL' });
  assert.deepEqual(parseCommand('AAPL US EQUITY DES'), { type: 'security', fn: 'DES', symbol: 'AAPL US EQUITY', ticker: 'AAPL' });
  assert.equal(parseCommand('SPX INDEX').fn, 'MENU');
  assert.equal(parseCommand('MSFT').fn, 'MENU');
  assert.equal(parseCommand('N MSFT').fn, 'CN');
  assert.equal(parseCommand('AAPL FIL').fn, 'CF');
  assert.equal(parseCommand('BTC-USD GIP').symbol, 'BTC-USD');
});

test('falls back to free-text search', () => {
  const c = parseCommand('oil supply shock');
  assert.equal(c.type, 'func'); assert.equal(c.fn, 'NSE'); assert.equal(c.argsRaw, 'oil supply shock');
});

test('suggest offers functions and security functions', () => {
  assert.ok(suggest('W').some((s) => s.cmd === 'WEI'));
  assert.deepEqual(suggest('AAPL G').map((s) => s.cmd), ['AAPL GP', 'AAPL GIP']);
  assert.deepEqual(suggest(''), []);
});
