// 公開Pages版の流産記録フローと、「15日後再表示」まわりのテスト（流産は測定終了から15日後に再表示）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const gasRoot = process.env.GAS_SOURCE_DIR || path.join(root, 'apps-script-project');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const ds = d => d instanceof Date ? [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-') : String(d || '');
/** 実行日の n 日前（GAS側は new Date() を今日として計算するため相対日付で組む） */
const ago = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return ds(d); };

// ---------- Pages フロント ----------

function loadPages() {
  const els = {};
  const el = id => els[id] || (els[id] = { id, value: '', textContent: '', innerHTML: '', hidden: false, options: [], style: {},
    getAttribute() { return null; }, setAttribute() {} });
  const store = {};
  const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const timers = [];
  const c = vm.createContext({
    document: { getElementById: el, addEventListener() {}, createElement: () => el('x'), body: { appendChild() {} }, querySelectorAll: () => [] },
    navigator: { onLine: true }, localStorage, Date, JSON, Math, console, __authToken: '',
    setTimeout(fn) { timers.push(fn); }, clearTimeout() {},
    addEventListener() {}, location: { href: 'https://example.github.io/hanshoku-kanri/', search: '' },
    OfflineSync: { queue: [], lastDuplicate: false, enqueue(type, args) { this.queue.push({ type, args: Array.from(args) }); return 'op' + this.queue.length; },
      updateStatus() {}, showStatus() {}, completeOperation() {}, hasPending() { return this.queue.length > 0; }, pendingCount() { return this.queue.length; }, failedCount() { return 0; } },
    PenTask: { list: [] }
  });
  c.window = c;
  vm.runInContext(read('pwa-runtime.js'), c);
  for (const f of ['js_app.js', 'js_breeding.js', 'js_postmating.js', 'js_reheatcheck.js', 'js_pregcheck.js', 'js_farrowing.js', 'js_sow.js', 'pwa-hooks.js']) {
    vm.runInContext(read(f), c);
  }
  const toasts = [];
  Object.assign(c.App, { today: () => '2026-11-04', setDateDefault: id => { el(id).value = '2026-11-04'; }, showModal: id => { c.modal = id; },
    hideModal: id => { if (c.modal === id) c.modal = null; }, tryAction: () => true, tapShielded: () => false, armTapShield() {},
    toast: m => toasts.push(m), navigateTo() {}, currentPage: 'pregcheck' });
  const flush = () => { while (timers.length) timers.shift()(); };
  return { c, el, store, toasts, flush };
}

function seedPregnant(c) {
  const sow = { sowNo: '999001', penNo: '23', status: '妊娠鑑定済', info: '種付29日目', days: 29, mateDate: '2026-10-06', btHistory: [] };
  c.SowLocation.list = [{ ...sow }];
  c.PregCheck.list = [{ ...sow }];
  c.PostMating.list = [{ ...sow }];
  c.ReheatCheck.list = [{ ...sow }];
  c.Farrowing.list = [{ ...sow, dueDate: '2027-01-28' }];
  c.Breeding.list = [{ sowNo: '777001', penNo: '5', reason: '育成/移動 20日目', status: '', group: 2, days: 20, btHistory: [] }];
}

test('Pages index.html: 現在地の操作シートに流産ボタン、日付つき状態モーダルがある', () => {
  const html = read('index.html');
  const sheet = html.slice(html.indexOf('id="loc-action-sheet"'), html.indexOf('</div>', html.indexOf('SowLocation.actionDeath()')));
  assert.match(sheet, /onclick="SowLocation\.actionMating\(\)">種付登録[\s\S]*onclick="SowLocation\.actionAbortion\(\)">流産<\/button>[\s\S]*onclick="SowLocation\.actionFarrowing\(\)">分娩登録/);
  assert.match(html, /id="status-modal"[\s\S]*<input type="date" id="status-date">[\s\S]*id="status-modal-desc"[\s\S]*onclick="Breeding\.confirmStatus\(\)"/);
  for (const f of ['js_app.js', 'js_breeding.js', 'js_pregcheck.js', 'js_sow.js']) assert.match(html, new RegExp('<script src="\\./' + f.replace('.', '\\.') + '">'));
});

test('Pages sw.js: 流産対応のJSをキャッシュし、main からキャッシュ名を更新している', () => {
  const sw = read('sw.js');
  for (const f of ['index.html', 'js_app.js', 'js_breeding.js', 'js_pregcheck.js', 'js_sow.js', 'js_offline.js']) assert.ok(sw.includes("BASE_PATH + '" + f + "'"), f);
  const name = sw.match(/CACHE_NAME = '([^']+)'/)[1];
  let mainName = null;
  try { mainName = execFileSync('git', ['show', 'main:sw.js'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).match(/CACHE_NAME = '([^']+)'/)[1]; } catch (e) { /* main が無い環境では比較しない */ }
  if (mainName) assert.notEqual(name, mainName, '公開後に古いJSが残らないようキャッシュ名を変える');
  assert.equal(name, 'breeding-pwa-v151-abortion-relist-1');
});

test('Pages: 妊娠鑑定カードの流産→日付確認→キュー送信、妊娠中リストから外れ朝リストに「流産 N日目」', () => {
  const { c, el, store, toasts, flush } = loadPages();
  seedPregnant(c);
  c.PregCheck.render();
  const card = el('pregcheck-list').innerHTML;
  assert.match(card, /onclick="PregCheck\.confirm\('999001','妊娠鑑定済'\)">合格[\s\S]*onclick="Breeding\.openStatusModal\('999001','流産'\)">流産[\s\S]*onclick="PregCheck\.confirm\('999001','空胎'\)">空胎/);

  c.Breeding.openStatusModal('999001', '流産');
  assert.equal(c.modal, 'status-modal');
  assert.equal(el('status-modal-title').textContent, '流産 No.999001');
  assert.equal(el('status-modal-desc').textContent, '流産日を記録し、再種付けのチェック対象にします');
  assert.equal(el('status-semen-block').hidden, true);
  assert.equal(el('status-date').value, '2026-11-04');

  // 日付が空なら記録しない
  el('status-date').value = '';
  c.Breeding.confirmStatus();
  assert.equal(c.OfflineSync.queue.length, 0);
  assert.equal(c.modal, 'status-modal');
  assert.equal(toasts.at(-1), '記録日を確認してください');

  el('status-date').value = '2026-11-01';
  c.Breeding.confirmStatus();
  assert.equal(c.modal, null);
  assert.deepEqual(c.OfflineSync.queue, [{ type: 'recordStatusChange', args: ['999001', '流産', '2026-11-01'] }]);
  assert.equal(toasts.at(-1), '流産 を記録しました');

  for (const owner of ['PregCheck', 'PostMating', 'ReheatCheck', 'Farrowing']) assert.equal(c[owner].list.length, 0, owner);
  assert.equal(c.SowLocation.list.length, 1);
  assert.equal(c.SowLocation.list[0].status, '流産');
  c.PregCheck.render();
  assert.match(el('pregcheck-list').innerHTML, /鑑定対象はありません/);

  const merged = c.Breeding.buildMergedList();
  const row = merged.find(m => m.s.sowNo === '999001');
  assert.equal(row.s.reason, '流産 3日目');
  assert.equal(row.s.status, '流産');
  assert.equal(c.Breeding.typeInfo(row).label, '流産');
  assert.equal(merged.filter(m => m.s.sowNo === '999001').length, 1, '同じ母豚は1枚だけ');
  c.Breeding.render();
  const board = el('breeding-list').innerHTML;
  assert.match(board, /流産 3日目/);
  assert.match(board, /status-badge empty">流産/);
  // 流産カードは再種付け対象: 種付と測定終了ボタンを出す
  assert.match(board, /Breeding\.openMatingModal\('999001'\)">種付/);
  assert.match(board, /Breeding\.openStatusModal\('999001', '測定終了'\)">測定終了/);

  // Pages は enqueue 後に一覧を端末へ保存する。圏外で再起動しても流産状態で復元される
  flush();
  const snap = JSON.parse(store[c.PwaStore.snapshotKey]);
  assert.equal(snap.pregnancyCheckList.length, 0);
  assert.equal(snap.farrowingList.length, 0);
  assert.equal(snap.morningList.find(s => s.sowNo === '999001').reason, '流産 3日目');
  assert.equal(snap.locationList[0].status, '流産');
  c.Breeding.list = []; c.PregCheck.list = [{ sowNo: '999001' }];
  c.PwaShell.applyData(c.PwaStore.loadInitialData());
  assert.equal(c.PregCheck.list.length, 0);
  assert.equal(c.Breeding.list.find(s => s.sowNo === '999001').status, '流産');
});

test('Pages: 現在地の操作シートの流産ボタンも同じ日付モーダルとキューを使う', () => {
  const { c, el } = loadPages();
  seedPregnant(c);
  c.App.currentPage = 'location';
  c.SowLocation.actionSowNo = '999001';
  c.SowLocation.actionAbortion();
  assert.equal(c.modal, 'status-modal');
  assert.equal(el('status-modal-title').textContent, '流産 No.999001');
  c.Breeding.confirmStatus();
  assert.deepEqual(c.OfflineSync.queue, [{ type: 'recordStatusChange', args: ['999001', '流産', '2026-11-04'] }]);
  assert.match(el('location-list').innerHTML, /status-badge empty[^>]*>流産/);
  assert.equal(c.Breeding.list.find(s => s.sowNo === '999001').reason, '流産 0日目');
});

test('Pages: 流産カードの測定終了は朝リストから外すだけ（15日後の再表示はサーバー再取得時）', () => {
  const { c, el } = loadPages();
  seedPregnant(c);
  c.Breeding.openStatusModal('999001', '流産');
  c.Breeding.confirmStatus();
  c.Breeding.openStatusModal('999001', '測定終了');
  assert.equal(el('status-modal-desc').textContent, 'チェック対象から外れます');
  c.Breeding.confirmStatus();
  assert.deepEqual(c.OfflineSync.queue[1], { type: 'recordStatusChange', args: ['999001', '測定終了', '2026-11-04'] });
  assert.equal(c.Breeding.list.some(s => s.sowNo === '999001'), false);
  assert.equal(c.Breeding.list.length, 1, '他の母豚は残る');
  // 空胎ボタン（従来）は流産モーダルを経由しない
  c.PregCheck.list = [{ sowNo: '999002', penNo: '24', days: 30, mateDate: '2026-10-05' }];
  c.PregCheck.confirm('999002', '空胎');
  assert.deepEqual(c.OfflineSync.queue[2], { type: 'recordStatusChange', args: ['999002', '空胎', '2026-11-04'] });
  assert.equal(c.Breeding.list.find(s => s.sowNo === '999002').reason, '空胎 0日目');
});

// ---------- GAS 側の一覧計算 ----------

function loadGas() {
  const c = vm.createContext({ Date, console, daysBetween: (a, b) => Math.floor((b - a) / 86400000), normalizeSowNo: v => String(v || ''),
    normalizePenNo: v => String(v || ''), toDateString: ds, parseInputDate: s => new Date(s + 'T00:00:00') });
  vm.runInContext(fs.readFileSync(path.join(gasRoot, 'api_breeding.js'), 'utf8'), c);
  return c;
}
const row = patch => ({ sowNo: '999001', penNo: '23', area: 'ストール', latestMoveDate: '', latestMatingDate: '', latestFarrowingDate: '',
  matingStatus: '', breedingDoneDate: '', postMatingDoneDate: '', reheatDoneDate: '', pregnancyDoneDate: '', emptyDate: '', btHistory: [], ...patch });

test('現状固定: 育成豚（種付・分娩なし）は測定終了から15日後に朝リストへ再表示', () => {
  const c = loadGas();
  const m = r => c.buildMorningListFromCurrent_([row(r)]);
  assert.equal(m({ latestMoveDate: ago(40) }).length, 1);
  assert.equal(m({ latestMoveDate: ago(40), breedingDoneDate: ago(0) }).length, 0);
  assert.equal(m({ latestMoveDate: ago(40), breedingDoneDate: ago(14) }).length, 0);
  const back = m({ latestMoveDate: ago(40), breedingDoneDate: ago(15) });
  assert.equal(back.length, 1);
  assert.equal(back[0].reason, '育成/移動 40日目');
  assert.equal(m({ latestMoveDate: ago(40), breedingDoneDate: ago(60) }).length, 1);
});

test('空胎は測定終了で朝リストから外れ、15日以上たっても自動再表示しない（従来どおり）', () => {
  const c = loadGas();
  const m = r => c.buildMorningListFromCurrent_([row(r)]);
  const base = { latestMoveDate: ago(90), latestMatingDate: ago(60), matingStatus: '空胎', emptyDate: ago(40) };
  const shown = m(base);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].reason, '空胎 40日目');
  assert.equal(shown[0].status, '空胎');
  assert.equal(shown[0].group, 0);
  for (const n of [39, 25, 15, 14, 0]) assert.equal(m({ ...base, breedingDoneDate: ago(n) }).length, 0, '空胎 測定終了' + n + '日前');
  assert.equal(m({ ...base, breedingDoneDate: ago(41) }).length, 1, '空胎より前の測定終了は除外理由にならない');
  assert.equal(m({ ...base, latestMatingDate: ago(10) }).length, 0, '再種付け後は以前の空胎で出さない');
  assert.equal(m({ ...base, area: '分娩舎', penNo: '301' }).length, 0, 'ストール以外は出さない');
});

test('流産は測定終了から14日目までは出ず、15日目から「流産 N日目」で再表示', () => {
  const c = loadGas();
  const m = r => c.buildMorningListFromCurrent_([row(r)]);
  const base = { latestMoveDate: ago(90), latestMatingDate: ago(60), matingStatus: '流産', emptyDate: ago(40) };
  const shown = m(base);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].reason, '流産 40日目');
  assert.equal(shown[0].status, '流産');
  assert.equal(shown[0].group, 0);
  for (const n of [0, 1, 13, 14]) assert.equal(m({ ...base, breedingDoneDate: ago(n) }).length, 0, '測定終了' + n + '日前は出ない');
  for (const n of [15, 16, 25, 40]) {
    const back = m({ ...base, breedingDoneDate: ago(n) });
    assert.equal(back.length, 1, '測定終了' + n + '日前は再表示');
    assert.equal(back[0].reason, '流産 40日目', '日数は流産日から');
    assert.equal(back[0].status, '流産');
    assert.equal(back[0].group, 0);
  }
  assert.equal(m({ ...base, breedingDoneDate: ago(41) }).length, 1, '流産より前の測定終了は除外理由にならない');
  // 再種付け後は以前の流産で出さない（測定終了の有無によらず）
  for (const done of ['', ago(20), ago(5)]) assert.equal(m({ ...base, latestMatingDate: ago(10), breedingDoneDate: done }).length, 0, '再種付後 done=' + done);
  assert.equal(m({ ...base, area: '分娩舎', penNo: '301' }).length, 0, 'ストール以外は出さない');
  assert.equal(m({ ...base, area: '分娩舎', penNo: '301', breedingDoneDate: ago(20) }).length, 0, 'ストール以外は15日後も出さない');
});

test('再種付け後は種後→再発の流れに戻り、朝リストの流産カードとしては出ない', () => {
  const c = loadGas();
  // recordMating で状態リセット後の想定（matingStatus 通常、emptyDate/breedingDoneDate 空）
  const r = row({ latestMoveDate: ago(90), latestMatingDate: ago(20), matingStatus: '通常' });
  assert.equal(c.buildMorningListFromCurrent_([r]).length, 0);
  assert.equal(c.buildReheatCheckListFromCurrent_([r]).length, 1);
  const r2 = row({ latestMoveDate: ago(90), latestMatingDate: ago(3), matingStatus: '通常' });
  assert.equal(c.buildPostMatingListFromCurrent_([r2]).length, 1);
  assert.equal(c.buildMorningListFromCurrent_([r2]).length, 0);
});

test('現状固定: 流産は種後・分娩予定から外れ、再発確認（種付後15〜150日）は流産/空胎日で外れる', () => {
  const c = loadGas();
  const reheat = r => c.buildReheatCheckListFromCurrent_([row(r)]).length;
  for (const [n, want] of [[14, 0], [15, 1], [150, 1], [151, 0]]) assert.equal(reheat({ latestMatingDate: ago(n), matingStatus: '通常' }), want, '種付後' + n + '日');
  assert.equal(reheat({ latestMatingDate: ago(40), matingStatus: '流産', emptyDate: ago(5) }), 0);
  assert.equal(reheat({ latestMatingDate: ago(40), matingStatus: '空胎', emptyDate: ago(5) }), 0);
  assert.equal(reheat({ latestMatingDate: ago(40), matingStatus: '通常', breedingDoneDate: ago(1) }), 1, '測定終了は再発確認を消さない');

  const post = r => c.buildPostMatingListFromCurrent_([row(r)]).length;
  assert.equal(post({ latestMatingDate: ago(5), matingStatus: '通常' }), 1);
  assert.equal(post({ latestMatingDate: ago(5), matingStatus: '流産', emptyDate: ago(1) }), 0);
  const farrow = r => c.buildFarrowingListFromCurrent_([row(r)]).length;
  assert.equal(farrow({ latestMatingDate: ago(60), matingStatus: '妊娠鑑定済' }), 1);
  assert.equal(farrow({ latestMatingDate: ago(60), matingStatus: '流産', emptyDate: ago(3) }), 0);
  assert.equal(farrow({ latestMatingDate: ago(60), matingStatus: '空胎', emptyDate: ago(3) }), 1, '空胎の分娩予定表示は従来どおり');
});

function gasWithSheets(sheets) {
  const ss = { getSheetByName(n) { return { appendRow(r) { sheets[n].push(r); }, getDataRange() { return { getValues: () => sheets[n] }; }, getRange(i, j) { return { setValue(v) { sheets[n][i - 1][j - 1] = v; } }; } }; } };
  const c = loadGas();
  Object.assign(c, { getSpreadsheet: () => ss, getSheetData: (s, n) => sheets[n] || [[]], requireAuth_() {}, invalidateInitialCache_() {},
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) } });
  c.getPenAreaForCurrent_ = () => 'ストール';
  return { c, ss };
}

test('recordStatusChange で流産→測定終了とすると、測定終了日が入り14日は出ず15日で再表示', () => {
  for (const [doneAgo, want] of [[0, 0], [14, 0], [15, 1], [20, 1]]) {
    const sheets = { '種付': [[], ['999001', new Date(ago(60) + 'T00:00:00'), '', '']], '分娩': [[]], '繁殖管理': [[]] };
    const { c } = gasWithSheets(sheets);
    let current = row({ latestMoveDate: ago(90), latestMatingDate: ago(60), matingStatus: '妊娠鑑定済', pregnancyDoneDate: ago(35) });
    c.upsertCurrentRow_ = (s, sn, patch) => { current = { ...current, ...patch }; };
    c.removeCurrentRow_ = () => { current = null; };
    assert.equal(c.recordStatusChange('999001', '流産', ago(40), 't').success, true);
    assert.equal(c.buildMorningListFromCurrent_([current]).length, 1);
    assert.equal(c.recordStatusChange('999001', '測定終了', ago(doneAgo), 't').success, true);
    assert.equal(current.breedingDoneDate, ago(doneAgo));
    assert.equal(current.matingStatus, '流産');
    const m = c.buildMorningListFromCurrent_([current]);
    assert.equal(m.length, want, '測定終了' + doneAgo + '日前');
    if (want) assert.equal(m[0].reason, '流産 40日目');
  }
});

test('syncCurrentStatusForSow_: 流産→測定終了のあと同期しても測定終了日が残り、15日未満は出ず15日以上で再表示', () => {
  const D = s => new Date(s + 'T00:00:00');
  for (const [doneAgo, want] of [[0, 0], [10, 0], [14, 0], [15, 1], [20, 1]]) {
    const sheets = {
      '種付': [[], ['999001', D(ago(60)), '', '']], '分娩': [[]],
      '繁殖管理': [[], [D(ago(90)), '999001', '23', '', ''], [D(ago(35)), '999001', '', '', '妊娠鑑定済'],
        [D(ago(40)), '999001', '', '', '流産'], [D(ago(doneAgo)), '999001', '', '', '測定終了']]
    };
    const { c, ss } = gasWithSheets(sheets);
    let current = null;
    c.upsertCurrentRow_ = (s, sn, patch) => { current = { ...(current || {}), ...patch }; };
    c.removeCurrentRow_ = () => { current = null; };
    c.syncCurrentStatusForSow_(ss, '999001');
    assert.equal(current.matingStatus, '流産');
    assert.equal(current.emptyDate, ago(40));
    assert.equal(current.breedingDoneDate, ago(doneAgo), '同期後も測定終了日が残る');
    assert.equal(c.buildMorningListFromCurrent_([current]).length, want, '測定終了' + doneAgo + '日前');
  }
});

test('syncCurrentStatusForSow_: 流産日より前の測定終了・新しい種付より前の測定終了は持ち越さない', () => {
  const D = s => new Date(s + 'T00:00:00');
  // 流産日より前の測定終了は保持しない → 朝リストに出る
  {
    const sheets = { '種付': [[], ['999001', D(ago(60)), '', '']], '分娩': [[]],
      '繁殖管理': [[], [D(ago(90)), '999001', '23', '', ''], [D(ago(45)), '999001', '', '', '測定終了'], [D(ago(40)), '999001', '', '', '流産']] };
    const { c, ss } = gasWithSheets(sheets);
    let current = null;
    c.upsertCurrentRow_ = (s, sn, patch) => { current = { ...(current || {}), ...patch }; };
    c.syncCurrentStatusForSow_(ss, '999001');
    assert.equal(current.breedingDoneDate, '');
    assert.equal(c.buildMorningListFromCurrent_([current]).length, 1);
  }
  // 流産→測定終了→再種付: 新しい周期には持ち越さず、流産カードとしても出ない
  {
    const sheets = { '種付': [[], ['999001', D(ago(60)), '', ''], ['999001', D(ago(5)), '', '']], '分娩': [[]],
      '繁殖管理': [[], [D(ago(90)), '999001', '23', '', ''], [D(ago(40)), '999001', '', '', '流産'], [D(ago(20)), '999001', '', '', '測定終了']] };
    const { c, ss } = gasWithSheets(sheets);
    let current = null;
    c.upsertCurrentRow_ = (s, sn, patch) => { current = { ...(current || {}), ...patch }; };
    c.syncCurrentStatusForSow_(ss, '999001');
    assert.equal(current.matingStatus, '通常');
    assert.equal(current.emptyDate, '');
    assert.equal(current.breedingDoneDate, '');
    assert.equal(c.buildMorningListFromCurrent_([current]).length, 0);
    assert.equal(c.buildPostMatingListFromCurrent_([current]).length, 1, '種後の流れに戻る');
  }
});

test('syncCurrentStatusForSow_: 空胎の同期ロジックは従来どおり（測定終了後は朝リストに出ない）', () => {
  const D = s => new Date(s + 'T00:00:00');
  const sheets = { '種付': [[], ['999001', D(ago(60)), '', '']], '分娩': [[]],
    '繁殖管理': [[], [D(ago(90)), '999001', '23', '', ''], [D(ago(40)), '999001', '', '', '空胎'], [D(ago(20)), '999001', '', '', '測定終了']] };
  const { c, ss } = gasWithSheets(sheets);
  let current = null;
  c.upsertCurrentRow_ = (s, sn, patch) => { current = { ...(current || {}), ...patch }; };
  c.syncCurrentStatusForSow_(ss, '999001');
  assert.equal(current.matingStatus, '空胎');
  // 既存挙動: 空胎の測定終了は同期で保持されない（今回は変更しない）
  assert.equal(current.breedingDoneDate, '');
  // recordStatusChange 直後の状態（測定終了日あり）では15日以上でも出ない
  assert.equal(c.buildMorningListFromCurrent_([{ ...current, breedingDoneDate: ago(20) }]).length, 0);
});
