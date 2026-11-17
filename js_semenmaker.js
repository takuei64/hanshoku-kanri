// 精液メーカー（種付時に選び、分娩画面で子豚の耳切り区別に使う）

var SemenMaker = {
  storageKey: 'breedingSemenMakers_v1',
  lastKey: 'breedingSemenMakerLast_v1',
  MAX_NAME: 20,
  MAX_COUNT: 30,
  NEUTRAL: '#5f6368',
  // スマホの屋外でも見分けやすく、白文字が読める濃さの6色
  COLORS: [
    { key: 'blue', label: '青', hex: '#1967d2' },
    { key: 'orange', label: '橙', hex: '#c25e00' },
    { key: 'green', label: '緑', hex: '#137333' },
    { key: 'purple', label: '紫', hex: '#8430ce' },
    { key: 'red', label: '赤', hex: '#c5221f' },
    { key: 'brown', label: '茶', hex: '#6d4c41' }
  ],
  list: [],
  loaded: false,
  rendered: {},
  draft: null,
  newColor: '',

  esc: function(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  },

  /** キー・日本語名・16進のどれでも色キーに直す。不明なら空。 */
  colorKey: function(value) {
    var v = String(value || '').trim().toLowerCase();
    if (!v) return '';
    for (var i = 0; i < SemenMaker.COLORS.length; i++) {
      var c = SemenMaker.COLORS[i];
      if (v === c.key || v === c.label || v === c.hex) return c.key;
    }
    return '';
  },

  colorInfo: function(key) {
    var k = SemenMaker.colorKey(key);
    for (var i = 0; i < SemenMaker.COLORS.length; i++) {
      if (SemenMaker.COLORS[i].key === k) return SemenMaker.COLORS[i];
    }
    return null;
  },

  hexOf: function(key) {
    var info = SemenMaker.colorInfo(key);
    return info ? info.hex : SemenMaker.NEUTRAL;
  },

  cleanName: function(name) {
    return String(name === null || name === undefined ? '' : name)
      .replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, SemenMaker.MAX_NAME);
  },

  normalizeList: function(list) {
    var out = [];
    var seen = {};
    if (!list || typeof list.length !== 'number') return out;
    for (var i = 0; i < list.length && out.length < SemenMaker.MAX_COUNT; i++) {
      var item = list[i] || {};
      var name = SemenMaker.cleanName(item.name);
      if (!name || seen[name.toLowerCase()]) continue;
      seen[name.toLowerCase()] = true;
      out.push({ name: name, color: SemenMaker.colorKey(item.color), active: item.active !== false });
    }
    return out;
  },

  storageGet: function(key) {
    try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch (e) { return null; }
  },

  storageSet: function(key, value) {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value); } catch (e) {}
  },

  load: function() {
    if (SemenMaker.loaded) return SemenMaker.list;
    SemenMaker.loaded = true;
    var raw = SemenMaker.storageGet(SemenMaker.storageKey);
    if (raw) {
      try { SemenMaker.list = SemenMaker.normalizeList(JSON.parse(raw)); } catch (e) { SemenMaker.list = []; }
    }
    return SemenMaker.list;
  },

  setList: function(list) {
    SemenMaker.list = SemenMaker.normalizeList(list);
    SemenMaker.loaded = true;
    SemenMaker.storageSet(SemenMaker.storageKey, JSON.stringify(SemenMaker.list));
    return SemenMaker.list;
  },

  hasPendingSave: function() {
    if (typeof OfflineSync === 'undefined') return false;
    return (OfflineSync.queue || []).some(function(op) { return op && op.type === 'saveSemenMakers'; });
  },

  /** サーバーの一覧で置き換える。端末で未送信の編集があるときは端末側を優先する。 */
  applyServerList: function(list) {
    SemenMaker.load();
    if (!list || typeof list.length !== 'number') return false;
    if (SemenMaker.hasPendingSave()) return false;
    SemenMaker.setList(list);
    return true;
  },

  init: function(serverList) {
    SemenMaker.load();
    if (serverList) SemenMaker.applyServerList(serverList);
  },

  activeList: function() {
    return SemenMaker.load().filter(function(m) { return m.active; });
  },

  find: function(name) {
    var key = String(name || '').toLowerCase();
    var list = SemenMaker.load();
    for (var i = 0; i < list.length; i++) {
      if (list[i].name.toLowerCase() === key) return list[i];
    }
    return null;
  },

  /** 端末の一覧の色を優先し、無ければサーバーが付けた色、どちらも無ければ灰色。 */
  hexFor: function(name, fallbackColor) {
    var found = SemenMaker.find(name);
    if (found && found.color) return SemenMaker.hexOf(found.color);
    return SemenMaker.hexOf(fallbackColor);
  },

  lastSelected: function() {
    var name = SemenMaker.storageGet(SemenMaker.lastKey) || '';
    var found = SemenMaker.find(name);
    return found && found.active ? found.name : '';
  },

  remember: function(name) {
    SemenMaker.storageSet(SemenMaker.lastKey, name || '');
  },

  // --- 種付モーダルの選択チップ ---

  renderHtml: function(selected) {
    var makers = SemenMaker.activeList();
    var html = '<button type="button" class="maker-chip maker-none' + (!selected ? ' selected' : '') + '" data-maker-index="-1">未選択（従来）</button>';
    for (var i = 0; i < makers.length; i++) {
      var m = makers[i];
      var on = selected === m.name;
      html += '<button type="button" class="maker-chip' + (on ? ' selected' : '') + '" data-maker-index="' + i + '"' +
        ' style="--maker-color:' + SemenMaker.hexOf(m.color) + '">' +
        '<span class="maker-dot" aria-hidden="true"></span>' + SemenMaker.esc(m.name) + '</button>';
    }
    if (!makers.length) html += '<div class="maker-empty">メーカーは「管理」から追加できます</div>';
    return html;
  },

  mount: function(containerId, selected) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var makers = SemenMaker.activeList();
    var name = '';
    for (var i = 0; i < makers.length; i++) {
      if (makers[i].name === selected) name = selected;
    }
    SemenMaker.rendered[containerId] = makers.map(function(m) { return m.name; });
    container.setAttribute('data-maker', name);
    container.innerHTML = SemenMaker.renderHtml(name);
  },

  /** 前回選んだメーカー（無効化・削除済みなら未選択）で開く。 */
  open: function(containerId) {
    SemenMaker.bind(containerId);
    SemenMaker.mount(containerId, SemenMaker.lastSelected());
  },

  read: function(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return '';
    var name = container.getAttribute('data-maker') || '';
    var found = SemenMaker.find(name);
    return found && found.active ? found.name : '';
  },

  bind: function(containerId) {
    var container = document.getElementById(containerId);
    if (!container || container.getAttribute('data-maker-bound') === '1') return;
    container.setAttribute('data-maker-bound', '1');
    container.addEventListener('click', function(e) {
      var node = e.target;
      var btn = null;
      while (node && node !== container) {
        if (node.getAttribute && node.getAttribute('data-maker-index') !== null) { btn = node; break; }
        node = node.parentNode;
      }
      if (!btn) return;
      var index = Number(btn.getAttribute('data-maker-index'));
      var names = SemenMaker.rendered[containerId] || [];
      var name = index >= 0 && index < names.length ? names[index] : '';
      SemenMaker.select(containerId, name);
    });
  },

  select: function(containerId, name) {
    SemenMaker.mount(containerId, name);
    SemenMaker.remember(SemenMaker.read(containerId));
  },

  /** 採取日の任意情報にメーカーを足す。どちらも無ければ null（従来どおり）。 */
  withMaker: function(meta, maker) {
    if (!maker) return meta || null;
    var out = {};
    if (meta) {
      for (var k in meta) {
        if (Object.prototype.hasOwnProperty.call(meta, k)) out[k] = meta[k];
      }
    }
    out.semenMaker = maker;
    return out;
  },

  toastSuffix: function(maker) {
    return maker ? '（' + maker + '）' : '';
  },

  // --- 分娩画面のバッジ ---

  /** 一覧データの semenMaker / semenMakers から表示用の配列を作る。 */
  entriesFor: function(item) {
    if (!item) return [];
    var src = item.semenMakers && item.semenMakers.length ? item.semenMakers
      : (item.semenMaker ? [{ name: item.semenMaker, color: item.semenMakerColor }] : []);
    var out = [];
    for (var i = 0; i < src.length; i++) {
      var name = SemenMaker.cleanName(src[i] && src[i].name);
      if (!name) continue;
      out.push({ name: name, hex: SemenMaker.hexFor(name, src[i].color) });
    }
    return out;
  },

  badgeHtml: function(item) {
    var entries = SemenMaker.entriesFor(item);
    if (!entries.length) return '';
    var html = '<span class="maker-badges">';
    for (var i = 0; i < entries.length; i++) {
      html += '<span class="maker-badge" style="background:' + entries[i].hex + '">' + SemenMaker.esc(entries[i].name) + '</span>';
    }
    if (entries.length > 1) html += '<span class="maker-mixed">混在</span>';
    return html + '</span>';
  },

  /** 表の行の左帯の色（未設定は空、混在は先頭＝最新の種付）。 */
  stripeHex: function(item) {
    var entries = SemenMaker.entriesFor(item);
    return entries.length ? entries[0].hex : '';
  },

  // --- メーカー管理モーダル ---

  ensureManager: function() {
    if (document.getElementById('maker-modal')) return document.getElementById('maker-modal');
    if (!document.createElement || !document.body) return null;
    var overlay = document.createElement('div');
    overlay.id = 'maker-modal';
    overlay.className = 'modal-overlay modal-center maker-modal';
    overlay.innerHTML =
      '<div class="modal-content" style="position:relative">' +
        '<button class="modal-close" type="button" onclick="SemenMaker.closeManager()">&times;</button>' +
        '<div class="modal-title">精液メーカー管理</div>' +
        '<div id="maker-manager-body"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    var body = document.getElementById('maker-manager-body');
    body.addEventListener('click', SemenMaker.onManagerClick);
    body.addEventListener('input', SemenMaker.onManagerInput);
    return overlay;
  },

  openManager: function() {
    SemenMaker.draft = SemenMaker.load().map(function(m) {
      return { name: m.name, color: m.color, active: m.active, originalName: m.name };
    });
    SemenMaker.newColor = SemenMaker.nextColor();
    if (!SemenMaker.ensureManager()) return;
    SemenMaker.renderManager();
    App.showModal('maker-modal');
  },

  closeManager: function() {
    SemenMaker.draft = null;
    App.hideModal('maker-modal');
  },

  nextColor: function() {
    var used = {};
    (SemenMaker.draft || []).forEach(function(m) { used[m.color] = true; });
    for (var i = 0; i < SemenMaker.COLORS.length; i++) {
      if (!used[SemenMaker.COLORS[i].key]) return SemenMaker.COLORS[i].key;
    }
    return SemenMaker.COLORS[0].key;
  },

  colorButtons: function(target, selected) {
    var html = '<div class="maker-colors">';
    for (var c = 0; c < SemenMaker.COLORS.length; c++) {
      var col = SemenMaker.COLORS[c];
      html += '<button type="button" class="maker-color' + (selected === col.key ? ' selected' : '') + '"' +
        ' data-maker-action="color" data-maker-target="' + target + '" data-maker-color="' + col.key + '"' +
        ' style="background:' + col.hex + '" aria-label="' + col.label + '">' + col.label + '</button>';
    }
    return html + '</div>';
  },

  renderManager: function() {
    var body = document.getElementById('maker-manager-body');
    if (!body || !SemenMaker.draft) return;
    var html = '';
    if (!SemenMaker.draft.length) {
      html += '<div class="maker-empty">まだメーカーがありません。下で名前と色を決めて追加してください。</div>';
    }
    for (var i = 0; i < SemenMaker.draft.length; i++) {
      var m = SemenMaker.draft[i];
      html += '<div class="maker-row' + (m.active ? '' : ' inactive') + '">';
      html += '<div class="maker-row-head">';
      html += '<span class="maker-badge" style="background:' + SemenMaker.hexOf(m.color) + '">' + SemenMaker.esc(m.name || '（名前なし）') + '</span>';
      html += '<button type="button" class="maker-toggle" data-maker-action="toggle" data-maker-target="' + i + '">' + (m.active ? '使う' : '停止中') + '</button>';
      html += '<button type="button" class="maker-remove" data-maker-action="remove" data-maker-target="' + i + '">削除</button>';
      html += '</div>';
      html += '<input type="text" class="maker-name-input" maxlength="' + SemenMaker.MAX_NAME + '" data-maker-name="' + i + '" value="' + SemenMaker.esc(m.name) + '" aria-label="メーカー名">';
      html += SemenMaker.colorButtons(String(i), m.color);
      html += '</div>';
    }
    html += '<div class="maker-row maker-add">';
    html += '<div class="semen-help">メーカーを追加</div>';
    html += '<input type="text" id="maker-new-name" class="maker-name-input" maxlength="' + SemenMaker.MAX_NAME + '" placeholder="メーカー名">';
    html += SemenMaker.colorButtons('new', SemenMaker.newColor);
    html += '<button type="button" class="maker-add-btn" data-maker-action="add">＋ 追加</button>';
    html += '</div>';
    html += '<div class="maker-help">「停止中」は種付の選択肢から外れますが、分娩画面の色表示は残ります。名前の変更は過去の種付記録には反映されません。</div>';
    html += '<button type="button" class="submit-btn" data-maker-action="save">保存する</button>';
    body.innerHTML = html;
  },

  onManagerInput: function(e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var idx = t.getAttribute('data-maker-name');
    if (idx === null || !SemenMaker.draft || !SemenMaker.draft[Number(idx)]) return;
    SemenMaker.draft[Number(idx)].name = t.value;
  },

  onManagerClick: function(e) {
    var node = e.target;
    var btn = null;
    while (node && node.getAttribute) {
      if (node.getAttribute('data-maker-action') !== null) { btn = node; break; }
      node = node.parentNode;
    }
    if (!btn) return;
    var action = btn.getAttribute('data-maker-action');
    var target = btn.getAttribute('data-maker-target');
    var res = { ok: true };
    if (action === 'color') {
      if (target === 'new') SemenMaker.newColor = btn.getAttribute('data-maker-color');
      else res = SemenMaker.draftSetColor(Number(target), btn.getAttribute('data-maker-color'));
    } else if (action === 'toggle') {
      res = SemenMaker.draftToggle(Number(target));
    } else if (action === 'remove') {
      var m = SemenMaker.draft && SemenMaker.draft[Number(target)];
      if (!m || !App.confirmAction('「' + (m.name || '名前なし') + '」を削除しますか？\n過去の種付記録の名前は残ります（色は灰色表示）。')) return;
      res = SemenMaker.draftRemove(Number(target));
    } else if (action === 'add') {
      var input = document.getElementById('maker-new-name');
      res = SemenMaker.draftAdd(input ? input.value : '', SemenMaker.newColor);
      if (res.ok) SemenMaker.newColor = SemenMaker.nextColor();
    } else if (action === 'save') {
      res = SemenMaker.commitDraft();
      if (res.ok) {
        App.hideModal('maker-modal');
        App.toast('精液メーカーを保存しました');
        return;
      }
    }
    if (!res.ok) { App.toast(res.error); return; }
    SemenMaker.renderManager();
  },

  findDraft: function(name, exceptIndex) {
    var key = SemenMaker.cleanName(name).toLowerCase();
    for (var i = 0; i < (SemenMaker.draft || []).length; i++) {
      if (i !== exceptIndex && SemenMaker.cleanName(SemenMaker.draft[i].name).toLowerCase() === key) return i;
    }
    return -1;
  },

  draftAdd: function(name, color) {
    if (!SemenMaker.draft) SemenMaker.draft = [];
    var clean = SemenMaker.cleanName(name);
    if (!clean) return { ok: false, error: 'メーカー名を入力してください' };
    if (SemenMaker.findDraft(clean, -1) >= 0) return { ok: false, error: '「' + clean + '」はすでにあります' };
    if (SemenMaker.draft.length >= SemenMaker.MAX_COUNT) return { ok: false, error: 'これ以上追加できません' };
    SemenMaker.draft.push({ name: clean, color: SemenMaker.colorKey(color) || SemenMaker.nextColor(), active: true, originalName: '' });
    return { ok: true };
  },

  draftRename: function(index, name) {
    if (!SemenMaker.draft || !SemenMaker.draft[index]) return { ok: false, error: '対象がありません' };
    SemenMaker.draft[index].name = String(name || '');
    return { ok: true };
  },

  draftSetColor: function(index, color) {
    if (!SemenMaker.draft || !SemenMaker.draft[index]) return { ok: false, error: '対象がありません' };
    SemenMaker.draft[index].color = SemenMaker.colorKey(color);
    return { ok: true };
  },

  draftToggle: function(index) {
    if (!SemenMaker.draft || !SemenMaker.draft[index]) return { ok: false, error: '対象がありません' };
    SemenMaker.draft[index].active = !SemenMaker.draft[index].active;
    return { ok: true };
  },

  draftRemove: function(index) {
    if (!SemenMaker.draft || !SemenMaker.draft[index]) return { ok: false, error: '対象がありません' };
    SemenMaker.draft.splice(index, 1);
    return { ok: true };
  },

  /** 編集内容を端末に保存し、オフラインキューで本番シートへ送る。 */
  commitDraft: function() {
    var draft = SemenMaker.draft || [];
    for (var i = 0; i < draft.length; i++) {
      var name = SemenMaker.cleanName(draft[i].name);
      if (!name) return { ok: false, error: (i + 1) + '行目のメーカー名が空です' };
      if (SemenMaker.findDraft(name, i) >= 0) return { ok: false, error: '「' + name + '」が重複しています' };
    }
    var last = SemenMaker.storageGet(SemenMaker.lastKey) || '';
    var list = SemenMaker.setList(draft);
    // 前回選択のメーカーを改名したら、次回の初期選択も新しい名前にする。
    for (var j = 0; j < draft.length; j++) {
      if (last && draft[j].originalName === last) SemenMaker.remember(SemenMaker.cleanName(draft[j].name));
    }
    SemenMaker.draft = null;
    if (typeof OfflineSync !== 'undefined') OfflineSync.enqueue('saveSemenMakers', [list]);
    SemenMaker.remountAll();
    return { ok: true, list: list };
  },

  /** 開いている種付モーダルのチップを最新の一覧で描き直す。 */
  remountAll: function() {
    Object.keys(SemenMaker.rendered).forEach(function(id) {
      var container = document.getElementById(id);
      if (!container) return;
      var current = container.getAttribute('data-maker') || '';
      // 改名・削除で今の選択が消えたら、前回選択（改名後の名前）に合わせる。
      if (current && !SemenMaker.find(current)) current = SemenMaker.lastSelected();
      SemenMaker.mount(id, current);
    });
  }
};
