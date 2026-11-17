// 精液メーカー機能のテスト（UI選択→キュー、GAS列追加とサイズ一致、E/F不変、従来動作、古いキュー互換、分娩表示、メーカー管理）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const gasRoot = process.env.GAS_SOURCE_DIR || path.join(root, 'apps-script-project');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const readGas = f => fs.readFileSync(path.join(gasRoot, f), 'utf8');
const host = v => JSON.parse(JSON.stringify(v));
const D = s => new Date(s + 'T00:00:00');
const ymd = d => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
const ago = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };

// ============================================================
//  GAS 側: 本物の SpreadsheetApp と同じく行列サイズ不一致で例外を出す偽シート
// ============================================================

const empty = v => v === '' || v === null || v === undefined;

class FakeRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) {
        const v = (this.sheet.rows[this.r - 1 + i] || [])[this.c - 1 + j];
        row.push(empty(v) ? '' : v);
      }
      out.push(row);
    }
    return out;
  }
  setValues(values) {
    if (!Array.isArray(values) || values.length !== this.nr) {
      throw new Error('The number of rows in the data does not match the number of rows in the range. The data has ' + (values || []).length + ' but the range has ' + this.nr + '.');
    }
    values.forEach(row => {
      if (row.length !== this.nc) {
        throw new Error('The number of columns in the data does not match the number of columns in the range. The data has ' + row.length + ' but the range has ' + this.nc + '.');
      }
    });
    this.sheet.calls.push(['setValues', this.r, this.c, this.nr, this.nc]);
    values.forEach((row, i) => row.forEach((v, j) => this.sheet.write(this.r + i, this.c + j, v)));
    return this;
  }
  setValue(v) {
    if (this.nr !== 1 || this.nc !== 1) throw new Error('setValue は1セル範囲のみ（テスト用制約）');
    this.sheet.write(this.r, this.c, v);
    return this;
  }
  clearContent() {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.write(this.r + i, this.c + j, '');
    return this;
  }
}

class FakeSheet {
  constructor(name, rows) { this.name = name; this.rows = (rows || []).map(r => r.slice()); this.calls = []; this.frozen = 0; }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) if ((this.rows[i] || []).some(v => !empty(v))) return i + 1;
    return 0;
  }
  getLastColumn() {
    let m = 0;
    this.rows.forEach(r => { for (let j = (r || []).length - 1; j >= 0; j--) if (!empty(r[j])) { m = Math.max(m, j + 1); break; } });
    return m;
  }
  getRange(r, c, nr, nc) {
    if (typeof r !== 'number') throw new Error('A1表記はテストでは使わない');
    nr = nr === undefined ? 1 : nr; nc = nc === undefined ? 1 : nc;
    if (![r, c, nr, nc].every(n => Number.isInteger(n) && n >= 1)) throw new Error('範囲が不正: ' + [r, c, nr, nc].join(','));
    this.calls.push(['getRange', r, c, nr, nc]);
    return new FakeRange(this, r, c, nr, nc);
  }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  write(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  }
  appendRow(row) {
    this.rows.length = this.getLastRow();
    this.rows.push(row.slice());
    this.calls.push(['appendRow', row.length]);
  }
  deleteRow(i) { this.rows.splice(i - 1, 1); }
  deleteRows(i, n) { this.rows.splice(i - 1, n); }
  setFrozenRows(n) { this.frozen = n; }
  hideSheet() {}
}

const MATING_HEADER = ['母豚No', '種付日', '再発情', '流産日', '精液採取日', '精液日齢'];

function loadGas(sheets) {
  const book = {};
  Object.keys(sheets || {}).forEach(name => { book[name] = new FakeSheet(name, sheets[name]); });
  const ss = {
    getSheetByName: name => book[name] || null,
    insertSheet: name => (book[name] = new FakeSheet(name, []))
  };
  const lock = { waitLock() {}, releaseLock() {} };
  const c = vm.createContext({
    Date, Math, JSON, console: { log() {} }, String, Number, Array, Object,
    Utilities: { formatDate: d => ymd(d) },
    LockService: { getScriptLock: () => lock, getUserLock: () => lock },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) }
  });
  for (const f of ['補助関数.js', 'api_semen_maker.js', 'api_breeding.js', 'offline_sync.js']) {
    vm.runInContext(readGas(f), c, { filename: f });
  }
  c.getSpreadsheet = () => ss;
  c.requireAuth_ = () => {};
  c.upsertCurrentRow_ = () => {};
  c.invalidateInitialCache_ = () => {};
  c.parseInputDate = D;
  return { c, book, ss };
}

const matingRows = () => [
  MATING_HEADER.slice(),
  ['101', D('2026-10-01'), '', '', D('2026-09-29'), 2],
  ['102', D('2026-10-02'), '', '', D('2026-10-02'), 0]
];

function queued(c, id, extra) {
  return c.executeQueuedOperation(Object.assign({ id: id, type: 'recordMating', args: ['103', '2026-11-10'], createdAt: '2026-11-10T00:00:00Z' }, extra || {}), 'token');
}

test('GAS: メーカー無しの種付は従来どおり（A〜D の4列追記のみ・見出し不変・E/F不変）', () => {
  const { c, book } = loadGas({ '種付': matingRows(), '繁殖管理': [['日付', '母豚No', 'ペンNo', 'BT値', 'ステータス']] });
  const before = host(book['種付'].rows);
  const res = queued(c, 'op-old-00000001');
  assert.equal(res.success, true);
  assert.equal(res.semenMaker, undefined);
  const sheet = book['種付'];
  assert.deepEqual(host(sheet.rows.slice(0, 3)), before, '見出し・既存行（E/F含む）は変わらない');
  const added = sheet.rows[3];
  assert.equal(added.length, 4);
  assert.equal(added[0], '103');
  assert.equal(ymd(added[1]), '2026-11-10');
  assert.equal(sheet.calls.some(x => x[0] === 'setValues'), false, 'メーカー無しでは見出しに触らない');
  assert.equal(sheet.calls.some(x => x[0] === 'getRange'), false);
  // 古いクライアントの直接呼び出し（3引数）も成功する
  assert.equal(c.recordMating('104', '2026-11-11', 'token').success, true);
  assert.equal(sheet.rows[4].length, 4);
});

test('GAS: メーカー付きはG列に見出し1セルだけ追加し、E/F列と既存データを壊さない', () => {
  const { c, book } = loadGas({ '種付': matingRows(), '繁殖管理': [[]] });
  const before = host(book['種付'].rows);
  const res = queued(c, 'op-new-00000001', { semenMaker: ' Aジェネ ' });
  assert.equal(res.success, true);
  assert.equal(res.semenMaker, 'Aジェネ');
  const sheet = book['種付'];
  assert.deepEqual(host(sheet.rows[0]), MATING_HEADER.concat(['精液メーカー']));
  for (let i = 1; i < 3; i++) assert.deepEqual(host(sheet.rows[i].slice(0, 6)), before[i], '既存行の A〜F は不変');
  const added = sheet.rows[3];
  assert.equal(added.length, 7);
  assert.equal(added[6], 'Aジェネ');
  assert.equal(added[4] === '' && added[5] === '', true, '採取日なしなら新しい行の E/F は空欄');
  // getRange と setValues のサイズは常に一致（偽シートは不一致で例外）。見出しは1行×1列、行は appendRow 1回。
  const sets = sheet.calls.filter(x => x[0] === 'setValues');
  assert.deepEqual(sets.map(x => x.slice(1)), [[1, 7, 1, 1]]);
  assert.deepEqual(sheet.calls.filter(x => x[0] === 'appendRow'), [['appendRow', 7]]);
  assert.equal(sheet.calls.some(x => x[0] === 'getRange' && x[1] === 1 && x[2] === 5), false, 'E1 は既にあるので触らない');

  // 2回目は見出しを探して同じ列へ。見出しは増えない。
  assert.equal(queued(c, 'op-new-00000002', { semenMaker: 'Bファーム' }).success, true);
  assert.equal(sheet.rows[0].filter(v => v === '精液メーカー').length, 1);
  assert.equal(sheet.rows[4][6], 'Bファーム');
});

test('GAS: メーカー列は名前で探し、無ければ最終列の右へ（既存のG列以降の別データを壊さない）', () => {
  // G/H に別のデータがある
  const rows = matingRows();
  rows[0].push('メモ', '担当');
  rows[1].push('左耳', '田中');
  const g = loadGas({ '種付': rows, '繁殖管理': [[]] });
  assert.equal(queued(g.c, 'op-col-00000001', { semenMaker: 'Aジェネ' }).success, true);
  const s1 = g.book['種付'];
  assert.deepEqual(host(s1.rows[0].slice(6)), ['メモ', '担当', '精液メーカー']);
  assert.deepEqual(host(s1.rows[1].slice(6, 8)), ['左耳', '田中']);
  assert.equal(s1.rows[3][8], 'Aジェネ');

  // A〜D だけのシートでも E/F（精液採取日用）は空けて G に置く
  const h = loadGas({ '種付': [['母豚No', '種付日', '再発情', '流産日'], ['101', D('2026-10-01'), '', '']], '繁殖管理': [[]] });
  assert.equal(queued(h.c, 'op-col-00000002', { semenMaker: 'Aジェネ' }).success, true);
  const s2 = h.book['種付'];
  assert.equal(s2.rows[0][6], '精液メーカー');
  assert.equal(empty(s2.rows[0][4]) && empty(s2.rows[0][5]), true);
  assert.equal(s2.rows[2][6], 'Aジェネ');

  // 既に離れた列（J）に見出しがあればそこへ書く
  const rows3 = matingRows();
  rows3[0][9] = '精液メーカー';
  const k = loadGas({ '種付': rows3, '繁殖管理': [[]] });
  assert.equal(queued(k.c, 'op-col-00000003', { semenMaker: 'Cラボ' }).success, true);
  const s3 = k.book['種付'];
  assert.equal(s3.rows[0].filter(v => v === '精液メーカー').length, 1);
  assert.equal(s3.rows[3][9], 'Cラボ');
  assert.equal(empty(s3.rows[3][6]), true);
});

test('GAS: 不正なメーカー値・見出し書込み失敗でも種付は1回だけ保存して成功を返す', () => {
  const { c, book } = loadGas({ '種付': matingRows(), '繁殖管理': [[]] });
  assert.equal(queued(c, 'op-bad-00000001', { semenMaker: 123 }).success, true);
  assert.equal(book['種付'].rows.length, 4);
  assert.equal(book['種付'].rows[0].length, 6, '数値は無視して見出しも追加しない');

  const sheet = book['種付'];
  const orig = sheet.getRange.bind(sheet);
  sheet.getRange = (r, col, nr, nc) => { if (r === 1 && col >= 7) throw new Error('保護された範囲'); return orig(r, col, nr, nc); };
  const res = queued(c, 'op-bad-00000002', { semenMaker: 'Aジェネ' });
  assert.equal(res.success, true);
  assert.match(res.warning, /精液メーカー列を準備できませんでした/);
  assert.equal(sheet.rows.length, 5, '種付行は1行だけ追加');
  // 同じ操作IDの再送は履歴から返り、種付行は二重にならない
  assert.equal(queued(c, 'op-bad-00000002', { semenMaker: 'Aジェネ' }).duplicate, true);
  assert.equal(sheet.rows.length, 5);
});

test('GAS: 精液採取日・日齢の E/F 保存を復活（見出しがあれば触らず、appendRow 1回で6列）', () => {
  const { c, book } = loadGas({ '種付': matingRows(), '繁殖管理': [[]] });
  const sheet = book['種付'];
  const before = host(sheet.rows);
  const res = queued(c, 'op-sem-00000001', { semenCollectionDate: '2026-11-08', semenAgeDays: 2 });
  assert.equal(res.success, true);
  assert.equal(res.semenCollectionDate, '2026-11-08');
  assert.equal(res.semenAgeDays, 2);
  const added = sheet.rows[3];
  assert.equal(added.length, 6, 'メーカー無しなら G 列は伸ばさない');
  assert.deepEqual(host(added.slice(2)), ['', '', '2026-11-08', 2]);
  assert.deepEqual(host(sheet.rows.slice(0, 3)), before, '見出しと既存行（10/15 までの E/F 値）は不変');
  assert.equal(sheet.calls.some(x => x[0] === 'setValues'), false, 'E1 があるので見出しは書かない');
  assert.deepEqual(sheet.calls.filter(x => x[0] === 'getRange'), [['getRange', 1, 5, 1, 1]], 'E1 を1セルだけ読む');

  // 日齢が無い・空なら 種付日−採取日（種付日 2026-11-10 が0日齢）
  queued(c, 'op-sem-00000002', { semenCollectionDate: '2026-11-07' });
  assert.equal(sheet.rows[4][5], 3);
  queued(c, 'op-sem-00000003', { semenCollectionDate: '2026-11-10', semenAgeDays: '' });
  assert.equal(sheet.rows[5][5], 0);
  // 不正な採取日は空欄のまま種付だけ保存（失敗にしない）
  for (const [i, bad] of [['4', 'bad'], ['5', '2026-02-31'], ['6', 20261108]]) {
    const r = queued(c, 'op-sem-0000000' + i, { semenCollectionDate: bad, semenAgeDays: 3 });
    assert.equal(r.success, true);
    assert.equal(sheet.rows.at(-1).length, 4, String(bad));
  }
  assert.equal(sheet.rows.length, 9);
});

test('GAS: 見出しが無い種付シートには E1:F1 を1行×2列で書き、メーカーと同時保存も1行で入る', () => {
  const { c, book } = loadGas({ '種付': [['母豚番号', '種付日', '再発情', '流産'], ['101', D('2026-10-19'), '', '']], '繁殖管理': [[]] });
  const sheet = book['種付'];
  const res = queued(c, 'op-both-0000001', { semenCollectionDate: '2026-11-08', semenAgeDays: 2, semenMaker: 'Aジェネ' });
  assert.equal(res.success, true);
  assert.equal(res.warning, undefined);
  assert.deepEqual(host(sheet.rows[0]), ['母豚番号', '種付日', '再発情', '流産', '精液採取日', '精液日齢', '精液メーカー']);
  assert.equal(sheet.rows[1][0], '101');
  assert.equal(sheet.rows[1].length, 4, '10/19 以降の E/F 空欄行はそのまま（埋め戻さない）');
  const added = sheet.rows[2];
  assert.deepEqual(host(added.slice(2)), ['', '', '2026-11-08', 2, 'Aジェネ']);
  // 見出しは E1:F1（1×2）と G1（1×1）だけ。範囲と配列のサイズは偽シートが検査済み。
  assert.deepEqual(sheet.calls.filter(x => x[0] === 'setValues').map(x => x.slice(1)), [[1, 5, 1, 2], [1, 7, 1, 1]]);
  assert.deepEqual(sheet.calls.filter(x => x[0] === 'appendRow'), [['appendRow', 7]]);

  // 2件目: 見出しは増えず、E1/G1 とも書かない
  queued(c, 'op-both-0000002', { semenCollectionDate: '2026-11-09', semenMaker: 'Bファーム' });
  assert.equal(sheet.calls.filter(x => x[0] === 'setValues').length, 2);
  assert.deepEqual(host(sheet.rows[3].slice(4)), ['2026-11-09', 1, 'Bファーム']);

  // E1 に別の文字があれば触らない
  const other = loadGas({ '種付': [['母豚番号', '種付日', '再発情', '流産', '採取日メモ']], '繁殖管理': [[]] });
  queued(other.c, 'op-both-0000003', { semenCollectionDate: '2026-11-08', semenAgeDays: 2 });
  assert.equal(other.book['種付'].rows[0][4], '採取日メモ');
  assert.equal(other.book['種付'].rows[0].length, 5);
});

test('GAS: 見出し書込みに失敗しても種付とE/Fは1行だけ保存して成功（メーカーだけ欠ける）', () => {
  const { c, book } = loadGas({ '種付': [['母豚番号', '種付日', '再発情', '流産']], '繁殖管理': [[]] });
  const sheet = book['種付'];
  const orig = sheet.getRange.bind(sheet);
  sheet.getRange = (r, col, nr, nc) => {
    const range = orig(r, col, nr, nc);
    if (r === 1) range.setValues = () => { throw new Error('保護された範囲'); };
    return range;
  };
  const res = queued(c, 'op-fail-0000001', { semenCollectionDate: '2026-11-08', semenAgeDays: 2, semenMaker: 'Aジェネ' });
  assert.equal(res.success, true);
  assert.match(res.warning, /E1:F1/);
  assert.match(res.warning, /精液メーカー列/);
  assert.equal(res.semenMaker, undefined);
  assert.equal(sheet.rows.length, 2);
  assert.deepEqual(host(sheet.rows[1].slice(2)), ['', '', '2026-11-08', 2]);
  assert.equal(queued(c, 'op-fail-0000001', { semenCollectionDate: '2026-11-08' }).duplicate, true);
  assert.equal(sheet.rows.length, 2, '再送しても二重にならない');
});

test('GAS: v142 時代の古いキュー（採取日のみ）と項目なしのキューの互換', () => {
  const { c } = loadGas({ '種付': matingRows(), '繁殖管理': [[]] });
  const seen = [];
  c.recordMating = function() { seen.push(host(Array.from(arguments).slice(3))); return { success: true }; };
  c.dispatchQueuedOperation_('recordMating', ['1', '2026-11-01'], 't', { id: 'x', type: 'recordMating', args: [] });
  c.dispatchQueuedOperation_('recordMating', ['1', '2026-11-01'], 't', { semenCollectionDate: '2026-10-30', semenAgeDays: 2 });
  c.dispatchQueuedOperation_('recordMating', ['1', '2026-11-01'], 't', { semenCollectionDate: '2026-10-30', semenMaker: 'A', semenAgeDays: null });
  c.dispatchQueuedOperation_('recordMating', ['1', '2026-11-01'], 't', { semenCollectionDate: '', semenMaker: '' });
  assert.deepEqual(seen, [
    [],
    [{ semenCollectionDate: '2026-10-30', semenAgeDays: 2 }],
    [{ semenCollectionDate: '2026-10-30', semenMaker: 'A' }],
    []
  ]);
});

test('GAS: 受付検証（recordMating は2引数のまま、saveSemenMakers は配列のみ）と古い dispatch 呼び出し', () => {
  const { c } = loadGas({ '種付': matingRows(), '繁殖管理': [[]] });
  assert.equal(c.validateQueuedOperation_({ id: 'op-val-00000001', type: 'recordMating', args: ['1', '2026-11-01'], semenMaker: 'A' }), '');
  assert.equal(c.validateQueuedOperation_({ id: 'op-val-00000002', type: 'recordMating', args: ['1', '2026-11-01', 'A'] }), '送信項目の数が不正です');
  assert.equal(c.validateQueuedOperation_({ id: 'op-val-00000003', type: 'saveSemenMakers', args: ['x'] }), 'メーカー一覧が不正です');
  assert.equal(c.validateQueuedOperation_({ id: 'op-val-00000004', type: 'saveSemenMakers', args: [[]] }), '');
  const seen = [];
  c.recordMating = function() { seen.push(arguments.length); return { success: true }; };
  c.dispatchQueuedOperation_('recordMating', ['1', '2026-11-01'], 't');
  c.dispatchQueuedOperation_('recordMating', ['1', '2026-11-01'], 't', { semenMaker: '' });
  c.dispatchQueuedOperation_('recordMating', ['1', '2026-11-01'], 't', { semenMaker: 'A' });
  assert.deepEqual(seen, [3, 3, 4], '未選択・古いキューは従来の3引数で呼ぶ');
});

test('GAS: 精液メーカーシートは見出しだけで自動作成し、保存で追加・変更・無効化・削除できる', () => {
  const { c, book } = loadGas({ '種付': matingRows() });
  assert.deepEqual(host(c.getSemenMakers('t')), { success: true, makers: [] });
  const sheet = book['精液メーカー'];
  assert.deepEqual(host(sheet.rows), [['メーカー名', '色', '有効']], 'ダミーデータは入れない');
  assert.equal(sheet.frozen, 1);

  let res = c.executeQueuedOperation({ id: 'op-mk-000000001', type: 'saveSemenMakers', args: [[
    { name: 'Aジェネ', color: 'blue', active: true },
    { name: 'Bファーム', color: 'orange', active: true },
    { name: ' ', color: 'red' },
    { name: 'aジェネ', color: 'green' },
    { name: 'Cラボ', color: '#8430CE', active: false }
  ]] }, 't');
  assert.equal(res.success, true);
  assert.deepEqual(host(sheet.rows.slice(1)), [['Aジェネ', '青', true], ['Bファーム', '橙', true], ['Cラボ', '紫', false]]);
  assert.deepEqual(host(c.readSemenMakers_(c.getSpreadsheet(), false)), [
    { name: 'Aジェネ', color: 'blue', active: true },
    { name: 'Bファーム', color: 'orange', active: true },
    { name: 'Cラボ', color: 'purple', active: false }
  ]);
  // 名前変更＋削除（件数が減った分は消える）
  res = c.saveSemenMakers([{ name: 'Aジェネティクス', color: 'green', active: true }], 't');
  assert.equal(res.success, true);
  assert.equal(sheet.getLastRow(), 2);
  assert.deepEqual(host(sheet.rows[1]), ['Aジェネティクス', '緑', true]);
  sheet.calls.filter(x => x[0] === 'setValues').forEach(x => assert.equal(x[4], 3, '常に3列'));
  // 手入力の「無効」「FALSE」も無効として読む
  sheet.rows.push(['手入力', '赤', '無効'], ['手入力2', 'なし', 'FALSE']);
  const list = host(c.readSemenMakers_(c.getSpreadsheet(), false));
  assert.deepEqual(list.slice(1), [{ name: '手入力', color: 'red', active: false }, { name: '手入力2', color: '', active: false }]);
  // 0件保存でも壊れない
  assert.equal(c.saveSemenMakers([], 't').success, true);
  assert.equal(sheet.getLastRow(), 1);
});

test('GAS: 分娩予定の一覧に最新種付のメーカー名と色を付ける（追い種付の混在・未設定・旧周期）', () => {
  const t = n => ago(n);
  const header = MATING_HEADER.concat(['精液メーカー']);
  const { c } = loadGas({
    '種付': [
      header,
      ['201', t(300), '', '', '', '', 'Bファーム'], // 旧周期
      ['201', t(60), '', '', '', '', 'Aジェネ'],
      ['202', t(50), '', '', '', '', 'Aジェネ'],
      ['202', t(48), '', '', '', '', 'Bファーム'], // 追い種付で別メーカー
      ['203', t(40), '', '', '', '', 'Bファーム'], // 前の周期
      ['203', t(20), '', '', '', '', ''],          // 最新は未設定
      ['204', t(30), '', '', '', '', '未登録社']
    ],
    '精液メーカー': [['メーカー名', '色', '有効'], ['Aジェネ', '青', true], ['Bファーム', '橙', false]]
  });
  const cur = (sowNo, n) => ({ sowNo, penNo: '5', latestMatingDate: ymd(t(n)), latestFarrowingDate: '', matingStatus: '通常' });
  c.getCurrentStatusRows_ = () => [cur('201', 60), cur('202', 48), cur('203', 20), cur('204', 30)];
  c.getRecentAccidents_ = () => [];
  c.buildPenTaskList_ = () => [];
  c.attachReproductiveHistory_ = () => {};
  const data = c.getInitialData_();
  assert.deepEqual(host(data.semenMakers.map(m => m.name)), ['Aジェネ', 'Bファーム']);
  const bySow = {};
  data.farrowingList.forEach(r => { bySow[r.sowNo] = r; });
  assert.equal(bySow['201'].semenMaker, 'Aジェネ');
  assert.equal(bySow['201'].semenMakerColor, 'blue');
  assert.equal(bySow['201'].semenMakers, undefined);
  assert.equal(bySow['202'].semenMaker, 'Bファーム', '先頭は最新の種付');
  assert.deepEqual(host(bySow['202'].semenMakers), [{ name: 'Bファーム', color: 'orange' }, { name: 'Aジェネ', color: 'blue' }]);
  assert.equal(bySow['203'].semenMaker, undefined, '最新周期が未設定なら表示しない');
  assert.equal(bySow['204'].semenMaker, '未登録社');
  assert.equal(bySow['204'].semenMakerColor, '');

  // メーカー列もメーカーシートも無い本番（現状）でも一覧はそのまま返る
  const plain = loadGas({ '種付': matingRows() });
  plain.c.getCurrentStatusRows_ = () => [cur('101', 30)];
  plain.c.getRecentAccidents_ = () => [];
  plain.c.buildPenTaskList_ = () => [];
  plain.c.attachReproductiveHistory_ = () => {};
  const d2 = plain.c.getInitialData_();
  assert.deepEqual(host(d2.semenMakers), []);
  assert.equal(d2.farrowingList.length, 1);
  assert.equal(d2.farrowingList[0].semenMaker, undefined);
  assert.equal(plain.book['精液メーカー'], undefined, '一覧の読み込みではシートを作らない');
});

// ============================================================
//  Pages / GAS 同梱 UI 側
// ============================================================

function loadClient(storeInit) {
  const store = Object.assign({}, storeInit || {});
  const els = {};
  const immediate = [];
  const toasts = [];
  const modals = [];
  const runner = { success: null, failure: null, payloads: [] };
  function make(id) {
    const el = {
      id, attrs: {}, innerHTML: '', value: '', textContent: '', hidden: false, listeners: {}, style: {},
      options: { length: 0 },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      classList: { add() {}, remove() {} }
    };
    els[id] = el;
    return el;
  }
  const document = {
    getElementById(id) {
      if (els[id]) return els[id];
      if (/^maker-/.test(id)) return null; // 管理モーダルは JS が作るまで無い
      return make(id);
    },
    createElement() { return make('__new' + Object.keys(els).length); },
    body: {
      appendChild(node) {
        if (node.id) els[node.id] = node;
        String(node.innerHTML).replace(/id="([^"]+)"/g, (m, id) => { if (!els[id]) make(id); return m; });
      }
    },
    addEventListener() {},
    querySelectorAll() { return []; }
  };
  const c = {
    document,
    localStorage: {
      getItem: k => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
      setItem: (k, v) => { store[k] = String(v); }
    },
    window: { addEventListener() {} },
    navigator: { onLine: true },
    setTimeout: (fn, ms) => { if (!ms) immediate.push(fn); return 1; },
    clearTimeout() {}, setInterval() { return 1; },
    Date, Math, JSON, Number, String, Array, Object, isFinite, parseInt, parseFloat, isNaN,
    console: { warn() {}, log() {} },
    confirm: () => true,
    App: {
      authToken: 'token', currentPage: 'farrowing',
      today: () => '2026-11-17',
      setDateDefault(id) { document.getElementById(id).value = '2026-11-17'; },
      showModal(id) { modals.push('show:' + id); }, hideModal(id) { modals.push('hide:' + id); },
      tapShielded: () => false, tryAction: () => true, armTapShield() {}, confirmAction: () => true,
      toast(m) { toasts.push(m); }, getStatusBadgeClass: () => 'done'
    },
    PostMating: { list: [] }, ReheatCheck: { list: [] }, PregCheck: { list: [] }
  };
  c.google = { script: { run: {
    withSuccessHandler(fn) { runner.success = fn; return c.google.script.run; },
    withFailureHandler(fn) { runner.failure = fn; return c.google.script.run; },
    executeQueuedOperation(payload) { runner.payloads.push(host(payload)); }
  } } };
  vm.createContext(c);
  for (const f of ['js_offline.js', 'js_semenmaker.js', 'js_breeding.js', 'js_farrowing.js', 'js_sow.js']) {
    vm.runInContext(read(f), c, { filename: f });
  }
  c.OfflineSync.initialized = true;
  c.OfflineSync.queue = c.OfflineSync.loadQueue();
  c.Breeding.render = () => {};
  const flush = () => immediate.splice(0).forEach(fn => fn());
  return { c, els, store, toasts, modals, runner, flush };
}

function clickMaker(env, containerId, index) {
  const container = env.els[containerId];
  container.listeners.click({ target: { getAttribute: k => (k === 'data-maker-index' ? String(index) : null), parentNode: container } });
}

function mateFromBreeding(env, sowNo) {
  env.c.Breeding.openMatingModal(sowNo);
  return () => env.c.Breeding.confirmStatus();
}

test('UI: メーカー0件でも種付画面は壊れず、未選択のまま保存すると従来と同じ payload', () => {
  const env = loadClient();
  mateFromBreeding(env, '42')();
  const chips = env.els['status-maker-chips'].innerHTML;
  assert.match(chips, /未選択（従来）/);
  assert.match(chips, /「管理」から追加/);
  assert.equal((chips.match(/data-maker-index="/g) || []).length, 1);
  const op = env.c.OfflineSync.queue[0];
  assert.equal(op.type, 'recordMating');
  assert.deepEqual(host(op.args), ['42', '2026-11-17']);
  assert.equal('semenMaker' in op, false);
  env.flush();
  const p = env.runner.payloads[0];
  assert.deepEqual(p.args, ['42', '2026-11-17']);
  assert.equal('semenMaker' in p, false);
  assert.equal('semenCollectionDate' in p, false);
  assert.equal(env.toasts[0], '種付実施を記録しました');
});

test('UI: メーカー管理で追加→種付で選択→キューの payload.semenMaker、前回選択を記憶', () => {
  const env = loadClient();
  const S = env.c.SemenMaker;
  S.openManager();
  assert.ok(env.modals.includes('show:maker-modal'));
  assert.match(env.els['maker-manager-body'].innerHTML, /まだメーカーがありません/);
  assert.equal(S.draftAdd('', 'blue').ok, false);
  assert.equal(S.draftAdd('Aジェネ', 'blue').ok, true);
  assert.match(S.draftAdd('aジェネ', 'red').error, /すでにあります/);
  assert.equal(S.draftAdd('Bファーム', 'orange').ok, true);
  assert.equal(S.commitDraft().ok, true);
  assert.deepEqual(JSON.parse(env.store[S.storageKey]), [
    { name: 'Aジェネ', color: 'blue', active: true }, { name: 'Bファーム', color: 'orange', active: true }
  ]);
  const save = env.c.OfflineSync.queue.find(op => op.type === 'saveSemenMakers');
  assert.deepEqual(host(save.args[0]).map(m => m.name), ['Aジェネ', 'Bファーム']);
  assert.equal(env.c.OfflineSync.describeOperation(save), '精液メーカー設定');
  env.flush();
  assert.equal(env.runner.payloads[0].type, 'saveSemenMakers');
  env.runner.success({ success: true });

  const confirm = mateFromBreeding(env, '42');
  const chips = env.els['status-maker-chips'].innerHTML;
  assert.match(chips, /Aジェネ/);
  assert.match(chips, /--maker-color:#c25e00/);
  assert.match(chips, /maker-chip maker-none selected/, '初回は未選択（従来）');
  clickMaker(env, 'status-maker-chips', 1);
  assert.equal(S.read('status-maker-chips'), 'Bファーム');
  assert.match(env.els['status-maker-chips'].innerHTML, /class="maker-chip selected"[^>]*>.*Bファーム/);
  confirm();
  const op = env.c.OfflineSync.queue.find(o => o.type === 'recordMating');
  assert.equal(op.semenMaker, 'Bファーム');
  assert.deepEqual(host(op.args), ['42', '2026-11-17']);
  assert.match(env.toasts.at(-1), /（Bファーム）/);
  assert.match(env.c.OfflineSync.describeOperation(op), /種付 No\.42 Bファーム/);
  env.flush();
  const p = env.runner.payloads.at(-1);
  assert.equal(p.type, 'recordMating');
  assert.equal(p.semenMaker, 'Bファーム');
  assert.deepEqual(p.args, ['42', '2026-11-17']);
  env.runner.success({ success: true });

  // 次回は前回のメーカーで開く（母豚カード側の種付モーダルも同じ）
  env.c.Mating.open('43');
  assert.equal(S.read('mating-maker-chips'), 'Bファーム');
  env.c.Mating.submit();
  const op2 = env.c.OfflineSync.queue.find(o => o.type === 'recordMating' && o.args[0] === '43');
  assert.equal(op2.semenMaker, 'Bファーム');
  // 未選択に戻すとそれも覚える
  clickMaker(env, 'mating-maker-chips', -1);
  assert.equal(S.read('mating-maker-chips'), '');
  assert.equal(S.lastSelected(), '');
});

test('UI: 採取日とメーカーを両方選ぶと両方送る（args は2つのまま）', () => {
  const env = loadClient({ breedingSemenMakers_v1: JSON.stringify([{ name: 'Aジェネ', color: 'blue', active: true }]) });
  const confirm = mateFromBreeding(env, '50');
  env.c.SemenCollection.mount('status-semen-chips', '2026-11-17', 3);
  clickMaker(env, 'status-maker-chips', 0);
  confirm();
  env.flush();
  const p = env.runner.payloads[0];
  assert.deepEqual(p.args, ['50', '2026-11-17']);
  assert.equal(p.semenCollectionDate, '2026-11-14');
  assert.equal(p.semenAgeDays, 3);
  assert.equal(p.semenMaker, 'Aジェネ');
});

test('UI: メーカー管理の名前変更・色・停止・削除と、未送信編集中はサーバー一覧で上書きしない', () => {
  const env = loadClient({
    breedingSemenMakers_v1: JSON.stringify([{ name: 'Aジェネ', color: 'blue', active: true }, { name: 'Bファーム', color: 'orange', active: true }, { name: 'Cラボ', color: 'green', active: true }]),
    breedingSemenMakerLast_v1: 'Aジェネ'
  });
  const S = env.c.SemenMaker;
  S.open('status-maker-chips');
  assert.equal(S.read('status-maker-chips'), 'Aジェネ');
  S.openManager();
  const body = env.els['maker-manager-body'];
  assert.match(body.innerHTML, /value="Aジェネ"/);
  // 画面の入力イベントで名前変更、ボタンで色・停止・削除
  body.listeners.input({ target: { value: 'Aジェネティクス', getAttribute: k => (k === 'data-maker-name' ? '0' : null) } });
  const btn = attrs => ({ getAttribute: k => (k in attrs ? attrs[k] : null), parentNode: null });
  body.listeners.click({ target: btn({ 'data-maker-action': 'color', 'data-maker-target': '0', 'data-maker-color': 'purple' }) });
  body.listeners.click({ target: btn({ 'data-maker-action': 'toggle', 'data-maker-target': '1' }) });
  assert.match(body.innerHTML, /停止中/);
  body.listeners.click({ target: btn({ 'data-maker-action': 'remove', 'data-maker-target': '2' }) });
  assert.doesNotMatch(body.innerHTML, /Cラボ/);
  body.listeners.click({ target: btn({ 'data-maker-action': 'save' }) });
  assert.ok(env.toasts.includes('精液メーカーを保存しました'));
  assert.deepEqual(host(S.list), [{ name: 'Aジェネティクス', color: 'purple', active: true }, { name: 'Bファーム', color: 'orange', active: false }]);
  assert.equal(S.lastSelected(), 'Aジェネティクス', '改名したら前回選択も追従');
  assert.equal(S.read('status-maker-chips'), 'Aジェネティクス', '開いている種付画面も描き直す');
  const chips = env.els['status-maker-chips'].innerHTML;
  assert.doesNotMatch(chips, /Bファーム/, '停止中は選択肢に出さない');
  // 停止中でも分娩画面の色は残る
  assert.equal(S.hexFor('Bファーム'), '#c25e00');

  // 重複名は保存できない
  S.openManager();
  S.draftRename(1, 'aジェネティクス');
  assert.match(S.commitDraft().error, /重複/);

  // 未送信の saveSemenMakers がある間はサーバーの古い一覧で上書きしない
  assert.equal(S.applyServerList([{ name: '古い', color: 'red', active: true }]), false);
  assert.equal(S.list[0].name, 'Aジェネティクス');
  env.c.OfflineSync.queue = [];
  assert.equal(S.applyServerList([{ name: '新しい', color: 'red', active: true }]), true);
  assert.deepEqual(host(S.list), [{ name: '新しい', color: 'red', active: true }]);
  assert.equal(S.lastSelected(), '', '前回選択が消えたら未選択（従来）');
});

test('互換: maker を持たない古いキューを再読込しても従来どおり送る', () => {
  const env = loadClient({
    breedingOfflineQueue_v1: 'unused'
  });
  const key = env.c.OfflineSync.storageKey;
  env.store[key] = JSON.stringify([
    { id: 'old-mating-1', type: 'recordMating', args: ['7', '2026-10-01'], createdAt: '2026-10-01T00:00:00Z', attempts: 0, nextAttemptAt: 0, state: 'pending', error: '' },
    { id: 'old-mating-2', type: 'recordMating', args: ['8', '2026-10-01'], createdAt: '2026-10-01T00:00:00Z', attempts: 0, nextAttemptAt: 0, state: 'sending', error: '', semenCollectionDate: '2026-09-30', semenAgeDays: 1 }
  ]);
  env.c.OfflineSync.queue = env.c.OfflineSync.loadQueue();
  env.c.OfflineSync.process();
  let p = env.runner.payloads[0];
  assert.deepEqual(p, { id: 'old-mating-1', type: 'recordMating', args: ['7', '2026-10-01'], createdAt: '2026-10-01T00:00:00Z' });
  env.runner.success({ success: true });
  env.flush();
  env.c.OfflineSync.process();
  p = env.runner.payloads[1];
  assert.equal(p.semenAgeDays, 1);
  assert.equal('semenMaker' in p, false);
  // 不正な型・空白だけのメーカーは付けない
  env.c.OfflineSync.enqueue('recordMating', ['9', '2026-10-02'], null, { semenMaker: 5 });
  env.c.OfflineSync.enqueue('recordMating', ['10', '2026-10-02'], null, { semenMaker: '   ' });
  env.c.OfflineSync.queue.filter(o => o.args[0] === '9' || o.args[0] === '10').forEach(o => assert.equal('semenMaker' in o, false));
});

test('分娩予定表と分娩記録モーダルにメーカー名＋色（未設定は表示なし・混在・XSS対策）', () => {
  const env = loadClient({ breedingSemenMakers_v1: JSON.stringify([{ name: 'Bファーム', color: 'green', active: false }]) });
  const F = env.c.Farrowing;
  F.list = [
    { sowNo: '1', penNo: '301', matingDate: '2026-08-01', daysSinceMate: 108, dueDate: '2026-11-23', status: '', semenMaker: 'Aジェネ', semenMakerColor: 'blue' },
    { sowNo: '2', penNo: '302', matingDate: '2026-08-02', daysSinceMate: 107, dueDate: '2026-11-24', status: '' },
    { sowNo: '3', penNo: '303', matingDate: '2026-08-03', daysSinceMate: 106, dueDate: '2026-11-25', status: '', semenMaker: 'Bファーム', semenMakerColor: 'orange',
      semenMakers: [{ name: 'Bファーム', color: 'orange' }, { name: 'Aジェネ', color: 'blue' }] },
    { sowNo: '4', penNo: '304', matingDate: '2026-08-04', daysSinceMate: 105, dueDate: '2026-11-26', status: '', semenMaker: '<img src=x onerror=alert(1)>', semenMakerColor: '' }
  ];
  F.render();
  const html = env.els['farrowing-list'].innerHTML;
  const rows = html.split('<tr').slice(2);
  assert.equal(rows.length, 4);
  assert.match(rows[0], /class="maker-cell" style="box-shadow:inset 6px 0 0 #1967d2"/);
  assert.match(rows[0], /<span class="maker-badge" style="background:#1967d2">Aジェネ<\/span>/);
  assert.doesNotMatch(rows[1], /maker/, '未設定は何も出さない（従来の表示）');
  assert.match(rows[2], /background:#137333">Bファーム/, '端末の一覧の色を優先');
  assert.match(rows[2], /Aジェネ/);
  assert.match(rows[2], /混在/);
  assert.match(rows[3], /&lt;img src=x onerror=a<\/span>/, 'エスケープし、20文字で切る');
  assert.match(rows[3], /#5f6368/, '色不明は灰色＋名前');
  assert.doesNotMatch(html, /<img/);

  F.openRecordModal('1');
  const info = env.els['farrow-record-maker'];
  assert.equal(info.hidden, false);
  assert.match(info.innerHTML, /精液メーカー/);
  assert.match(info.innerHTML, /Aジェネ/);
  F.openRecordModal('2');
  assert.equal(info.hidden, true);
  assert.equal(info.innerHTML, '');
});

test('Pages と GAS 同梱 HTML・CSS は同一、両方の index に選択欄と分娩表示欄がある、sw にキャッシュ', () => {
  const strip = s => s.replace(/^<(script|style)>\s*/, '').replace(/\s*<\/(script|style)>\s*$/, '').trim();
  for (const name of ['js_app', 'js_semenmaker', 'js_breeding', 'js_sow', 'js_farrowing', 'js_offline']) {
    assert.equal(strip(readGas(name + '.html')), read(name + '.js').trim(), name);
  }
  assert.equal(strip(readGas('css.html')), read('breeding.css').trim());
  const pages = read('index.html');
  const gas = readGas('index.html');
  for (const html of [pages, gas]) {
    for (const id of ['status-maker-chips', 'mating-maker-chips', 'farrow-record-maker', 'status-semen-chips', 'mating-semen-chips']) {
      assert.match(html, new RegExp('id="' + id + '"'), id);
    }
    assert.match(html, /SemenMaker\.openManager\(\)/);
  }
  assert.ok(pages.indexOf('js_semenmaker.js') > pages.indexOf('js_app.js') && pages.indexOf('js_semenmaker.js') < pages.indexOf('js_breeding.js'));
  assert.ok(gas.indexOf("include('js_semenmaker')") > gas.indexOf("include('js_app')") && gas.indexOf("include('js_semenmaker')") < gas.indexOf("include('js_breeding')"));
  const sw = read('sw.js');
  assert.match(sw, /CACHE_NAME = 'breeding-pwa-v154-semen-maker-1'/);
  assert.ok(sw.includes("BASE_PATH + 'js_semenmaker.js'"));
  assert.match(readGas('webapp.js'), /method === 'getSemenMakers' && args\.length === 0/);
});
