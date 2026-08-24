const KEYS={integrated:'kurashi-cho-v1',shopping:'kaimono-memo-v1',belongings:'mochimon-v7'};
const VERSION='1.0.0';
let state=null;
let toastTimer=null;

const $=id=>document.getElementById(id);
const readJson=key=>{try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):null}catch{return null}};
const writeJson=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
const norm=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s+/g,'');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const array=value=>Array.isArray(value)?value:[];
const nowIso=()=>new Date().toISOString();

function sourceSnapshot(){
  const shopping=readJson(KEYS.shopping);
  const belongings=readJson(KEYS.belongings);
  return {
    shopping:shopping&&typeof shopping==='object'&&!Array.isArray(shopping)?shopping:null,
    belongings:Array.isArray(belongings)?belongings:null
  };
}

function counts(data){
  return {
    shopping:array(data?.shopping?.shoppingList).length,
    inventory:array(data?.shopping?.inventory).length,
    belongings:array(data?.belongings).length
  };
}

function buildIntegrated(source){
  return {
    metadata:{schemaVersion:VERSION,createdAt:state?.metadata?.createdAt||nowIso(),updatedAt:nowIso(),sourceKeys:[KEYS.shopping,KEYS.belongings],mode:'copy-only'},
    shopping:source.shopping||{inventory:[],shoppingList:[],purchaseLog:[],inventoryLog:[]},
    belongings:source.belongings||[]
  };
}

function validIntegrated(value){
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&value.metadata?.schemaVersion&&value.shopping&&Array.isArray(value.belongings);
}

function load(){
  const saved=readJson(KEYS.integrated);
  state=validIntegrated(saved)?saved:buildIntegrated({shopping:null,belongings:null});
  renderAll();
  if(!validIntegrated(saved)) showMigrationIfAvailable();
}

function showMigrationIfAvailable(){
  const source=sourceSnapshot();
  if(!source.shopping&&!source.belongings)return;
  const c=counts(source);
  $('detected-counts').innerHTML=`買うもの <strong>${c.shopping}件</strong><br>在庫 <strong>${c.inventory}件</strong><br>持ち物 <strong>${c.belongings}件</strong>`;
  $('migration-modal').hidden=false;
}

function importSources(){
  const source=sourceSnapshot();
  if(!source.shopping&&!source.belongings){showToast('この端末に元アプリのデータが見つかりません');return}
  state=buildIntegrated(source);
  writeJson(KEYS.integrated,state);
  $('migration-modal').hidden=true;
  renderAll();
  const c=counts(state);
  showToast(`統合用コピーを作成しました（合計${c.shopping+c.inventory+c.belongings}件）`);
}

function renderAll(){
  const c=counts(state);
  $('shopping-count').textContent=c.shopping;
  $('inventory-count').textContent=c.inventory;
  $('belongings-count').textContent=c.belongings;
  const integrated=!!readJson(KEYS.integrated);
  $('sync-badge').textContent=integrated?'統合済み':'未統合';
  $('sync-badge').classList.toggle('ok',integrated);
  renderToday();renderShopping();renderInventory();renderBelongingFilters();renderBelongings();renderSettings();
}

function renderToday(){
  const shopping=array(state.shopping?.shoppingList).slice(0,5);
  const unknown=array(state.shopping?.inventory).filter(i=>i.confirmedQuantity==null).slice(0,3);
  const rows=[
    ...shopping.map(i=>({label:i.productName||'名称未設定',meta:`買うもの${i.plannedQuantity!=null?`・${i.plannedQuantity}${i.unit||''}`:''}`})),
    ...unknown.map(i=>({label:i.productName||'名称未設定',meta:'在庫数を確認'}))
  ];
  $('today-summary').innerHTML=rows.length?rows.map(r=>`<div class="summary-row"><strong>${esc(r.label)}</strong><span>${esc(r.meta)}</span></div>`).join(''):'<div class="empty">今日確認する候補はありません</div>';
}

function renderShopping(){
  const items=array(state.shopping?.shoppingList);
  $('shopping-list').innerHTML=items.length?items.map(i=>`<article class="list-card"><h3>${esc(i.productName||'名称未設定')}</h3><div class="meta"><span>${i.plannedQuantity!=null?`予定 ${esc(i.plannedQuantity)}${esc(i.unit||'')}`:'数量未設定'}</span>${i.note?`<span>${esc(i.note)}</span>`:''}</div></article>`).join(''):'<div class="empty">買い物リストは空です</div>';
}

function renderInventory(){
  const q=norm($('inventory-search').value);
  const items=array(state.shopping?.inventory).filter(i=>!q||norm([i.productName,i.note,i.category].join(' ')).includes(q));
  $('inventory-list').innerHTML=items.length?items.map(i=>`<article class="list-card"><h3>${esc(i.productName||'名称未設定')}</h3><div class="meta"><span class="pill">${i.confirmedQuantity==null?'要確認':`${esc(i.confirmedQuantity)}${esc(i.unit||'')}`}</span>${i.lastConfirmedDate?`<span>確認 ${esc(i.lastConfirmedDate)}</span>`:''}${i.note?`<span>${esc(i.note)}</span>`:''}</div></article>`).join(''):'<div class="empty">該当する在庫はありません</div>';
}

function renderBelongingFilters(){
  const items=array(state.belongings);
  const category=$('belongings-category'),location=$('belongings-location');
  const cv=category.value,lv=location.value;
  const cats=[...new Set(items.map(i=>i.category).filter(Boolean))].sort();
  const locs=[...new Set(items.map(i=>i.location).filter(Boolean))].sort();
  category.innerHTML='<option value="">すべてのカテゴリ</option>'+cats.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
  location.innerHTML='<option value="">すべての場所</option>'+locs.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
  category.value=cats.includes(cv)?cv:'';location.value=locs.includes(lv)?lv:'';
}

function renderBelongings(){
  const q=norm($('belongings-search').value),cat=$('belongings-category').value,loc=$('belongings-location').value;
  const items=array(state.belongings).filter(i=>(!q||norm([i.name,i.location,i.detail].join(' ')).includes(q))&&(!cat||i.category===cat)&&(!loc||i.location===loc));
  $('belongings-list').innerHTML=items.length?items.map(i=>`<article class="list-card"><h3>${esc(i.name||'名称未設定')}</h3><div class="meta"><span class="pill">📍 ${esc(i.location||'場所未設定')}</span>${i.category?`<span>${esc(i.category)}</span>`:''}${i.detail?`<span>${esc(i.detail)}</span>`:''}</div></article>`).join(''):'<div class="empty">該当する持ち物はありません</div>';
}

function renderSettings(){
  const c=counts(state),integrated=readJson(KEYS.integrated);
  $('migration-status').innerHTML=integrated?`最終取り込み：<strong>${esc(new Date(state.metadata.updatedAt).toLocaleString('ja-JP'))}</strong><br>買うもの ${c.shopping}件 ／ 在庫 ${c.inventory}件 ／ 持ち物 ${c.belongings}件`:'まだ統合用データを作成していません。';
  $('import-sources-btn').textContent=integrated?'元アプリから最新データを再取り込み':'元アプリから統合用データを作る';
}

function showView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view===name));
  window.scrollTo({top:0,behavior:'smooth'});
  $('main').focus({preventScroll:true});
}

function globalSearch(){
  const q=norm($('global-search').value),box=$('search-results');
  if(!q){box.hidden=true;box.innerHTML='';return}
  const results=[];
  array(state.shopping?.shoppingList).forEach(i=>{if(norm([i.productName,i.note].join(' ')).includes(q))results.push({kind:'買うもの',name:i.productName,meta:i.note||''})});
  array(state.shopping?.inventory).forEach(i=>{if(norm([i.productName,i.note].join(' ')).includes(q))results.push({kind:'在庫',name:i.productName,meta:i.confirmedQuantity==null?'数量要確認':`${i.confirmedQuantity}${i.unit||''}`})});
  array(state.belongings).forEach(i=>{if(norm([i.name,i.location,i.detail].join(' ')).includes(q))results.push({kind:'持ち物',name:i.name,meta:i.location||''})});
  box.hidden=false;
  box.innerHTML=results.length?results.slice(0,20).map(r=>`<div class="result-row"><div class="result-kind">${esc(r.kind)}</div><strong>${esc(r.name||'名称未設定')}</strong>${r.meta?`<div class="meta">${esc(r.meta)}</div>`:''}</div>`).join(''):'<div class="empty">見つかりませんでした</div>';
}

function exportIntegrated(){
  if(!readJson(KEYS.integrated)){showToast('先に統合用データを作成してください');return}
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`kurashi-cho-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);showToast('統合データを書き出しました');
}

async function importFile(file){
  try{const parsed=JSON.parse(await file.text());if(!validIntegrated(parsed))throw new Error('統合版のJSON形式ではありません');state=parsed;state.metadata.updatedAt=nowIso();writeJson(KEYS.integrated,state);renderAll();showToast('統合データを読み込みました')}catch(e){showToast(`読み込めませんでした：${e.message}`)}
}

async function importSourceFile(file){
  try{
    const parsed=JSON.parse(await file.text());
    if(validIntegrated(parsed)){
      state=parsed;state.metadata.updatedAt=nowIso();writeJson(KEYS.integrated,state);renderAll();showToast('統合版のバックアップを読み込みました');return;
    }
    let kind=null,data=null;
    if(Array.isArray(parsed)){kind='belongings';data=parsed}
    else if(Array.isArray(parsed?.ledger)){kind='belongings';data=parsed.ledger}
    else if(Array.isArray(parsed?.inventory)&&Array.isArray(parsed?.shoppingList)){kind='shopping';data=parsed}
    if(!kind)throw new Error('かいもの帖／持ち物台帳のJSON形式ではありません');
    const next={shopping:kind==='shopping'?data:state.shopping,belongings:kind==='belongings'?data:state.belongings};
    state=buildIntegrated(next);writeJson(KEYS.integrated,state);renderAll();
    showToast(kind==='shopping'?'かいもの帖のデータを取り込みました':'持ち物台帳のデータを取り込みました');
  }catch(e){showToast(`読み込めませんでした：${e.message}`)}
}

function clearIntegrated(){
  if(!confirm('統合用コピーを削除しますか？\n元アプリのデータは削除されません。'))return;
  localStorage.removeItem(KEYS.integrated);state=buildIntegrated({shopping:null,belongings:null});renderAll();showToast('統合用コピーを削除しました');showMigrationIfAvailable();
}

function showToast(message){const el=$('toast');clearTimeout(toastTimer);el.textContent=message;el.classList.add('show');toastTimer=setTimeout(()=>el.classList.remove('show'),3200)}

document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>showView(t.dataset.view)));
document.querySelectorAll('[data-go]').forEach(t=>t.addEventListener('click',()=>showView(t.dataset.go)));
$('global-search').addEventListener('input',globalSearch);
$('inventory-search').addEventListener('input',renderInventory);
$('belongings-search').addEventListener('input',renderBelongings);
$('belongings-category').addEventListener('change',renderBelongings);
$('belongings-location').addEventListener('change',renderBelongings);
$('migration-confirm').addEventListener('click',importSources);
$('migration-later').addEventListener('click',()=>$('migration-modal').hidden=true);
$('import-sources-btn').addEventListener('click',()=>{if(readJson(KEYS.integrated)&&!confirm('統合用コピーを元アプリの現在データで更新しますか？'))return;importSources()});
$('refresh-btn').addEventListener('click',()=>{
  const source=sourceSnapshot();
  if(source.shopping||source.belongings){
    state=buildIntegrated(source);writeJson(KEYS.integrated,state);renderAll();showToast('元アプリの最新データを読み込みました');
  }else{renderAll();showToast('表示を更新しました')}
});
$('export-btn').addEventListener('click',exportIntegrated);
$('import-source-file-btn').addEventListener('click',()=>$('import-source-file').click());
$('import-source-file').addEventListener('change',e=>{const file=e.target.files?.[0];if(file)importSourceFile(file);e.target.value=''});
$('import-btn').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',e=>{const file=e.target.files?.[0];if(file)importFile(file);e.target.value=''});
$('clear-integrated-btn').addEventListener('click',clearIntegrated);

load();
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
