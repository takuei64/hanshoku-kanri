// 分娩舎移動ページ

var Farrowing = {
  list: [],
  selectedSow: null,
  recordSowNo: null,
  lotReport: null,
  lotPanelOpen: false,
  selectedLotNo: 1,

  render: function() {
    var container = document.getElementById('farrowing-list');
    if (Farrowing.list.length === 0) {
      container.innerHTML =
        '<div class="empty-state">' +
          '<div class="icon">&#10003;</div>' +
          '<div>対象の母豚はいません</div>' +
        '</div>';
      return;
    }

    var html = '<table class="farrow-table">';
    html += '<thead><tr>';
    html += '<th>母豚No</th><th>ペン</th><th>種付日</th><th>経過</th><th>分娩予定</th><th></th>';
    html += '</tr></thead><tbody>';

    for (var i = 0; i < Farrowing.list.length; i++) {
      var s = Farrowing.list[i];
      var statusBadge = '';
      if (s.status) {
        var cls = App.getStatusBadgeClass(s.status);
        statusBadge = ' <span class="status-badge ' + cls + '" style="font-size:10px;padding:1px 4px">' + s.status + '</span>';
      }
      var daysLeft = 114 - s.daysSinceMate;
      var urgency = daysLeft <= 7 ? ' class="urgent"' : daysLeft <= 14 ? ' class="soon"' : '';

      html += '<tr' + urgency + '>';
      html += '<td>' + s.sowNo + statusBadge + '</td>';
      html += '<td>' + s.penNo + '</td>';
      html += '<td>' + (s.matingDate || '').slice(5) + '</td>';
      html += '<td>' + s.daysSinceMate + '日</td>';
      html += '<td>' + (s.dueDate || '').slice(5) + '</td>';
      html += '<td><button class="btn-move-sm" style="background:var(--success)" onclick="Farrowing.openRecordModal(\'' + s.sowNo + '\')">分娩</button> <button class="btn-move-sm" onclick="Farrowing.openMoveModal(\'' + s.sowNo + '\')">移動</button></td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  },

  toggleLotPanel: function() {
    Farrowing.lotPanelOpen = !Farrowing.lotPanelOpen;
    document.getElementById('lot-panel').style.display = Farrowing.lotPanelOpen ? 'block' : 'none';
    document.getElementById('lot-toggle-label').textContent = Farrowing.lotPanelOpen ? '－ 種付ロット一覧' : '＋ 種付ロット一覧';
    if (Farrowing.lotPanelOpen) Farrowing.ensureLotReportLoaded();
  },

  ensureLotReportLoaded: function() {
    if (Farrowing.lotReport) {
      Farrowing.prepareLotPanel();
      return;
    }
    App.showLoading();
    google.script.run
      .withSuccessHandler(function(data) {
        App.hideLoading();
        Farrowing.lotReport = data;
        Farrowing.prepareLotPanel();
      })
      .withFailureHandler(function(e) {
        App.hideLoading();
        App.toast('ロット一覧: ' + (e.message || '取得できませんでした'));
      })
      .getMatingLotReport(App.authToken);
  },

  prepareLotPanel: function() {
    if (!Farrowing.lotReport || !Farrowing.lotReport.lots) {
      document.getElementById('lot-summary').innerHTML = '<div class="history-note">ロットデータがありません。更新してください。</div>';
      document.getElementById('lot-detail').innerHTML = '';
      return;
    }
    var select = document.getElementById('lot-select');
    if (!select) return;
    if (select.options.length === 0) {
      for (var i = 0; i < Farrowing.lotReport.lots.length; i++) {
        var lot = Farrowing.lotReport.lots[i];
        var opt = document.createElement('option');
        opt.value = String(lot.lotNo);
        opt.textContent = 'Lot ' + lot.lotNo + ' (' + lot.count + '頭)';
        select.appendChild(opt);
      }
    }
    Farrowing.selectedLotNo = parseInt(select.value, 10) || 1;
    Farrowing.renderLotDetail();
  },

  renderLotDetail: function() {
    var select = document.getElementById('lot-select');
    if (!select || !Farrowing.lotReport) return;
    Farrowing.selectedLotNo = parseInt(select.value, 10) || 1;
    var lot = null;
    for (var i = 0; i < Farrowing.lotReport.lots.length; i++) {
      if (Farrowing.lotReport.lots[i].lotNo === Farrowing.selectedLotNo) {
        lot = Farrowing.lotReport.lots[i];
        break;
      }
    }
    if (!lot) return;

    var summaryEl = document.getElementById('lot-summary');
    var s = lot.summary || {};
    var range = (lot.from || '—') + ' 〜 ' + (lot.to || '—');
    summaryEl.innerHTML =
      '<div class="lot-summary-grid">' +
        '<div><strong>種付期間</strong><br>' + range + '</div>' +
        '<div><strong>分娩済</strong><br>' + (s.farrowed || 0) + ' / ' + lot.count + '頭</div>' +
        '<div><strong>平均総産子</strong><br>' + (s.avgTotalBorn || 0) + '</div>' +
        '<div><strong>死残計</strong><br>' + (s.stillSum || 0) + ' (白' + (s.stillWhiteSum || 0) + '/黒' + (s.stillBlackSum || 0) + ')</div>' +
        '<div><strong>保育死亡</strong><br>' + (s.nurseryDeaths || 0) + '頭</div>' +
        '<div><strong>サイズ</strong><br>小' + ((s.sizeCounts && s.sizeCounts['小']) || 0) +
          ' / 中' + ((s.sizeCounts && s.sizeCounts['中']) || 0) +
          ' / 大' + ((s.sizeCounts && s.sizeCounts['大']) || 0) + '</div>' +
      '</div>';

    var html = '<table class="farrow-table lot-table"><thead><tr>' +
      '<th>No</th><th>Pen</th><th>種付</th><th>分娩</th><th>産子</th><th>死残</th><th>サイズ</th><th>保育死</th>' +
      '</tr></thead><tbody>';
    for (var r = 0; r < lot.rows.length; r++) {
      var row = lot.rows[r];
      var f = row.farrowing;
      var born = f ? f.totalBorn : '—';
      var still = f ? ((f.stillWhite || 0) + (f.stillBlack || 0) || f.stillTotal || 0) : '—';
      var stillDetail = f && (f.stillWhite || f.stillBlack) ? (f.stillWhite || 0) + '/' + (f.stillBlack || 0) : still;
      var size = f && f.sizeLevel ? f.sizeLevel : '—';
      html += '<tr onclick="App.navigateTo(\'sowcard\', { sowNo: ' + row.sowNo + ' })">';
      html += '<td>' + row.sowNo + '</td>';
      html += '<td>' + row.penNo + '</td>';
      html += '<td>' + (row.latestMatingDate || '').slice(5) + '</td>';
      html += '<td>' + (row.latestFarrowingDate || '—').slice(5) + '</td>';
      html += '<td>' + born + '</td>';
      html += '<td>' + stillDetail + '</td>';
      html += '<td>' + size + '</td>';
      html += '<td>' + (row.nurseryDeaths || 0) + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    document.getElementById('lot-detail').innerHTML = html;
  },

  openMoveModal: function(sowNo) {
    Farrowing.selectedSow = sowNo;
    document.getElementById('farrow-move-sow-label').textContent = 'No.' + sowNo;
    document.getElementById('farrow-move-pen').value = '';
    App.setDateDefault('farrow-move-date');
    App.showModal('farrow-move-modal');
  },

  openRecordModal: function(sowNo) {
    Farrowing.recordSowNo = sowNo;
    document.getElementById('farrow-record-sow-label').textContent = 'No.' + sowNo;
    document.getElementById('farrow-record-total').value = '';
    document.getElementById('farrow-record-still-white').value = '';
    document.getElementById('farrow-record-still-black').value = '';
    document.getElementById('farrow-record-size').value = '';
    document.getElementById('farrow-record-variation').value = '';
    document.getElementById('farrow-record-memo').value = '';
    App.setDateDefault('farrow-record-date');
    App.showModal('farrow-record-modal');
  },

  confirmRecord: function() {
    var sowNo = Farrowing.recordSowNo;
    var dateStr = document.getElementById('farrow-record-date').value;
    var total = parseInt(document.getElementById('farrow-record-total').value, 10) || 0;
    var stillWhite = parseInt(document.getElementById('farrow-record-still-white').value, 10) || 0;
    var stillBlack = parseInt(document.getElementById('farrow-record-still-black').value, 10) || 0;
    var sizeLevel = document.getElementById('farrow-record-size').value;
    var litterVar = document.getElementById('farrow-record-variation').value;
    var memo = document.getElementById('farrow-record-memo').value.trim();

    if (total <= 0) { App.toast('総産子数を入力してください'); return; }
    if (!App.tryAction('farrow-record:' + sowNo)) return;

    App.hideModal('farrow-record-modal');
    App.armTapShield(400);
    App.toast('分娩を記録しました');
    OfflineSync.enqueue('recordFarrowing', [sowNo, dateStr, total, stillWhite, stillBlack, sizeLevel, litterVar, memo]);
  },

  accidentFormOpen: false,
  accidentList: [],

  toggleAccidentForm: function() {
    Farrowing.accidentFormOpen = !Farrowing.accidentFormOpen;
    document.getElementById('accident-form').style.display = Farrowing.accidentFormOpen ? 'block' : 'none';
    document.getElementById('accident-toggle-label').textContent = Farrowing.accidentFormOpen ? '－ ほ育事故を記録' : '＋ ほ育事故を記録';
    if (Farrowing.accidentFormOpen) App.setDateDefault('accident-date');
  },

  submitAccident: function() {
    var sowNo = document.getElementById('accident-sow').value.trim();
    var dateStr = document.getElementById('accident-date').value;
    var count = parseInt(document.getElementById('accident-count').value, 10) || 0;
    var cause = document.getElementById('accident-cause').value;
    var weight = document.getElementById('accident-weight').value.trim();
    var memo = document.getElementById('accident-memo').value.trim();

    if (!sowNo) { App.toast('母豚Noを入力してください'); return; }
    if (count <= 0) { App.toast('頭数を入力してください'); return; }
    if (!App.tryAction('accident-submit')) return;

    OfflineSync.enqueue('recordNursingAccident', [sowNo, dateStr, count, cause || 'その他', weight, memo]);
    document.getElementById('accident-sow').value = '';
    document.getElementById('accident-count').value = '';
    document.getElementById('accident-cause').value = '';
    document.getElementById('accident-weight').value = '';
    document.getElementById('accident-memo').value = '';
    Farrowing.accidentList.unshift({ sowNo: sowNo, date: dateStr, count: count, cause: cause, weightKg: weight, memo: memo });
    Farrowing.renderAccidents();
    App.toast('ほ育事故を記録しました');
  },

  renderAccidents: function() {
    var container = document.getElementById('accident-list');
    if (Farrowing.accidentList.length === 0) { container.innerHTML = ''; return; }

    var html = '<div class="section-title" style="margin-top:12px">ほ育事故履歴</div>';
    html += '<table class="farrow-table"><thead><tr><th>日付</th><th>母豚No</th><th>頭数</th><th>原因</th><th>kg</th></tr></thead><tbody>';
    for (var i = 0; i < Farrowing.accidentList.length; i++) {
      var a = Farrowing.accidentList[i];
      html += '<tr><td>' + (a.date || '').slice(5) + '</td><td>' + a.sowNo + '</td><td>' + a.count + '</td>' +
        '<td>' + (a.cause || '—') + '</td><td>' + (a.weightKg || '—') + '</td></tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  },

  confirmMove: function() {
    var sowNo = Farrowing.selectedSow;
    var penNo = document.getElementById('farrow-move-pen').value.trim();
    var dateStr = document.getElementById('farrow-move-date').value;
    if (!penNo) { App.toast('移動先ペンNoを入力してください'); return; }
    if (!App.tryAction('farrow-move:' + sowNo)) return;

    App.hideModal('farrow-move-modal');
    App.armTapShield(400);

    for (var i = 0; i < Farrowing.list.length; i++) {
      if (String(Farrowing.list[i].sowNo) === String(sowNo)) {
        Farrowing.list[i].penNo = penNo;
        break;
      }
    }
    Farrowing.render();
    App.toast('分娩舎移動を記録しました');
    OfflineSync.enqueue('recordMovement', [sowNo, penNo, dateStr]);
  }
};
