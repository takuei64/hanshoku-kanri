// 繁殖管理画面（移動記録統合）

var Breeding = {
  list: [],
  selectedSow: null,
  pendingAction: null,
  moveFormOpen: false,

  /** 繁殖・種後・再発の3リストをペン番号昇順の1本に統合する
      （ブリードテスタ計測をストール順に一筆書きで回れるようにするため） */
  buildMergedList: function() {
    var merged = [];
    var i;
    for (i = 0; i < Breeding.list.length; i++) merged.push({ kind: 'breeding', s: Breeding.list[i] });
    for (i = 0; i < PostMating.list.length; i++) merged.push({ kind: 'postmating', s: PostMating.list[i] });
    for (i = 0; i < ReheatCheck.list.length; i++) merged.push({ kind: 'reheat', s: ReheatCheck.list[i] });
    merged.sort(function(a, b) {
      var penA = parseInt(a.s.penNo, 10) || 99999;
      var penB = parseInt(b.s.penNo, 10) || 99999;
      if (penA !== penB) return penA - penB;
      return (parseInt(a.s.sowNo, 10) || 0) - (parseInt(b.s.sowNo, 10) || 0);
    });
    return merged;
  },

  /** カードの種別（色分けクラスとラベル）。ステータス判定ロジック自体は従来のまま */
  typeInfo: function(item) {
    if (item.kind === 'postmating') return { cls: 'type-postmating', label: '種後' };
    if (item.kind === 'reheat') return { cls: 'type-reheat', label: '再発チェック' };
    var reason = String(item.s.reason || '');
    if (reason.indexOf('空胎') >= 0) return { cls: 'type-empty', label: '空胎' };
    if (reason.indexOf('離乳') >= 0) return { cls: 'type-weaned', label: '離乳' };
    return { cls: 'type-rearing', label: '育成' };
  },

  /** キャッシュ済みデータで描画（サーバー呼出し不要） */
  render: function() {
    App.setDateDefault('move-date');

    var container = document.getElementById('breeding-list');
    var merged = Breeding.buildMergedList();
    if (merged.length === 0) {
      container.innerHTML =
        '<div class="empty-state">' +
          '<div class="icon">&#10003;</div>' +
          '<div>チェック対象はありません</div>' +
        '</div>';
      return;
    }

    // 種別サマリー（凡例を兼ねる）
    var counts = {};
    var order = ['離乳', '育成', '空胎', '種後', '再発チェック'];
    var clsMap = { '離乳': 'type-weaned', '育成': 'type-rearing', '空胎': 'type-empty', '種後': 'type-postmating', '再発チェック': 'type-reheat' };
    for (var m = 0; m < merged.length; m++) {
      var label = Breeding.typeInfo(merged[m]).label;
      counts[label] = (counts[label] || 0) + 1;
    }
    var html = '<div class="type-summary">';
    for (var o = 0; o < order.length; o++) {
      if (counts[order[o]]) {
        html += '<span class="type-chip ' + clsMap[order[o]] + '">' + order[o] + ' ' + counts[order[o]] + '</span>';
      }
    }
    html += '</div>';

    for (var i = 0; i < merged.length; i++) {
      var item = merged[i];
      var s = item.s;
      var t = Breeding.typeInfo(item);
      var cardId = item.kind === 'postmating' ? 'postmating-' + s.sowNo
                 : item.kind === 'reheat' ? 'reheat-' + s.sowNo
                 : 'card-' + s.sowNo;

      html += '<div class="card ' + t.cls + '" id="' + cardId + '">';
      html += '<div class="card-header">';
      html += '<span class="sow-no">No.' + s.sowNo + ' <span class="type-chip ' + t.cls + '">' + t.label + '</span></span>';
      html += '<span class="pen-no">Pen ' + s.penNo + '</span>';
      html += '</div>';

      if (item.kind === 'postmating') {
        html += '<div class="reason-label">種付' + s.days + '日目（' + s.mateDate + '）</div>';
      } else if (item.kind === 'reheat') {
        html += '<div class="reason-label">' + (s.detailPrefix || '種付後') + s.days + '日目（' + (s.eventDate || s.mateDate) + '）</div>';
      } else {
        html += '<div class="reason-label">' + s.reason + '</div>';
      }

      if (s.status) {
        html += '<span class="status-badge ' + App.getStatusBadgeClass(s.status) + '">' + s.status + '</span>';
      }

      html += Breeding.renderHistory(s);

      if (s.btHistory && s.btHistory.length > 0) {
        html += '<div class="bt-history">';
        for (var j = 0; j < s.btHistory.length; j++) {
          var b = s.btHistory[j];
          html += '<span class="bt-chip bt-deletable" onclick="event.stopPropagation();Breeding.confirmDeleteBT(\'' + s.sowNo + '\',\'' + b.date + '\',' + b.bt + ')">' + (b.date || '').slice(5) + ' ' + b.bt + '</span>';
        }
        html += '</div>';
      }

      html += '<div class="action-buttons">';
      html += '<button class="btn-bt" onclick="Breeding.openBTModal(\'' + s.sowNo + '\')">BT値</button>';
      if (item.kind === 'postmating') {
        html += '<button class="btn-mate" onclick="Breeding.openMatingModal(\'' + s.sowNo + '\')">追い種付</button>';
        html += '<button class="btn-done" onclick="PostMating.confirmDone(\'' + s.sowNo + '\')">測定終了</button>';
      } else if (item.kind === 'reheat') {
        html += '<button class="btn-mate" onclick="Breeding.openMatingModal(\'' + s.sowNo + '\')">再種付</button>';
        html += '<button class="btn-pregnant" onclick="Breeding.openStatusModal(\'' + s.sowNo + '\', \'妊娠鑑定済\')">妊娠鑑定</button>';
        html += '<button class="btn-done" onclick="ReheatCheck.confirmDone(\'' + s.sowNo + '\')">再発情確認終了</button>';
      } else {
        html += '<button class="btn-mate" onclick="Breeding.openMatingModal(\'' + s.sowNo + '\')">種付</button>';
        html += '<button class="btn-done" onclick="Breeding.openStatusModal(\'' + s.sowNo + '\', \'測定終了\')">測定終了</button>';
      }
      html += '</div>';
      html += '</div>';
    }
    container.innerHTML = html;
  },

  /** 同期済みの履歴と未送信の変更を分けて表示する。 */
  renderHistory: function(s) {
    function esc(value) {
      return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function(c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    var pending = typeof OfflineSync !== 'undefined' && (OfflineSync.queue || []).some(function(op) {
      return String((op.args || [])[0]) === String(s.sowNo) &&
        /^(recordMating|recordStatusChange|recordFarrowing|recordWeaning|deleteMatingRecord|deleteBreedingRecord|deleteFarrowingRecord|deleteWeaningRecord|updateMatingRecord|updateFarrowingRecord|updateWeaningRecord)$/.test(op.type);
    });
    var h = s.reproductiveHistory;
    var html = '<div class="reproductive-history">';
    if (pending) html += '<div class="history-pending">未同期の変更あり・履歴は同期後に更新</div>';
    if (!h) return html + '<div class="history-note">繁殖履歴はオンライン更新後に表示</div></div>';
    html += '<div class="history-counts"><strong>' + esc(h.origin) + '・種付 ' + esc(h.attempts) + '回' +
      (h.attempts ? '目' : '') + '（目安）</strong>';
    if (h.returns) html += '<span class="history-failure">再発歴 ' + esc(h.returns) + '回</span>';
    if (h.empties) html += '<span class="history-failure">空胎歴 ' + esc(h.empties) + '回</span>';
    html += '</div>';
    var events = h.events || [];
    var path = [h.origin];
    events.forEach(function(e) { if (e.type !== 'mating' || e.label.indexOf('追い') !== 0) path.push(e.label + (e.note ? '（日付不明）' : '')); });
    html += '<div class="history-path">' + path.map(esc).join(' → ') + '</div>';
    if (events.length) {
      html += '<details class="history-details"><summary>日付・追い種付を確認</summary><ol>';
      if (h.originDate) html += '<li><time>' + esc(h.originDate) + '</time> ' + esc(h.origin) + '</li>';
      events.forEach(function(e) {
        html += '<li><time>' + esc(e.date || '日付不明') + '</time> ' + esc(e.label) + (e.note ? '（' + esc(e.note) + '）' : '') + '</li>';
      });
      html += '</ol><div class="history-note">直近の分娩・離乳以降の記録。種付初日から3日以内は追い種付として集計。再種付の理由は記録がある場合に表示。</div>';
      if (h.sameDayUncertain) html += '<div class="history-note">同日の種付と判定は前後関係を確認してください。</div>';
      html += '</details>';
    }
    return html + '</div>';
  },

  getBadgeClass: function(status) {
    return App.getStatusBadgeClass(status);
  },

  /** カードをローカルで除去（サーバー再取得不要）
      統合リストでは再発・種後のリストにも同じ豚がいる可能性があるため全部から外す */
  removeCard: function(sowNo) {
    sowNo = String(sowNo);
    Breeding.list = Breeding.list.filter(function(s) { return String(s.sowNo) !== sowNo; });
    ReheatCheck.list = ReheatCheck.list.filter(function(s) { return String(s.sowNo) !== sowNo; });
    PostMating.list = PostMating.list.filter(function(s) { return String(s.sowNo) !== sowNo; });
    Breeding.render();
  },

  /** BT値をローカルのカードに追加表示 */
  addBTLocal: function(sowNo, bt, dateStr) {
    sowNo = String(sowNo);
    for (var i = 0; i < Breeding.list.length; i++) {
      if (String(Breeding.list[i].sowNo) === sowNo) {
        Breeding.list[i].btHistory.unshift({ date: dateStr, bt: bt });
        if (Breeding.list[i].btHistory.length > 7) Breeding.list[i].btHistory.pop();
        break;
      }
    }
    Breeding.render();
  },

  // --- 移動記録フォーム ---
  toggleMoveForm: function() {
    Breeding.moveFormOpen = !Breeding.moveFormOpen;
    document.getElementById('move-form').style.display = Breeding.moveFormOpen ? 'block' : 'none';
    document.getElementById('move-toggle-label').textContent =
      Breeding.moveFormOpen ? '－ 閉じる' : '＋ 移動記録を追加';
    if (Breeding.moveFormOpen) App.setDateDefault('move-date');
  },

  submitMove: function() {
    var sowNo = document.getElementById('move-sow').value.trim();
    var penNo = document.getElementById('move-pen').value.trim();
    var dateStr = document.getElementById('move-date').value;

    if (!sowNo) { App.toast('母豚番号を入力してください'); return; }
    if (!penNo) { App.toast('ペンNoを入力してください'); return; }
    if (!App.tryAction('move-submit')) return;

    OfflineSync.enqueue('recordMovement', [sowNo, penNo, dateStr]);
    document.getElementById('move-sow').value = '';
    document.getElementById('move-pen').value = '';
    App.toast('移動を記録しました');
  },

  // --- BT値入力 ---
  openBTModal: function(sowNo) {
    Breeding.selectedSow = sowNo;
    document.getElementById('bt-sow-label').textContent = 'No.' + sowNo;
    document.getElementById('bt-value').value = '';
    App.setDateDefault('bt-date');
    App.showModal('bt-modal');
  },

  submitBT: function() {
    var bt = parseFloat(document.getElementById('bt-value').value);
    var dateStr = document.getElementById('bt-date').value;
    if (isNaN(bt)) { App.toast('BT値を入力してください'); return; }
    if (!App.tryAction('bt-submit')) return;

    var sowNo = Breeding.selectedSow;
    App.hideModal('bt-modal');
    App.armTapShield(400);

    // ローカル更新（即座に反映）
    Breeding.addBTLocal(sowNo, bt, dateStr);
    if (typeof ReheatCheck !== 'undefined' && ReheatCheck.addBTLocal) {
      ReheatCheck.addBTLocal(sowNo, bt, dateStr);
    }
    if (typeof PostMating !== 'undefined' && PostMating.addBTLocal) {
      PostMating.addBTLocal(sowNo, bt, dateStr);
    }
    App.toast('BT値を記録しました');

    OfflineSync.enqueue('recordBTValue', [sowNo, bt, dateStr]);
  },

  // --- 種付実施（モーダル） ---
  openMatingModal: function(sowNo) {
    Breeding.pendingAction = { type: 'mating', sowNo: sowNo };
    document.getElementById('status-modal-title').textContent = '種付実施 No.' + sowNo;
    document.getElementById('status-modal-desc').textContent = '種付シートに追加されます';
    document.getElementById('status-semen-block').hidden = false;
    App.setDateDefault('status-date');
    SemenCollection.bind('status-semen-chips', 'status-date');
    SemenCollection.mount('status-semen-chips', document.getElementById('status-date').value, null);
    App.showModal('status-modal');
  },

  // --- ステータス変更（モーダル） ---
  openStatusModal: function(sowNo, status) {
    Breeding.pendingAction = { type: 'status', sowNo: sowNo, status: status };
    document.getElementById('status-modal-title').textContent = status + ' No.' + sowNo;
    document.getElementById('status-modal-desc').textContent = 'チェック対象から外れます';
    document.getElementById('status-semen-block').hidden = true;
    App.setDateDefault('status-date');
    App.showModal('status-modal');
  },

  /** ステータス/種付モーダルの確定ボタン */
  confirmStatus: function() {
    if (App.tapShielded()) return;
    var action = Breeding.pendingAction;
    if (!action) return;
    var dateStr = document.getElementById('status-date').value;
    if (action.type === 'mating' && !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) {
      App.toast('種付日を確認してください');
      return;
    }
    if (!App.tryAction('status-submit')) return;
    App.hideModal('status-modal');
    App.armTapShield(400);

    if (action.type === 'mating') {
      var meta = SemenCollection.read('status-semen-chips');
      App.toast('種付実施を記録しました' + SemenCollection.toastSuffix(meta));
      OfflineSync.enqueue('recordMating', [action.sowNo, dateStr], null, meta);
      Breeding.render();
    } else {
      // ステータス変更のみチェック対象から外す。種付はリストに残す。
      if (action.status === '廃用' && typeof SowLocation !== 'undefined' && SowLocation.removeSowLocal) {
        SowLocation.removeSowLocal(action.sowNo);
      } else {
        Breeding.removeCard(action.sowNo);
      }
      App.toast(action.status + ' を記録しました');
      OfflineSync.enqueue('recordStatusChange', [action.sowNo, action.status, dateStr]);
    }
    Breeding.pendingAction = null;
  },

  /** 同じ母豚が複数区分に表示されていても、削除したBT値を全カードから消す */
  removeBTLocal: function(sowNo, dateStr, bt) {
    sowNo = String(sowNo);
    var lists = [Breeding.list];
    if (typeof PostMating !== 'undefined') lists.push(PostMating.list);
    if (typeof ReheatCheck !== 'undefined') lists.push(ReheatCheck.list);

    for (var l = 0; l < lists.length; l++) {
      for (var i = 0; i < lists[l].length; i++) {
        var sow = lists[l][i];
        if (String(sow.sowNo) !== sowNo || !sow.btHistory) continue;
        for (var j = 0; j < sow.btHistory.length; j++) {
          var item = sow.btHistory[j];
          var sameValue = Math.abs(Number(item.bt) - Number(bt)) <= 0.001;
          if (String(item.date) === String(dateStr) && sameValue) {
            sow.btHistory.splice(j, 1);
            break;
          }
        }
      }
    }
  },

  // --- タップ削除 ---
  confirmDeleteBT: function(sowNo, dateStr, bt) {
    if (!App.confirmAction('BT値 ' + bt + '（' + dateStr + '）を削除しますか？')) return;
    sowNo = String(sowNo);
    Breeding.removeBTLocal(sowNo, dateStr, bt);
    Breeding.render();
    App.toast('削除しました');
    OfflineSync.enqueue('deleteBreedingRecord', [sowNo, dateStr, '', bt, '']);
  }
};

/** 種付日を0日齢として、当日〜14日前の精液採取日を選ぶ。 */
var SemenCollection = {
  MAX_AGE: 14,

  parseIso: function(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    var year = Number(m[1]);
    var month = Number(m[2]);
    var day = Number(m[3]);
    var ms = Date.UTC(year, month - 1, day);
    var d = new Date(ms);
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
    return ms;
  },

  formatIso: function(ms) {
    var d = new Date(ms);
    var month = d.getUTCMonth() + 1;
    var day = d.getUTCDate();
    return d.getUTCFullYear() + '-' + (month < 10 ? '0' : '') + month + '-' + (day < 10 ? '0' : '') + day;
  },

  addDays: function(iso, days) {
    var ms = SemenCollection.parseIso(iso);
    if (ms === null || !isFinite(Number(days))) return '';
    return SemenCollection.formatIso(ms + Number(days) * 86400000);
  },

  datesForMating: function(matingDate) {
    var list = [];
    for (var age = 0; age <= SemenCollection.MAX_AGE; age++) {
      var date = SemenCollection.addDays(matingDate, -age);
      if (!date) return [];
      list.push({
        ageDays: age,
        date: date,
        label: age === 0 ? '当日' : (age + '日前')
      });
    }
    return list;
  },

  toastSuffix: function(meta) {
    if (!meta || !meta.semenCollectionDate) return '';
    return '（精液' + meta.semenAgeDays + '日齢・採取' + String(meta.semenCollectionDate).slice(5) + '）';
  },

  renderHtml: function(matingDate, selectedAge) {
    var dates = SemenCollection.datesForMating(matingDate);
    if (!dates.length) {
      return '<div class="semen-summary">種付日を選ぶと、採取日をボタンで選べます</div>';
    }
    var selected = null;
    if (selectedAge === 0 || (selectedAge !== null && selectedAge !== undefined && selectedAge !== '')) {
      selected = Number(selectedAge);
    }
    if (selected !== null && (isNaN(selected) || selected < 0 || selected > SemenCollection.MAX_AGE)) selected = null;
    var summary = '未選択（空欄のまま記録できます）';
    if (selected !== null) summary = '採取 ' + dates[selected].date + '（' + selected + '日齢）';
    var html = '<div class="semen-summary">' + summary + '</div>';
    for (var i = 0; i < dates.length; i++) {
      var item = dates[i];
      var on = selected === item.ageDays;
      html += '<button type="button" class="semen-chip' + (on ? ' selected' : '') + '" data-age="' + item.ageDays + '">';
      html += item.label + '<small>' + item.date.slice(5).replace('-', '/') + '・' + item.ageDays + '日齢</small>';
      html += '</button>';
    }
    return html;
  },

  mount: function(containerId, matingDate, selectedAge) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var dates = SemenCollection.datesForMating(matingDate);
    var age = null;
    if (selectedAge === 0 || (selectedAge !== null && selectedAge !== undefined && selectedAge !== '')) {
      age = Number(selectedAge);
    }
    if (!dates.length || age === null || isNaN(age) || age < 0 || age > SemenCollection.MAX_AGE) age = null;
    container.setAttribute('data-mating-date', dates.length ? String(matingDate) : '');
    container.setAttribute('data-age-days', age === null ? '' : String(age));
    container.innerHTML = SemenCollection.renderHtml(matingDate, age);
  },

  read: function(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return null;
    var ageAttr = container.getAttribute('data-age-days');
    if (ageAttr === null || ageAttr === '') return null;
    var age = Number(ageAttr);
    var mating = container.getAttribute('data-mating-date') || '';
    var date = SemenCollection.addDays(mating, -age);
    if (!date || age < 0 || age > SemenCollection.MAX_AGE || Math.floor(age) !== age) return null;
    return { semenCollectionDate: date, semenAgeDays: age };
  },

  bind: function(containerId, dateInputId) {
    var container = document.getElementById(containerId);
    var input = document.getElementById(dateInputId);
    if (!container || container.getAttribute('data-semen-bound') === '1') return;
    container.setAttribute('data-semen-bound', '1');
    container.addEventListener('click', function(e) {
      var node = e.target;
      var btn = null;
      while (node && node !== container) {
        if (node.getAttribute && node.getAttribute('data-age') !== null) { btn = node; break; }
        node = node.parentNode;
      }
      if (!btn) return;
      var age = Number(btn.getAttribute('data-age'));
      var current = container.getAttribute('data-age-days');
      var next = current !== '' && Number(current) === age ? null : age;
      var mating = input ? input.value : container.getAttribute('data-mating-date');
      SemenCollection.mount(containerId, mating, next);
    });
    if (input && input.getAttribute('data-semen-bound') !== '1') {
      input.setAttribute('data-semen-bound', '1');
      var sync = function() {
        var selected = container.getAttribute('data-age-days');
        SemenCollection.mount(containerId, input.value, selected === '' || selected === null ? null : Number(selected));
      };
      input.addEventListener('change', sync);
      input.addEventListener('input', sync);
    }
  }
};
