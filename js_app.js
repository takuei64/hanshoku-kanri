// ナビゲーション・ローディング・トースト・データキャッシュ

var App = {
  currentPage: 'breeding',
  dataLoaded: false,
  authToken: __authToken || '',

  /** 今日の日付を "yyyy-MM-dd" で返す（JST固定。端末タイムゾーンに依存しない） */
  today: function() {
    var jstMs = Date.now() + (9 * 60 * 60 * 1000);
    var d = new Date(jstMs);
    var y = d.getUTCFullYear();
    var m = ('0' + (d.getUTCMonth() + 1)).slice(-2);
    var day = ('0' + d.getUTCDate()).slice(-2);
    return y + '-' + m + '-' + day;
  },

  /** 指定IDのdate inputに今日をセット */
  setDateDefault: function(id) {
    var el = document.getElementById(id);
    if (el) el.value = App.today();
  },

  init: function() {
    if (App.authToken) localStorage.setItem('breedingAuthToken', App.authToken);
    document.querySelectorAll('.tab-bar button').forEach(function(btn) {
      btn.addEventListener('click', function() { App.navigateTo(btn.dataset.page); });
    });
    document.addEventListener('click', App.prepareActionTap, true);
    document.addEventListener('touchend', App.prepareActionTap, true);
    // 初回データはHTMLに埋め込み済み（サーバー往復ゼロ）
    var data = __initialData || {};
    Breeding.list = data.morningList || [];
    PostMating.list = data.postMatingList || [];
    Farrowing.list = data.farrowingList || [];
    Farrowing.accidentList = data.accidentList || [];
    SowLocation.list = data.locationList || [];
    ReheatCheck.list = data.reheatCheckList || [];
    PregCheck.list = data.pregnancyCheckList || [];
    PenTask.list = data.penTaskList || [];
    App.dataLoaded = true;
    OfflineSync.init();
    App.navigateTo('breeding');
  },

  navigateTo: function(page, opts) {
    // ページ切替
    document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
    var el = document.getElementById('page-' + page);
    if (el) el.classList.add('active');

    // タブ切替
    document.querySelectorAll('.tab-bar button').forEach(function(b) { b.classList.remove('active'); });
    var tab = document.querySelector('.tab-bar button[data-page="' + page + '"]');
    if (tab) tab.classList.add('active');

    // ヘッダー更新
    var titles = { breeding: '繁殖チェック', pregcheck: '妊娠鑑定', farrowing: '分娩移動', location: '現在地', pentask: '作業', sowcard: '個体' };
    document.getElementById('header-title').textContent = titles[page] || '';

    App.currentPage = page;

    // キャッシュ済みデータで描画（サーバー呼出し不要）
    if (page === 'breeding') Breeding.render();
    if (page === 'pregcheck') PregCheck.render();
    if (page === 'farrowing') { Farrowing.render(); Farrowing.renderAccidents(); }
    if (page === 'location') SowLocation.render();
    if (page === 'pentask') PenTask.render();
    if (page === 'sowcard' && opts && opts.sowNo) SowCard.search(opts.sowNo);
  },

  /** 全データを再取得（明示的リフレッシュ） */
  refresh: function() {
    if (typeof OfflineSync !== 'undefined' && OfflineSync.hasPending()) {
      OfflineSync.retryPendingNow();
      App.toast('未送信記録があります。同期後に更新してください');
      return;
    }
    if (!App.tryAction('app-refresh', 800)) return;
    var epoch = typeof PwaShell !== 'undefined' ? PwaShell.localEpoch : 0;
    App.showLoading();
    google.script.run
      .withSuccessHandler(function(data) {
        App.hideLoading();
        // 通信中に削除や入力が入った場合、戻りの古い一覧で楽観的更新を潰さない。
        if (typeof PwaShell !== 'undefined' && !PwaShell.shouldApplyServerData(epoch)) {
          App.toast('未送信の入力があるため、一覧の上書きを止めました');
          return false;
        }
        if (typeof PwaShell !== 'undefined' && PwaShell.applyData) {
          PwaShell.applyData(data);
        } else {
          Breeding.list = data.morningList || [];
          PostMating.list = data.postMatingList || [];
          Farrowing.list = data.farrowingList || [];
          Farrowing.accidentList = data.accidentList || [];
          SowLocation.list = data.locationList || [];
          ReheatCheck.list = data.reheatCheckList || [];
          PregCheck.list = data.pregnancyCheckList || [];
          PenTask.list = data.penTaskList || [];
          if (App.currentPage === 'breeding') Breeding.render();
          if (App.currentPage === 'pregcheck') PregCheck.render();
          if (App.currentPage === 'farrowing') { Farrowing.render(); Farrowing.renderAccidents(); }
          if (App.currentPage === 'location') SowLocation.render();
          if (App.currentPage === 'pentask') PenTask.render();
        }
        App.toast('更新しました');
      })
      .withFailureHandler(function(e) {
        App.hideLoading();
        App.toast('更新エラー: ' + e.message);
      })
      .refreshAllData(App.authToken);
  },

  showLoading: function() { document.getElementById('loading').classList.add('active'); },
  hideLoading: function() { document.getElementById('loading').classList.remove('active'); },

  getStatusBadgeClass: function(status) {
    if (status === '継続') return 'check';
    if (status === '妊娠鑑定済') return 'pregnant';
    if (String(status || '').indexOf('廃用') >= 0) return 'empty';
    if (String(status || '').indexOf('空胎') >= 0) return 'empty';
    if (status === '種付待ち') return 'check';
    if (status === '通常') return 'mated';
    return 'done';
  },

  toast: function(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(function() { el.classList.remove('show'); }, 2500);
  },

  tapShieldUntil: 0,
  actionGuards: {},

  /** 確認ダイアログを閉じた指が、直下の別ボタンを押すのを短時間だけ止める。 */
  armTapShield: function(ms) {
    App.tapShieldUntil = Date.now() + (ms || 400);
  },

  tapShielded: function() {
    return Date.now() < App.tapShieldUntil;
  },

  /**
   * 同じキーの連打だけを閉じる。別の母豚や精液チップの操作は止めない。
   * ネイティブconfirmの待ち時間には使わない（確認が終わるまでロックが溶けてしまう）。
   */
  tryAction: function(key, ms) {
    if (App.tapShielded()) return false;
    if (App.actionGuards[key]) return false;
    App.actionGuards[key] = true;
    setTimeout(function() { delete App.actionGuards[key]; }, ms || 450);
    return true;
  },

  /** 削除確認のあと、ダイアログを閉じたタップが残っているボタンに落ちないようにする。 */
  confirmAction: function(message) {
    if (App.tapShielded()) return false;
    if (!confirm(message)) return false;
    App.armTapShield(450);
    return true;
  },

  isFormField: function(el) {
    return el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
  },

  blurActiveElement: function() {
    var el = document.activeElement;
    if (App.isFormField(el) && typeof el.blur === 'function') el.blur();
  },

  prepareActionTap: function(e) {
    var target = e.target;
    if (App.isFormField(target)) return;
    if (e.type === 'click' && App.tapShielded()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (target && target.closest && target.closest('button,[onclick],.tab-bar button,.section-toggle,.list-item,.pen-tap,.bt-chip,.tl-delete,.pt-undo')) {
      App.blurActiveElement();
    }
  },

  showModal: function(id) { document.getElementById(id).classList.add('active'); },
  hideModal: function(id) {
    App.blurActiveElement();
    document.getElementById(id).classList.remove('active');
  }
};

document.addEventListener('DOMContentLoaded', App.init);
