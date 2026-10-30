// Regression tests for the product CSV export (lib/csv.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CSV_BOM, buildCsv, csvCell } from '../lib/csv';

test('formula-like text cells are neutralised with a leading apostrophe', () => {
  assert.equal(csvCell('=HYPERLINK("http://evil","x")'), `"'=HYPERLINK(""http://evil"",""x"")"`);
  assert.equal(csvCell('+1+cmd|calc'), "'+1+cmd|calc");
  assert.equal(csvCell('-2+3'), "'-2+3");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('\tTab'), "'\tTab");
});

test('plain numbers (including negatives and decimals) are not altered', () => {
  assert.equal(csvCell('-3'), '-3');
  assert.equal(csvCell(-3), '-3');
  assert.equal(csvCell('19.99'), '19.99');
  assert.equal(csvCell(0), '0');
});

test('quotes, commas, LF and bare CR are quoted per RFC 4180', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('a\nb'), '"a\nb"');
  assert.equal(csvCell('a\rb'), '"a\rb"');
});

test('null / undefined become empty cells', () => {
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
});

test('document starts with a UTF-8 BOM, uses CRLF and keeps unicode intact', () => {
  const csv = buildCsv(['Title', 'Vendor'], [['Café 日本', 'Ünï'], ['x', '=1']]);
  assert.ok(csv.startsWith(CSV_BOM));
  assert.equal(csv.slice(1), "Title,Vendor\r\nCafé 日本,Ünï\r\nx,'=1");
});

test('empty row list still yields the header line', () => {
  assert.equal(buildCsv(['A', 'B'], []), `${CSV_BOM}A,B`);
});
