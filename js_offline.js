// 電波が弱い場所向けの端末保存・順次同期

var OfflineSync = {
  storageKey: 'breedingOfflineQueue_v1',
  queue: [],
  callbacks: {},
  sending: false,
  activeSendToken: '',
  retryTimer: null,
  initialized: false,
  storageAvailable: true,

  init: function() {
    if (OfflineSync.initialized) return;
    var storedQueue = null;
    try { storedQueue = localStorage.getItem(OfflineSync.storageKey); } catch (e) {}
    OfflineSync.queue = OfflineSync.loadQueue();
    OfflineSync.initialized = true;
    if (storedQueue !== JSON.stringify(OfflineSync.queue)) OfflineSync.saveQueue();

    window.addEventListener('online', function() {
      OfflineSync.retryPendingNow();
    });
    window.addEventListener('offline', function() {
      OfflineSync.updateStatus();
    });
    window.addEventListener('storage', function(e) {
      if (e.key !== OfflineSync.storageKey || OfflineSync.sending) return;
      // 他画面が送信中の操作を pending に戻すと、同じ削除が二重に飛ぶ。
      OfflineSync.queue = OfflineSync.loadQueue({ resetSending: false });
      OfflineSync.updateStatus();
      OfflineSync.process();
    });
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) OfflineSync.process();
    });

    OfflineSync.updateStatus();
    setTimeout(function() { OfflineSync.process(); }, 300);
    setInterval(function() { OfflineSync.process(); }, 30000);
  },

  loadQueue: function(options) {
    var resetSending = !options || options.resetSending !== false;
    try {
      var raw = localStorage.getItem(OfflineSync.storageKey);
      var list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      var kept = [];
      for (var i = 0; i < list.length; i++) {
        // 先に消えていた削除は、再起動後も「要確認」のまま残さない。
        if (list[i].state === 'failed' && OfflineSync.isAlreadyDeletedFailure(list[i], list[i].error)) continue;
        if (list[i].state === 'sending') {
          // 起動時は途中送信を再送する。他画面の新しい送信中は奪わない。
          var sendAge = Date.now() - Number(list[i].sendingAt || 0);
          var staleSend = !!list[i].sendingAt && sendAge > 30000;
          if (resetSending || staleSend) list[i].state = 'pending';
        }
        // 再ログイン後は新しい認証トークンで自動再送する。
        if (list[i].state === 'failed' && String(list[i].error || '').indexOf('認証が切れました') >= 0) {
          list[i].state = 'pending';
          list[i].attempts = 0;
          list[i].nextAttemptAt = 0;
        }
        kept.push(list[i]);
      }
      return kept;
    } catch (e) {
      OfflineSync.storageAvailable = false;
      return [];
    }
  },

  saveQueue: function() {
    try {
      localStorage.setItem(OfflineSync.storageKey, JSON.stringify(OfflineSync.queue));
      OfflineSync.storageAvailable = true;
      return true;
    } catch (e) {
      OfflineSync.storageAvailable = false;
      return false;
    }
  },

  createId: function() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'op-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
  },

  isDeleteOperation: function(type) {
    return /^delete/.test(String(type || ''));
  },

  deleteKey: function(type, args) {
    if (!OfflineSync.isDeleteOperation(type)) return '';
    var list = args || [];
    var parts = [String(type)];
    for (var i = 0; i < list.length; i++) parts.push(String(list[i]));
    return parts.join('\n');
  },

  /**
   * 失敗済みも含めて同じ削除を探す。
   * 失敗を無視すると、同じ行の押し直しのたびに「要確認」が1件増える。
   */
  findActiveDuplicate: function(type, args) {
    var key = OfflineSync.deleteKey(type, args);
    if (!key) return null;
    for (var i = 0; i < OfflineSync.queue.length; i++) {
      var op = OfflineSync.queue[i];
      if (OfflineSync.deleteKey(op.type, op.args) === key) return op;
    }
    return null;
  },

  normalizeErrorText: function(error) {
    return String(error == null ? '' : error).replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim();
  },

  /**
   * 同じ削除を続けて送ると、2件目はサーバーが「該当する記録が見つかりません」と返す。
   * 句点や「でした」、先頭の例外名が付いても同じ扱いにする。
   * シート自体が無い場合は文言が違うので、成功にはしない。
   */
  isAlreadyDeletedFailure: function(op, error) {
    if (!op || !OfflineSync.isDeleteOperation(op.type)) return false;
    var text = OfflineSync.normalizeErrorText(error).replace(/[。．.]+$/g, '');
    if (!text || text.indexOf('シートが見つかりません') >= 0) return false;
    return /該当する(種付|分娩|離乳)?記録が見つかりません(でした)?/.test(text);
  },

  acceptQueuedResult: function(op, res) {
    if (res && res.success) return true;
    if (res && res.alreadyDeleted && op && OfflineSync.isDeleteOperation(op.type)) return true;
    return OfflineSync.isAlreadyDeletedFailure(op, res && res.error);
  },

  /** 画面を開き直す前でも、同期処理の途中で削除済みの失敗を捨てる。 */
  dropResolvedFailures: function() {
    var before = OfflineSync.queue.length;
    OfflineSync.queue = OfflineSync.queue.filter(function(op) {
      return !(op && op.state === 'failed' && OfflineSync.isAlreadyDeletedFailure(op, op.error));
    });
    if (OfflineSync.queue.length !== before) OfflineSync.saveQueue();
    return before !== OfflineSync.queue.length;
  },

  resultErrorText: function(op, res) {
    if (res && res.error) return String(res.error);
    var brief = '';
    try { brief = JSON.stringify(res); } catch (e) { brief = String(res); }
    if (!brief) brief = '空の応答';
    if (brief.length > 160) brief = brief.slice(0, 160) + '…';
    return '保存できませんでした（' + ((op && op.type) || '記録') + ' / 応答: ' + brief + '）';
  },

  explainFailure: function(error) {
    var text = OfflineSync.normalizeErrorText(error);
    if (!text) return 'サーバーから理由が返りませんでした';
    if (text.indexOf('種付の見出し書き込み（E1:F1）') === 0 || text.indexOf('種付シートE1:F1') >= 0) return text;
    if (/number of columns in the data does not match|データの列数|列数が一致しません/.test(text)) {
      return '種付の見出し書き込み（E1:F1）が列数不一致で失敗し、この種付はシートに残っていません。サーバー応答: ' + text;
    }
    return text;
  },

  shortReason: function(error, limit) {
    var text = OfflineSync.explainFailure(error);
    var max = limit || 120;
    if (text.length > max) text = text.slice(0, max) + '…';
    return text;
  },

  failureSummary: function() {
    var groups = [];
    var byReason = {};
    for (var i = 0; i < OfflineSync.queue.length; i++) {
      var op = OfflineSync.queue[i];
      if (!op || op.state !== 'failed') continue;
      var reason = String(op.error || '');
      if (!byReason[reason]) {
        byReason[reason] = { reason: reason, labels: [] };
        groups.push(byReason[reason]);
      }
      var label = OfflineSync.describeOperation(op);
      if (op.id) label += ' [' + String(op.id).slice(0, 8) + ']';
      byReason[reason].labels.push(label);
    }
    if (!groups.length) return '';
    var lines = [];
    var maxGroups = 5;
    for (var g = 0; g < groups.length && g < maxGroups; g++) {
      var labels = groups[g].labels;
      var shown = labels.slice(0, 3).join('、');
      if (labels.length > 3) shown += ' ほか' + (labels.length - 3) + '件';
      lines.push(labels.length + '件 ' + shown);
      lines.push('理由: ' + OfflineSync.shortReason(groups[g].reason, 140));
    }
    if (groups.length > maxGroups) lines.push('ほかの理由 ' + (groups.length - maxGroups) + '種');
    return lines.join('\n');
  },

  normalizeSemenMeta: function(meta) {
    if (!meta) return null;
    var date = String(meta.semenCollectionDate || '');
    var age = Number(meta.semenAgeDays);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    if (!isFinite(age) || age < 0 || age > 14 || Math.floor(age) !== age) return null;
    return { semenCollectionDate: date, semenAgeDays: age };
  },

  enqueue: function(type, args, handlers, meta) {
    var duplicate = OfflineSync.findActiveDuplicate(type, args || []);
    if (duplicate) {
      if (duplicate.state === 'failed' && OfflineSync.isAlreadyDeletedFailure(duplicate, duplicate.error)) {
        OfflineSync.removeOperation(duplicate.id);
        OfflineSync.lastDuplicate = true;
        OfflineSync.updateStatus();
        return duplicate.id;
      }
      if (duplicate.state === 'failed') {
        duplicate.state = 'pending';
        duplicate.attempts = 0;
        duplicate.nextAttemptAt = 0;
        duplicate.error = '';
        delete duplicate.sendingAt;
        OfflineSync.callbacks[duplicate.id] = handlers || OfflineSync.callbacks[duplicate.id] || {};
        OfflineSync.lastDuplicate = false;
        if (!OfflineSync.saveQueue() && typeof App !== 'undefined') {
          App.toast('端末保存エラー。画面を閉じずに電波のある場所へ移動してください');
        }
        OfflineSync.updateStatus();
        setTimeout(function() { OfflineSync.process(); }, 0);
        return duplicate.id;
      }
      OfflineSync.lastDuplicate = true;
      return duplicate.id;
    }
    OfflineSync.lastDuplicate = false;
    var op = {
      id: OfflineSync.createId(),
      type: type,
      args: args || [],
      createdAt: new Date().toISOString(),
      attempts: 0,
      nextAttemptAt: 0,
      state: 'pending',
      error: ''
    };
    var semen = type === 'recordMating' ? OfflineSync.normalizeSemenMeta(meta) : null;
    if (semen) {
      op.semenCollectionDate = semen.semenCollectionDate;
      op.semenAgeDays = semen.semenAgeDays;
    }
    OfflineSync.queue.push(op);
    OfflineSync.callbacks[op.id] = handlers || {};
    if (!OfflineSync.saveQueue() && typeof App !== 'undefined') {
      App.toast('端末保存エラー。画面を閉じずに電波のある場所へ移動してください');
    }
    OfflineSync.updateStatus();
    setTimeout(function() { OfflineSync.process(); }, 0);
    return op.id;
  },

  pendingCount: function() {
    var count = 0;
    for (var i = 0; i < OfflineSync.queue.length; i++) {
      if (OfflineSync.queue[i].state !== 'failed') count++;
    }
    return count;
  },

  failedCount: function() {
    var count = 0;
    for (var i = 0; i < OfflineSync.queue.length; i++) {
      if (OfflineSync.queue[i].state === 'failed') count++;
    }
    return count;
  },

  hasPending: function() {
    return OfflineSync.pendingCount() > 0;
  },

  isOnline: function() {
    return typeof navigator.onLine !== 'boolean' || navigator.onLine;
  },

  updateStatus: function() {
    var el = document.getElementById('sync-status');
    if (!el) return;
    var pending = OfflineSync.pendingCount();
    var failed = OfflineSync.failedCount();
    el.className = 'sync-status';

    if (!OfflineSync.storageAvailable) {
      el.textContent = '端末保存不可';
      el.classList.add('sync-failed');
      el.title = '未送信記録を端末へ保存できません';
    } else if (failed > 0) {
      el.textContent = '要確認 ' + failed;
      el.classList.add('sync-failed');
      el.title = OfflineSync.failureSummary() || 'タップして内容を確認';
    } else if (pending > 0 && !OfflineSync.isOnline()) {
      el.textContent = '通信待ち ' + pending;
      el.classList.add('sync-waiting');
      el.title = '電波が戻ると自動送信します';
    } else if (pending > 0 && OfflineSync.sending) {
      el.textContent = '送信中 ' + pending;
      el.classList.add('sync-sending');
      el.title = '未送信記録を送信しています';
    } else if (pending > 0) {
      el.textContent = '未送信 ' + pending;
      el.classList.add('sync-waiting');
      var hinted = '';
      for (var p = 0; p < OfflineSync.queue.length; p++) {
        if (OfflineSync.queue[p].state === 'pending' && OfflineSync.queue[p].error) {
          hinted = OfflineSync.shortReason(OfflineSync.queue[p].error, 80);
          break;
        }
      }
      el.title = hinted ? ('再送待ち: ' + hinted) : 'タップして再送';
    } else {
      el.textContent = '同期済';
      el.classList.add('sync-ok');
      el.title = 'すべての記録を送信済みです';
    }
  },

  showStatus: function() {
    OfflineSync.dropResolvedFailures();
    var failed = OfflineSync.failedCount();
    var pending = OfflineSync.pendingCount();
    if (failed > 0) {
      var summary = OfflineSync.failureSummary();
      if (confirm('送信できない記録が' + failed + '件あります。\n' + summary + '\n\n再送しますか？')) {
        OfflineSync.retryFailed();
      }
      return;
    }
    if (pending > 0) {
      if (typeof App !== 'undefined') {
        App.toast(OfflineSync.isOnline() ? '未送信記録を再送します' : '通信待ちです。電波が戻ると自動送信します');
      }
      OfflineSync.retryPendingNow();
      return;
    }
    if (typeof App !== 'undefined') App.toast('すべて同期済みです');
  },

  retryFailed: function() {
    for (var i = 0; i < OfflineSync.queue.length; i++) {
      if (OfflineSync.queue[i].state !== 'failed') continue;
      OfflineSync.queue[i].state = 'pending';
      OfflineSync.queue[i].attempts = 0;
      OfflineSync.queue[i].nextAttemptAt = 0;
      OfflineSync.queue[i].error = '';
    }
    OfflineSync.saveQueue();
    OfflineSync.updateStatus();
    OfflineSync.process();
  },

  retryPendingNow: function() {
    for (var i = 0; i < OfflineSync.queue.length; i++) {
      if (OfflineSync.queue[i].state === 'pending') OfflineSync.queue[i].nextAttemptAt = 0;
    }
    OfflineSync.saveQueue();
    OfflineSync.updateStatus();
    OfflineSync.process();
  },

  firstPending: function() {
    for (var i = 0; i < OfflineSync.queue.length; i++) {
      if (OfflineSync.queue[i].state === 'pending') return OfflineSync.queue[i];
    }
    return null;
  },

  process: function() {
    if (!OfflineSync.initialized || OfflineSync.sending) return;
    if (OfflineSync.retryTimer) {
      clearTimeout(OfflineSync.retryTimer);
      OfflineSync.retryTimer = null;
    }
    if (OfflineSync.dropResolvedFailures()) OfflineSync.updateStatus();

    var op = OfflineSync.firstPending();
    if (!op) {
      OfflineSync.updateStatus();
      return;
    }
    if (!OfflineSync.isOnline()) {
      OfflineSync.updateStatus();
      return;
    }

    var waitMs = Math.max(0, Number(op.nextAttemptAt || 0) - Date.now());
    if (waitMs > 0) {
      OfflineSync.schedule(waitMs);
      OfflineSync.updateStatus();
      return;
    }

    OfflineSync.sending = true;
    op.state = 'sending';
    op.sendingAt = Date.now();
    OfflineSync.saveQueue();
    OfflineSync.updateStatus();

    var sendToken = op.id + ':' + Date.now() + ':' + Math.random();
    OfflineSync.activeSendToken = sendToken;
    var timeoutId = setTimeout(function() {
      OfflineSync.retryOperation(op, sendToken, '応答待ちがタイムアウトしました');
    }, 25000);

    // 採取日が無くても args は2つのまま送る。未選択を理由に種付は止めない。
    // サーバーの ensureMatingSemenHeaders_ は E1 が空のときだけ見出しを書く。
    // getRange(1, 5, 1, 6) は6列範囲なので、空のE1だと2列の見出し書き込みで種付全体が失敗する。
    // 正しくは getRange(1, 5, 1, 2)。このリポジトリから本番GASは更新しない。
    var payload = {
      id: op.id,
      type: op.type,
      args: op.args,
      createdAt: op.createdAt
    };
    if (op.semenCollectionDate) {
      payload.semenCollectionDate = op.semenCollectionDate;
      payload.semenAgeDays = op.semenAgeDays;
    }

    google.script.run
      .withSuccessHandler(function(res) {
        if (OfflineSync.activeSendToken !== sendToken) return;
        clearTimeout(timeoutId);
        if (OfflineSync.acceptQueuedResult(op, res)) {
          OfflineSync.completeOperation(op, sendToken, res);
        } else if (res && res.retryable) {
          OfflineSync.retryOperation(op, sendToken, res.error || '一時的な保存エラー');
        } else {
          OfflineSync.failOperation(op, sendToken, OfflineSync.resultErrorText(op, res));
        }
      })
      .withFailureHandler(function(e) {
        if (OfflineSync.activeSendToken !== sendToken) return;
        clearTimeout(timeoutId);
        var message = OfflineSync.errorText(e);
        if (OfflineSync.isAlreadyDeletedFailure(op, message)) {
          OfflineSync.completeOperation(op, sendToken, { success: true, alreadyDeleted: true });
          return;
        }
        OfflineSync.retryOperation(op, sendToken, message);
      })
      .executeQueuedOperation(payload, App.authToken);
  },

  completeOperation: function(op, sendToken, result) {
    if (OfflineSync.activeSendToken !== sendToken) return;
    OfflineSync.activeSendToken = '';
    OfflineSync.sending = false;
    OfflineSync.removeOperation(op.id);
    var handlers = OfflineSync.callbacks[op.id] || {};
    delete OfflineSync.callbacks[op.id];
    if (handlers.onSuccess) handlers.onSuccess(result);
    OfflineSync.updateStatus();
    setTimeout(function() { OfflineSync.process(); }, 50);
  },

  retryOperation: function(op, sendToken, error) {
    if (OfflineSync.activeSendToken !== sendToken) return;
    OfflineSync.activeSendToken = '';
    OfflineSync.sending = false;
    op.state = 'pending';
    op.attempts = Number(op.attempts || 0) + 1;
    op.error = error || '通信エラー';
    var delays = [5000, 15000, 30000, 60000];
    var delay = delays[Math.min(op.attempts - 1, delays.length - 1)];
    op.nextAttemptAt = Date.now() + delay;
    OfflineSync.saveQueue();
    OfflineSync.updateStatus();
    OfflineSync.schedule(delay);
  },

  failOperation: function(op, sendToken, error) {
    if (OfflineSync.activeSendToken !== sendToken) return;
    if (OfflineSync.isAlreadyDeletedFailure(op, error)) {
      OfflineSync.completeOperation(op, sendToken, { success: true, alreadyDeleted: true });
      return;
    }
    OfflineSync.activeSendToken = '';
    OfflineSync.sending = false;
    op.state = 'failed';
    op.error = error || '保存できませんでした';
    OfflineSync.saveQueue();
    var handlers = OfflineSync.callbacks[op.id] || {};
    if (handlers.onError) handlers.onError(op.error);
    if (typeof console !== 'undefined' && console.warn) console.warn('[要確認]', op.type, op.id, op.error);
    if (typeof App !== 'undefined') App.toast('要確認: ' + OfflineSync.shortReason(op.error, 70));
    OfflineSync.updateStatus();
    setTimeout(function() { OfflineSync.process(); }, 50);
  },

  removeOperation: function(id) {
    OfflineSync.queue = OfflineSync.queue.filter(function(op) { return op.id !== id; });
    OfflineSync.saveQueue();
  },

  schedule: function(delay) {
    if (OfflineSync.retryTimer) clearTimeout(OfflineSync.retryTimer);
    OfflineSync.retryTimer = setTimeout(function() {
      OfflineSync.retryTimer = null;
      OfflineSync.process();
    }, Math.max(100, Math.min(delay, 60000)));
  },

  errorText: function(e) {
    if (!e) return '通信エラー';
    return e.message || String(e);
  },

  describeOperation: function(op) {
    var labels = {
      recordMovement: '移動',
      recordBTValue: 'BT値',
      recordStatusChange: '状態変更',
      recordMating: '種付',
      recordFarrowing: '分娩',
      recordNursingAccident: '事故・死亡',
      recordPenTasks: '作業記録',
      deletePenTask: '作業取消',
      deleteBreedingRecord: '繁殖記録削除',
      deleteMatingRecord: '種付削除',
      deleteFarrowingRecord: '分娩削除',
      deleteWeaningRecord: '離乳削除'
    };
    var args = op.args || [];
    var target = op.type === 'recordPenTasks' || op.type === 'deletePenTask'
      ? 'Pen ' + String(args[0] || '')
      : 'No.' + String(args[0] || '');
    var text = (labels[op.type] || op.type || '記録') + ' ' + target;
    if (op.type === 'recordMating' && op.semenCollectionDate) {
      text += ' 精液' + op.semenAgeDays + '日齢';
    }
    return text;
  }
};
