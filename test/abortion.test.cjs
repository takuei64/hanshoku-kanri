const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const gasRoot = process.env.GAS_SOURCE_DIR || path.join(root, 'apps-script-project');
const date = s => new Date(s + 'T00:00:00');
const ds = d => d instanceof Date ? [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-') : String(d || '');
function fixture() {
  const sheets = {
    '種付': [[], ['999001',date('2026-10-01'),'',''], ['999002',date('2026-10-10'),'',''], ['999001',date('2026-10-06'),'','']],
    '分娩': [[]],
    '繁殖管理': [[], [date('2026-09-01'),'999001','23','',''], [date('2026-11-02'),'999001','','','妊娠鑑定済']]
  };
  const ss = { getSheetByName(name) { return { appendRow(row) { sheets[name].push(row); }, getDataRange() { return {getValues:()=>sheets[name].map(r=>r.slice())}; }, deleteRow(i) { sheets[name].splice(i-1,1); }, getRange(i,j) { return {setValue(v) { sheets[name][i-1][j-1]=v; }}; } }; }};
  const c = vm.createContext({ Date, console, daysBetween:(a,b)=>Math.floor((b-a)/86400000), normalizeSowNo:v=>String(v||''), normalizePenNo:v=>String(v||''), toDateString:ds,
    parseInputDate:date, getSpreadsheet:()=>ss, getSheetData:(ss,name)=>sheets[name]||[[]], requireAuth_:()=>{},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})} });
  vm.runInContext(fs.readFileSync(path.join(gasRoot,'api_breeding.js'),'utf8'),c);
  c.invalidateInitialCache_=()=>{};
  c.getPenAreaForCurrent_=()=> 'ストール';
  c.removeCurrentRow_=()=>{ c.current=null; };
  c.upsertCurrentRow_=(ss,sn,patch)=>{ c.current={...c.current,...patch}; };
  c.current={sowNo:'999001',penNo:'23',area:'ストール',latestMatingDate:'2026-10-06',latestMoveDate:'2026-09-01', pregnancyDoneDate:'2026-11-02',matingStatus:'妊娠鑑定済'};
  return {c,sheets,ss};
}
test('流産記録→D列・繁殖管理・前回バッジ用状態→朝チェック、再構築でも保持、削除で妊鑑へ復元',()=>{
 const {c,sheets,ss}=fixture();
 assert.equal(c.recordStatusChange('999001','流産','2026-11-04','test').success,true);
 assert.equal(ds(sheets['種付'][3][3]),'2026-11-04');
 assert.equal(sheets['種付'][1][3],'');
 assert.equal(sheets['種付'][2][3],'');
 assert.equal(sheets['繁殖管理'].at(-1)[4],'流産');
 assert.equal(c.current.matingStatus,'流産');
 assert.equal(c.current.emptyDate,'2026-11-04');
 const morning=c.buildMorningListFromCurrent_([c.current]);
 assert.equal(morning.length,1);assert.equal(morning[0].status,'流産');assert.match(morning[0].reason,/^流産 \d+日目$/);
 for(const fn of ['buildPregnancyCheckListFromCurrent_','buildReheatCheckListFromCurrent_','buildPostMatingListFromCurrent_','buildFarrowingListFromCurrent_']) assert.equal(c[fn]([c.current]).length,0,fn);
 c.syncCurrentStatusForSow_(ss,'999001');
 assert.equal(c.current.matingStatus,'流産');assert.equal(c.buildMorningListFromCurrent_([c.current]).length,1);
 assert.equal(c.deleteBreedingRecord('999001','2026-11-04','','','流産','test').success,true);
 assert.equal(sheets['種付'][3][3],'');assert.equal(c.current.matingStatus,'妊娠鑑定済');assert.equal(c.buildMorningListFromCurrent_([c.current]).length,0);
});
test('分娩済み・種付なしでもステータス記録は成功し、D列を誤更新しない',()=>{
 for(const mode of ['farrowed','missing']) {
 const {c,sheets}=fixture();
 if(mode==='farrowed') sheets['分娩'].push(['999001',date('2026-11-03')]); else sheets['種付']=[[]];
 assert.equal(c.recordStatusChange('999001','流産','2026-11-04','test').success,true);
 assert.equal(c.current.matingStatus,'流産');
 assert.equal(sheets['種付'].some(r=>r[3] instanceof Date),false);
 }
});
test('流産複数記録の削除は残存日を復元し、再種付後は以前の流産を朝チェックに出さない',()=>{
 const {c,sheets,ss}=fixture();
 c.recordStatusChange('999001','流産','2026-11-03','test');c.recordStatusChange('999001','流産','2026-11-04','test');
 c.deleteBreedingRecord('999001','2026-11-04','','','流産','test');
 assert.equal(ds(sheets['種付'][3][3]),'2026-11-03');assert.equal(c.current.emptyDate,'2026-11-03');
 sheets['種付'].push(['999001',date('2026-11-05'),'','']);
 c.syncCurrentStatusForSow_(ss,'999001');assert.equal(c.current.matingStatus,'通常');assert.equal(c.buildMorningListFromCurrent_([c.current]).length,0);
});
test('空胎・妊鑑の従来記録と同日ステータス優先順位',()=>{
 const {c,ss,sheets}=fixture();
 c.recordStatusChange('999001','空胎','2026-11-04','test');
 assert.equal(c.current.matingStatus,'空胎');assert.match(c.buildMorningListFromCurrent_([c.current])[0].reason,/^空胎 /);assert.equal(sheets['種付'][3][3],'');
 c.syncCurrentStatusForSow_(ss,'999001');assert.equal(c.current.matingStatus,'空胎');
 assert.equal(c.shouldReplaceStatus_({date:date('2026-11-04'),status:'妊娠鑑定済'},'流産',date('2026-11-04')),true);
});
test('現在地と妊鑑の流産は日付モーダルを開き、確定後キュー・バッジ・チェックボードへ即時反映',()=>{
 const els={};const el=id=>els[id]||(els[id]={value:'',textContent:'',innerHTML:'',hidden:false});
 const c=vm.createContext({document:{getElementById:el,addEventListener(){}},__authToken:'',Date,setTimeout(){},OfflineSync:{queue:[],enqueue(type,args){this.queue.push({type,args});}},PostMating:{list:[]},ReheatCheck:{list:[]},Farrowing:{list:[]}});
 for(const f of ['js_app.js','js_breeding.js','js_pregcheck.js','js_sow.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),c);
 Object.assign(c.App,{today:()=> '2026-11-04',setDateDefault:id=>{el(id).value='2026-11-04';},showModal:id=>{c.modal=id;},hideModal(){},tryAction:()=>true,tapShielded:()=>false,armTapShield(){},toast(){},currentPage:'location'});
 const sow={sowNo:'999001',penNo:'23',status:'妊娠鑑定済',info:''};
 c.SowLocation.list=[sow];c.SowLocation.actionSowNo='999001';
 c.PregCheck.list=[{...sow}];c.PostMating.list=[{...sow}];c.ReheatCheck.list=[{...sow}];c.Farrowing.list=[{...sow}];
 c.SowLocation.actionAbortion();assert.equal(c.modal,'status-modal');assert.equal(el('status-date').value,'2026-11-04');
 el('status-date').value='2026-11-03';c.Breeding.confirmStatus();
 assert.equal(c.OfflineSync.queue.length,1);assert.equal(c.OfflineSync.queue[0].type,'recordStatusChange');assert.deepEqual(Array.from(c.OfflineSync.queue[0].args),['999001','流産','2026-11-03']);
 assert.equal(c.SowLocation.list[0].status,'流産');assert.match(el('location-list').innerHTML,/status-badge empty[^>]*>流産/);
 const merged=c.Breeding.buildMergedList();assert.equal(merged.length,1);assert.equal(merged[0].s.reason,'流産 1日目');assert.equal(c.Breeding.typeInfo(merged[0]).label,'流産');
 c.Breeding.render();assert.match(el('breeding-list').innerHTML,/status-badge empty">流産/);
 assert.equal(c.PregCheck.list.length,0);assert.equal(c.Farrowing.list.length,0);
 c.PregCheck.list=[{...sow}];c.PregCheck.render();assert.match(el('pregcheck-list').innerHTML,/Breeding.openStatusModal\('999001','流産'\)/);
});
test('変更したPages JSとGAS同梱HTMLは同一',()=>{
 for(const name of ['js_app','js_breeding','js_pregcheck','js_sow'])assert.equal(fs.readFileSync(path.join(gasRoot,name+'.html'),'utf8').replace(/^<script>\s*/, '').replace(/\s*<\/script>\s*$/,'').trim(),fs.readFileSync(path.join(root,name+'.js'),'utf8').trim());
});
