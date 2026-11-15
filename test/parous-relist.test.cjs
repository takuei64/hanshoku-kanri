// 経産母豚（離乳移動後・空胎）の「測定終了から15日後に朝リストへ再表示」のテスト。
// 育成・流産と同じく、測定終了後15日未満は非表示、15日以上で再表示する。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const gasRoot = process.env.GAS_SOURCE_DIR || path.join(root, 'apps-script-project');
const ds = d => d instanceof Date ? [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-') : String(d || '');
/** 実行日の n 日前（GAS側は new Date() を今日として計算するため相対日付で組む） */
const ago = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return ds(d); };
const D = s => new Date(s + 'T00:00:00');

/** GAS の api_breeding.js を vm で読み込む。fixedToday を渡すと new Date()（引数なし）をその日に固定する。 */
function loadGas(fixedToday) {
  let DateImpl = Date;
  if (fixedToday) {
    const fixed = D(fixedToday).getTime();
    DateImpl = class extends Date {
      constructor(...args) { if (args.length) super(...args); else super(fixed); }
      static now() { return fixed; }
    };
  }
  const c = vm.createContext({ Date: DateImpl, console, daysBetween: (a, b) => Math.floor((b - a) / 86400000), normalizeSowNo: v => String(v || ''),
    normalizePenNo: v => String(v || ''), toDateString: ds, parseInputDate: s => new DateImpl(s + 'T00:00:00') });
  vm.runInContext(fs.readFileSync(path.join(gasRoot, 'api_breeding.js'), 'utf8'), c);
  return c;
}
const row = patch => ({ sowNo: '999001', penNo: '23', area: 'ストール', latestMoveDate: '', latestMatingDate: '', latestFarrowingDate: '',
  matingStatus: '', breedingDoneDate: '', postMatingDoneDate: '', reheatDoneDate: '', pregnancyDoneDate: '', emptyDate: '', btHistory: [], ...patch });

test('(a) 離乳移動後の経産: 測定終了14日目までは非表示、15日目以降は「離乳移動 N日目」で再表示', () => {
  const c = loadGas();
  const m = r => c.buildMorningListFromCurrent_([row(r)]);
  const base = { latestMatingDate: ago(200), latestFarrowingDate: ago(80), latestMoveDate: ago(50) };
  const shown = m(base);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].reason, '離乳移動 50日目');
  assert.equal(shown[0].group, 1);
  for (const n of [0, 1, 13, 14]) assert.equal(m({ ...base, breedingDoneDate: ago(n) }).length, 0, '測定終了' + n + '日前は出ない');
  for (const n of [15, 16, 30, 50]) {
    const back = m({ ...base, breedingDoneDate: ago(n) });
    assert.equal(back.length, 1, '測定終了' + n + '日前は再表示');
    assert.equal(back[0].reason, '離乳移動 50日目', '日数は移動日から');
    assert.equal(back[0].group, 1);
  }
  assert.equal(m({ ...base, breedingDoneDate: ago(60) }).length, 1, '移動より前の測定終了は除外理由にならない');
  assert.equal(m({ ...base, area: '分娩舎', penNo: '301', breedingDoneDate: ago(20) }).length, 0, 'ストール以外は15日後も出さない');
  assert.equal(m({ ...base, matingStatus: '廃用' }).length, 0, '廃用は出さない');
});

test('(b) 空胎の経産: 測定終了14日目までは非表示、15日目以降は「空胎 N日目」で再表示', () => {
  const c = loadGas();
  const m = r => c.buildMorningListFromCurrent_([row(r)]);
  // 前回分娩 → 離乳移動 → 種付 → 空胎
  const base = { latestFarrowingDate: ago(150), latestMoveDate: ago(120), latestMatingDate: ago(60), matingStatus: '空胎', emptyDate: ago(30) };
  assert.equal(m(base)[0].reason, '空胎 30日目');
  for (const n of [0, 7, 14]) assert.equal(m({ ...base, breedingDoneDate: ago(n) }).length, 0, '測定終了' + n + '日前は出ない');
  for (const n of [15, 20, 30]) {
    const back = m({ ...base, breedingDoneDate: ago(n) });
    assert.equal(back.length, 1, '測定終了' + n + '日前は再表示');
    assert.equal(back[0].reason, '空胎 30日目');
    assert.equal(back[0].group, 0);
  }
});

test('(c) 測定終了後に新しい種付があれば朝リストに出ず、種付後リストへ戻る', () => {
  const c = loadGas();
  const m = r => c.buildMorningListFromCurrent_([row(r)]);
  // 離乳移動後の経産: 測定終了20日前 → 5日前に種付（recordMating で状態は通常、測定終了日はクリアされない想定でも出ない）
  for (const done of ['', ago(20), ago(10)]) {
    const r = { latestMatingDate: ago(5), latestFarrowingDate: ago(80), latestMoveDate: ago(50), matingStatus: '通常', breedingDoneDate: done };
    assert.equal(m(r).length, 0, '離乳後再種付 done=' + done);
    assert.equal(c.buildPostMatingListFromCurrent_([row(r)]).length, 1, '種付後リストに出る');
  }
  // 空胎の経産: 空胎→測定終了→再種付
  for (const done of ['', ago(20), ago(10)]) {
    const r = { latestFarrowingDate: ago(150), latestMoveDate: ago(120), latestMatingDate: ago(5), matingStatus: '通常', emptyDate: ago(30), breedingDoneDate: done };
    assert.equal(m(r).length, 0, '空胎後再種付 done=' + done);
    assert.equal(c.buildPostMatingListFromCurrent_([row(r)]).length, 1);
  }
});

test('(d) 7220相当: 6/30分娩→離乳移動→8/26測定終了→種付なしのまま 11/15 は朝リストに出る', () => {
  const c = loadGas('2026-11-15');
  const r = row({ sowNo: '7220', penNo: '45', latestMatingDate: '2026-03-08', latestFarrowingDate: '2026-06-30',
    latestMoveDate: '2026-07-24', breedingDoneDate: '2026-08-26' });
  const m = c.buildMorningListFromCurrent_([r]);
  assert.equal(m.length, 1);
  assert.equal(m[0].sowNo, '7220');
  assert.equal(m[0].reason, '離乳移動 114日目');
  // 測定終了直後（9/9 = 14日目）はまだ出ず、9/10（15日目）から出る
  assert.equal(loadGas('2026-09-09').buildMorningListFromCurrent_([r]).length, 0);
  assert.equal(loadGas('2026-09-10').buildMorningListFromCurrent_([r]).length, 1);
});

test('(d) 7220相当: 繁殖管理シートから同期しても測定終了日が残り、11/15 は朝リストに出る', () => {
  const c = loadGas('2026-11-15');
  // vm 内の Date（日付固定版）で作らないと instanceof Date 判定に通らない
  const D = s => new c.Date(s + 'T00:00:00');
  const sheets = {
    '種付': [[], ['7220', D('2026-03-08'), '', '']],
    '分娩': [[], ['7220', D('2026-06-30')]],
    '繁殖管理': [[], [D('2026-07-24'), '7220', '45', '', ''], [D('2026-08-26'), '7220', '', '', '測定終了']]
  };
  const ss = {};
  Object.assign(c, { getSheetData: (s, n) => sheets[n] || [[]], getPenAreaForCurrent_: () => 'ストール' });
  let current = null;
  c.upsertCurrentRow_ = (s, sn, patch) => { current = { ...(current || {}), ...patch }; };
  c.removeCurrentRow_ = () => { current = null; };
  c.syncCurrentStatusForSow_(ss, '7220');
  assert.equal(current.breedingDoneDate, '2026-08-26');
  assert.equal(current.latestMoveDate, '2026-07-24');
  const m = c.buildMorningListFromCurrent_([current]);
  assert.equal(m.length, 1);
  assert.equal(m[0].reason, '離乳移動 114日目');
});

test('廃用は母豚現在状況から除外され、朝リストにも出ない（既存挙動）', () => {
  const c = loadGas('2026-11-15');
  // vm 内の Date（日付固定版）で作らないと instanceof Date 判定に通らない
  const D = s => new c.Date(s + 'T00:00:00');
  const sheets = {
    '種付': [[], ['7220', D('2026-03-08'), '', '']],
    '分娩': [[], ['7220', D('2026-06-30')]],
    '繁殖管理': [[], [D('2026-07-24'), '7220', '45', '', ''], [D('2026-08-26'), '7220', '', '', '測定終了'], [D('2026-10-01'), '7220', '', '', '廃用']]
  };
  Object.assign(c, { getSheetData: (s, n) => sheets[n] || [[]], getPenAreaForCurrent_: () => 'ストール' });
  let removed = false;
  c.upsertCurrentRow_ = () => { throw new Error('廃用は upsert しない'); };
  c.removeCurrentRow_ = () => { removed = true; };
  c.syncCurrentStatusForSow_({}, '7220');
  assert.equal(removed, true);
});
