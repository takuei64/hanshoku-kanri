// 分娩舎移動ページ

var Farrowing = {
  list: [],
  selectedSow: null,
  recordSowNo: null,
  lotReport: null,
  lotPanelOpen: false,
  selectedLotKey: '',

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
    document.getElementById('lot-toggle-label').textContent = Farrowing.lotPanelOpen ? '－ 種付月別一覧' : '＋ 種付月別一覧';
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
        opt.value = String(lot.month || lot.lotNo);
        var uniq = lot.uniqueSows != null ? lot.uniqueSows : lot.count;
        opt.textContent = (lot.label || lot.month) + '（' + uniq + '頭）';
        select.appendChild(opt);
      }
    }
    Farrowing.selectedLotKey = select.value;
    Farrowing.renderLotDetail();
  },

  renderLotDetail: function() {
    var select = document.getElementById('lot-select');
    if (!select || !Farrowing.lotReport) return;
    Farrowing.selectedLotKey = select.value;
    var lot = null;
    for (var i = 0; i < Farrowing.lotReport.lots.length; i++) {
      var key = String(Farrowing.lotReport.lots[i].month || Farrowing.lotReport.lots[i].lotNo);
      if (key === String(Farrowing.selectedLotKey)) {
        lot = Farrowing.lotReport.lots[i];
        break;
      }
    }
    if (!lot) return;

    var summaryEl = document.getElementById('lot-summary');
    var s = lot.summary || {};
    var buckets = s.histBornBuckets || {};
    var range = (lot.from || '—') + ' 〜 ' + (lot.to || '—');
    summaryEl.innerHTML =
      '<div class="lot-summary-grid">' +
        '<div><strong>種付月</strong><br>' + (lot.label || lot.month || '—') + '</div>' +
        '<div><strong>頭数</strong><br>' + (lot.uniqueSows || s.uniqueSows || lot.count) + '頭</div>' +
        '<div><strong>過去平均産子</strong><br>' + (s.avgHistTotalBorn != null ? s.avgHistTotalBorn : '—') + '</div>' +
        '<div><strong>今回分娩済</strong><br>' + (s.farrowed || 0) + ' / 平均' + (s.avgTotalBorn || 0) + '</div>' +
        '<div><strong>産子分布</strong><br>&lt;10:' + (buckets.low || 0) +
          ' / 10-12:' + (buckets.mid || 0) + ' / 12+:' + (buckets.high || 0) +
          ' / 初:' + (buckets.unknown || 0) + '</div>' +
        '<div><strong>死産計</strong><br>' + (s.stillSum || 0) + ' (白' + (s.stillWhiteSum || 0) + '/黒' + (s.stillBlackSum || 0) + ')</div>' +
      '</div>' +
      '<div class="history-note">' + (Farrowing.lotReport.target || '') + '</div>';

    var html = '<table class="farrow-table lot-table"><thead><tr>' +
      '<th>No</th><th>Pen</th><th>種付</th><th>日</th><th>産次</th><th>平均</th><th>前回</th><th>今回</th><th>死産</th><th>保</th>' +
      '</tr></thead><tbody>';
    for (var r = 0; r < lot.rows.length; r++) {
      var row = lot.rows[r];
      var f = row.farrowing;
      var born = f ? f.totalBorn : '—';
      var stillDetail = f ? ((f.stillWhite || 0) + '/' + (f.stillBlack || 0)) : '—';
      if (f && !(f.stillWhite || f.stillBlack) && f.stillTotal) stillDetail = String(f.stillTotal);
      var avgHist = row.avgHistTotalBorn != null ? row.avgHistTotalBorn : '—';
      var lastBorn = row.lastTotalBorn != null ? row.lastTotalBorn : '—';
      var days = row.daysSinceMating !== '' && row.daysSinceMating != null ? row.daysSinceMating : '—';
      html += '<tr onclick="App.navigateTo(\'sowcard\', { sowNo: ' + row.sowNo + ' })">';
      html += '<td>' + row.sowNo + '</td>';
      html += '<td>' + (row.penNo || '—') + '</td>';
      var mateLabel = (row.latestMatingDate || '').slice(5);
      if (row.servicesInMonth > 1) mateLabel += ' 再';
      else if (row.followups > 0) mateLabel += ' +' + row.followups;
      html += '<td>' + mateLabel + '</td>';
      html += '<td>' + days + '</td>';
      html += '<td>' + (row.parity != null ? row.parity : '—') + '</td>';
      html += '<td>' + avgHist + '</td>';
      html += '<td>' + lastBorn + '</td>';
      html += '<td>' + born + '</td>';
      html += '<td>' + stillDetail + '</td>';
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
