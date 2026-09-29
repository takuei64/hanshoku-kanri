const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function host(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadBreeding(document) {
  const context = { document: document || {}, OfflineSync: { queue: [] } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js_breeding.js'), 'utf8'), context);
  return context;
}

function fakeDom() {
  const elements = {};
  function make(id) {
    const el = {
      id: id,
      attrs: {},
      innerHTML: '',
      value: '',
      listeners: {},
      setAttribute: function(key, value) { this.attrs[key] = String(value); },
      getAttribute: function(key) { return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null; },
      addEventListener: function(type, fn) { this.listeners[type] = fn; },
      contains: function() { return true; }
    };
    elements[id] = el;
    return el;
  }
  return {
    elements: elements,
    document: { getElementById: function(id) { return elements[id] || null; } },
    make: make
  };
}

function loadOffline() {
  const store = {};
  const immediate = [];
  const toasts = [];
  let runner = null;
  const context = {
    localStorage: {
      getItem: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
      setItem: function(key, value) { store[key] = String(value); }
    },
    document: {
      getElementById: function() { return null; },
      addEventListener: function() {}
    },
    window: { addEventListener: function() {} },
    navigator: { onLine: true },
    App: {
      authToken: 'token',
      toast: function(message) { toasts.push(message); }
    },
    setTimeout: function(fn, ms) {
      if (!ms) immediate.push(fn);
      return 1;
    },
    clearTimeout: function() {},
    setInterval: function() { return 1; },
    Date: Date,
    Math: Math,
    JSON: JSON,
    Number: Number,
    String: String,
    Array: Array,
    Object: Object,
    isFinite: isFinite,
    parseInt: parseInt
  };
  context.google = {
    script: {
      run: {
        withSuccessHandler: function(fn) { runner.success = fn; return context.google.script.run; },
        withFailureHandler: function(fn) { runner.failure = fn; return context.google.script.run; },
        executeQueuedOperation: function(payload) { runner.payloads.push(payload); }
      }
    }
  };
  runner = { success: null, failure: null, payloads: [] };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js_offline.js'), 'utf8'), context);
  context.__store = store;
  context.__immediate = immediate;
  context.__toasts = toasts;
  context.__runner = runner;
  context.OfflineSync.initialized = true;
  return context;
}

function flush(context) {
  const queued = context.__immediate.splice(0);
  queued.forEach(function(fn) { fn(); });
}

test('種付日の当日から14日前までを日齢つきで作る', function() {
  const breeding = loadBreeding();
  const dates = breeding.SemenCollection.datesForMating('2026-09-29');
  assert.equal(dates.length, 15);
  assert.deepEqual(host(dates[0]), { ageDays: 0, date: '2026-09-29', label: '当日' });
  assert.deepEqual(host(dates[14]), { ageDays: 14, date: '2026-09-15', label: '14日前' });
  assert.equal(breeding.SemenCollection.addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(breeding.SemenCollection.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(breeding.SemenCollection.addDays('2026-02-31', -1), '');
  assert.equal(breeding.SemenCollection.datesForMating('').length, 0);
});

test('採取日チップは種付日を変えても選んだ日齢を保ち、同じボタンで外せる', function() {
  const dom = fakeDom();
  const chips = dom.make('mating-semen-chips');
  const input = dom.make('mating-date');
  input.value = '2026-09-29';
  const breeding = loadBreeding(dom.document);
  breeding.SemenCollection.bind('mating-semen-chips', 'mating-date');
  breeding.SemenCollection.mount('mating-semen-chips', input.value, null);
  assert.equal((chips.innerHTML.match(/data-age="/g) || []).length, 15);
  assert.match(chips.innerHTML, /未選択/);
  assert.equal(breeding.SemenCollection.read('mating-semen-chips'), null);

  chips.listeners.click({
    target: {
      getAttribute: function(name) { return name === 'data-age' ? '3' : null; },
      parentNode: chips
    }
  });
  assert.deepEqual(host(breeding.SemenCollection.read('mating-semen-chips')), {
    semenCollectionDate: '2026-09-26',
    semenAgeDays: 3
  });
  assert.match(chips.innerHTML, /採取 2026-09-26（3日齢）/);
  assert.match(chips.innerHTML, /class="semen-chip selected"/);

  input.value = '2026-09-20';
  input.listeners.input();
  assert.deepEqual(host(breeding.SemenCollection.read('mating-semen-chips')), {
    semenCollectionDate: '2026-09-17',
    semenAgeDays: 3
  });

  chips.listeners.click({
    target: {
      getAttribute: function(name) { return name === 'data-age' ? '3' : null; },
      parentNode: {
        getAttribute: function(name) { return name === 'data-age' ? '3' : null; },
        parentNode: chips
      }
    }
  });
  assert.equal(breeding.SemenCollection.read('mating-semen-chips'), null);
});

test('種付の送信引数は2つのまま、精液採取日は任意項目として残す', function() {
  const context = loadOffline();
  context.OfflineSync.enqueue('recordMating', ['42', '2026-09-29'], null, {
    semenCollectionDate: '2026-09-29',
    semenAgeDays: 0
  });
  context.OfflineSync.enqueue('recordMating', ['42', '2026-09-29'], null, {
    semenCollectionDate: 'bad',
    semenAgeDays: 3
  });
  context.OfflineSync.enqueue('recordMating', ['43', '2026-09-29'], null, {
    semenCollectionDate: '2026-09-15',
    semenAgeDays: 15
  });
  const matings = context.OfflineSync.queue.filter(function(op) { return op.type === 'recordMating'; });
  assert.equal(matings.length, 3);
  assert.deepEqual(matings[0].args, ['42', '2026-09-29']);
  assert.equal(matings[0].semenCollectionDate, '2026-09-29');
  assert.equal(matings[0].semenAgeDays, 0);
  assert.equal(matings[1].semenCollectionDate, undefined);
  assert.equal(matings[2].semenAgeDays, undefined);
  assert.match(context.OfflineSync.describeOperation(matings[0]), /精液0日齢/);

  flush(context);
  assert.equal(context.__runner.payloads.length, 1);
  assert.deepEqual(context.__runner.payloads[0].args, ['42', '2026-09-29']);
  assert.equal(context.__runner.payloads[0].semenCollectionDate, '2026-09-29');
  assert.equal(context.__runner.payloads[0].semenAgeDays, 0);
});

test('同じ削除の連打は1件にまとめ、見つからない再送は成功扱いにする', function() {
  const context = loadOffline();
  const first = context.OfflineSync.enqueue('deleteMatingRecord', ['42', '2026-09-01']);
  const second = context.OfflineSync.enqueue('deleteMatingRecord', ['42', '2026-09-01']);
  assert.equal(first, second);
  assert.equal(context.OfflineSync.lastDuplicate, true);
  assert.equal(context.OfflineSync.queue.length, 1);
  context.OfflineSync.enqueue('deleteMatingRecord', ['42', '2026-09-02']);
  assert.equal(context.OfflineSync.queue.length, 2);

  flush(context);
  context.__runner.success({ success: false, error: '該当する種付記録が見つかりません' });
  assert.equal(context.OfflineSync.queue.length, 1);
  assert.equal(context.OfflineSync.failedCount(), 0);
  assert.equal(context.__toasts.some(function(message) { return message.indexOf('要確認') >= 0; }), false);

  context.OfflineSync.process();
  context.__runner.success({ success: false, error: '種付シートが見つかりません' });
  assert.equal(context.OfflineSync.failedCount(), 1);
  assert.match(context.__toasts.join('\n'), /要確認/);
});

test('削除以外の「見つかりません」と、すでに消えた失敗の再読み込みを区別する', function() {
  const context = loadOffline();
  assert.equal(context.OfflineSync.acceptQueuedResult(
    { type: 'deleteBreedingRecord' },
    { success: false, error: '該当する記録が見つかりません' }
  ), true);
  assert.equal(context.OfflineSync.acceptQueuedResult(
    { type: 'deleteFarrowingRecord' },
    { success: false, error: '該当する分娩記録が見つかりません' }
  ), true);
  assert.equal(context.OfflineSync.acceptQueuedResult(
    { type: 'deleteWeaningRecord' },
    { success: false, error: '該当する離乳記録が見つかりません' }
  ), true);
  assert.equal(context.OfflineSync.acceptQueuedResult(
    { type: 'deletePenTask' },
    { success: false, error: '該当する記録が見つかりません' }
  ), true);
  assert.equal(context.OfflineSync.acceptQueuedResult(
    { type: 'recordMating' },
    { success: false, error: '該当する種付記録が見つかりません' }
  ), false);
  assert.equal(context.OfflineSync.acceptQueuedResult(
    { type: 'updateMatingRecord' },
    { success: false, error: '修正対象の種付記録が見つかりません' }
  ), false);

  const now = Date.now();
  context.localStorage.setItem(context.OfflineSync.storageKey, JSON.stringify([
    { id: 'send-fresh', type: 'deleteMatingRecord', args: ['1', '2026-09-01'], state: 'sending', sendingAt: now, error: '' },
    { id: 'send-stale', type: 'deleteBreedingRecord', args: ['1', '2026-09-01', '', '', ''], state: 'sending', sendingAt: now - 31000, error: '' },
    { id: 'send-legacy', type: 'deletePenTask', args: ['8', '去勢', '2026-09-01'], state: 'sending', error: '' },
    { id: 'gone', type: 'deleteMatingRecord', args: ['1', '2026-09-02'], state: 'failed', error: '該当する種付記録が見つかりません' },
    { id: 'missing-sheet', type: 'deleteFarrowingRecord', args: ['1', '2026-09-01', '10', '0'], state: 'failed', error: '分娩シートが見つかりません' }
  ]));
  const shared = context.OfflineSync.loadQueue({ resetSending: false });
  assert.deepEqual(host(shared.map(function(op) { return op.id + ':' + op.state; })), [
    'send-fresh:sending',
    'send-stale:pending',
    'send-legacy:sending',
    'missing-sheet:failed'
  ]);
  const restarted = context.OfflineSync.loadQueue();
  assert.equal(restarted.every(function(op) { return op.state !== 'sending'; }), true);
  assert.equal(restarted.some(function(op) { return op.id === 'gone'; }), false);
  assert.equal(restarted.some(function(op) { return op.id === 'missing-sheet'; }), true);
});

test('通信中の入力があると、戻ってきた一覧では上書きしない', function() {
  const context = {
    window: null,
    document: {
      getElementById: function() { return null; },
      addEventListener: function() {},
      createElement: function() { return { style: {}, hidden: true, appendChild: function() {}, setAttribute: function() {} }; },
      head: { appendChild: function() {} },
      body: null
    },
    navigator: { onLine: true },
    localStorage: {
      getItem: function() { return null; },
      setItem: function() {}
    },
    URL: URL,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Proxy: Proxy,
    JSON: JSON,
    Date: Date,
    Math: Math,
    Object: Object,
    Array: Array,
    String: String,
    Number: Number,
    Error: Error,
    OfflineSync: { hasPending: function() { return false; } }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'pwa-runtime.js'), 'utf8'), context);
  context.PwaShell.localEpoch = 2;
  assert.equal(context.PwaShell.shouldApplyServerData(2), true);
  context.PwaShell.noteLocalChange();
  assert.equal(context.PwaShell.shouldApplyServerData(2), false);
  context.OfflineSync.hasPending = function() { return true; };
  assert.equal(context.PwaShell.shouldApplyServerData(context.PwaShell.localEpoch), false);
});

test('確認を閉じた直後のクリックは捨て、同じボタンの連打だけを止める', function() {
  const listeners = {};
  const context = {
    __authToken: '',
    document: { addEventListener: function(name, fn) { listeners[name] = fn; } },
    setTimeout: function() { return 1; },
    clearTimeout: function() {},
    Date: Date,
    confirm: function() { throw new Error('confirm should not open'); }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js_app.js'), 'utf8'), context);
  context.App.armTapShield(1000);
  let stopped = false;
  context.App.prepareActionTap({
    type: 'click',
    target: { tagName: 'BUTTON' },
    preventDefault: function() { stopped = true; },
    stopPropagation: function() { stopped = true; }
  });
  assert.equal(stopped, true);
  assert.equal(context.App.confirmAction('削除しますか？'), false);

  context.App.tapShieldUntil = 0;
  let confirmed = 0;
  context.confirm = function() { confirmed++; return true; };
  assert.equal(context.App.confirmAction('削除しますか？'), true);
  assert.equal(confirmed, 1);
  assert.equal(context.App.tapShielded(), true);

  context.App.tapShieldUntil = 0;
  assert.equal(context.App.tryAction('preg:42'), true);
  assert.equal(context.App.tryAction('preg:42'), false);
  assert.equal(context.App.tryAction('preg:43'), true);
});
