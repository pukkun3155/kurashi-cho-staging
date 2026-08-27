const KEYS={integrated:'kurashi-cho-v1',backup:'kurashi-cho-v1.backup-before-source-import',shopping:'kaimono-memo-v1',belongings:'mochimon-v7'};
const VERSION='1.1.0';
const CATEGORIES=['その他','衣類','書類','工具','季節用品','食品','家電','日用品'];
let state=null,toastTimer=null,belongingEditId=null,inventoryEditId=null,purchaseShoppingId=null;
const $=id=>document.getElementById(id);
const readJson=key=>{try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):null}catch{return null}};
const writeJson=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
const norm=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s+/g,'');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const array=value=>Array.isArray(value)?value:[];
const nowIso=()=>new Date().toISOString();
const today=()=>{const d=new Date(),pad=n=>String(n).padStart(2,'0');return`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const uid=prefix=>`${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;

function sourceSnapshot(){const shopping=readJson(KEYS.shopping),belongings=readJson(KEYS.belongings);return{shopping:shopping&&typeof shopping==='object'&&!Array.isArray(shopping)?shopping:null,belongings:Array.isArray(belongings)?belongings:null}}
function normalizeState(value){const shopping=value?.shopping&&typeof value.shopping==='object'?value.shopping:{};shopping.shoppingList=array(shopping.shoppingList).map(i=>({...i,id:i.id||uid('shop')}));shopping.inventory=array(shopping.inventory).map(i=>({...i,id:i.id||uid('inv')}));shopping.purchaseLog=array(shopping.purchaseLog);shopping.inventoryLog=array(shopping.inventoryLog);return{...value,shopping,belongings:array(value?.belongings).map(i=>({...i,id:i.id||uid('item')}))}}
function buildIntegrated(source){return normalizeState({metadata:{schemaVersion:VERSION,createdAt:state?.metadata?.createdAt||nowIso(),updatedAt:nowIso(),sourceKeys:[KEYS.shopping,KEYS.belongings],mode:'integrated-editing'},shopping:source.shopping||{inventory:[],shoppingList:[],purchaseLog:[],inventoryLog:[]},belongings:source.belongings||[]})}
function validIntegrated(value){return!!value&&typeof value==='object'&&!Array.isArray(value)&&value.shopping&&Array.isArray(value.belongings)}
function counts(data){return{shopping:array(data?.shopping?.shoppingList).length,inventory:array(data?.shopping?.inventory).length,belongings:array(data?.belongings).length}}
function persist(message){state.metadata={...(state.metadata||{}),schemaVersion:VERSION,mode:'integrated-editing',updatedAt:nowIso()};writeJson(KEYS.integrated,state);renderAll();if(message)showToast(message)}
function load(){const saved=readJson(KEYS.integrated);state=validIntegrated(saved)?normalizeState(saved):buildIntegrated({shopping:null,belongings:null});renderAll();if(!validIntegrated(saved))showMigrationIfAvailable()}
function showMigrationIfAvailable(){const source=sourceSnapshot();if(!source.shopping&&!source.belongings)return;const c=counts(source);$('detected-counts').innerHTML=`買うもの <strong>${c.shopping}件</strong><br>在庫 <strong>${c.inventory}件</strong><br>持ち物 <strong>${c.belongings}件</strong>`;$('migration-modal').hidden=false}
function importSources(){const source=sourceSnapshot();if(!source.shopping&&!source.belongings){showToast('この端末に元アプリのデータが見つかりません');return}if(readJson(KEYS.integrated))writeJson(KEYS.backup,state);state=buildIntegrated(source);writeJson(KEYS.integrated,state);$('migration-modal').hidden=true;renderAll();const c=counts(state);showToast(`取り込みました（合計${c.shopping+c.inventory+c.belongings}件）`)}

// 並べ替えは表示専用。state配列自体の順序（登録順）は書き換えない。
function sortShopping(items){const mode=$('shopping-sort')?.value||'created';if(mode==='name')return[...items].sort((a,b)=>norm(a.productName).localeCompare(norm(b.productName),'ja'));return items}
function sortInventory(items){const mode=$('inventory-sort')?.value||'created';const q=i=>i.confirmedQuantity;if(mode==='name')return[...items].sort((a,b)=>norm(a.productName).localeCompare(norm(b.productName),'ja'));if(mode==='qty-asc')return[...items].sort((a,b)=>(q(a)==null)-(q(b)==null)||q(a)-q(b));if(mode==='qty-desc')return[...items].sort((a,b)=>(q(a)==null)-(q(b)==null)||q(b)-q(a));if(mode==='date-desc')return[...items].sort((a,b)=>(!a.lastConfirmedDate)-(!b.lastConfirmedDate)||(b.lastConfirmedDate||'').localeCompare(a.lastConfirmedDate||''));return items}
function sortBelongings(items){const mode=$('belongings-sort')?.value||'created';if(mode==='name')return[...items].sort((a,b)=>norm(a.name).localeCompare(norm(b.name),'ja'));if(mode==='location')return[...items].sort((a,b)=>norm(a.location).localeCompare(norm(b.location),'ja'));if(mode==='category')return[...items].sort((a,b)=>norm(a.category).localeCompare(norm(b.category),'ja'));if(mode==='updated-desc')return[...items].sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));return items}

// ---- 在庫予測（表示専用） ----
// 確定在庫(confirmedQuantity)・最終確認日(lastConfirmedDate)は、ここでは一切書き換えない。
// 使用ペースは既存の shopping.consumptionRates（旧かいもの帖から移行時に引き継がれるフィールド）を
// そのまま使う。新しい保存フィールドは追加しない。存在しない場合は「使用ペース未設定」として扱う。
// 旧かいもの帖の実コードを確認したところ、restockAtRemainingUses.max は「残り使用回数」という
// 独立した換算値ではなく、推定残量（confirmedQuantityと同じ単位の生の数量）にそのまま比較される
// 閾値だった： i<=t.thresholds.restockAtRemainingUses.max ? 'buy' : ...
// 使用ペースが分からない商品には別の閾値 buyToday.unknownRateConfirmedInventoryBelow が使われ、
// 比較も「未満」(<) だった： e.confirmedQuantity<t.thresholds.buyToday.unknownRateConfirmedInventoryBelow
const FORECAST_DEFAULT_THRESHOLDS={restockAtRemainingUses:{max:2},buyForSafety:{daysUntilEmptyMax:3},buyToday:{unknownRateConfirmedInventoryBelow:1}};
// FORECAST_STALE_DAYS（前回確認から一定日数経過したらamberへ格上げ）は初期版では無効化する。
// 実運用を見てから要否を再検討するため、定数と分岐は残し、判定には使わない（下のforecastFor参照）。
const FORECAST_STALE_DAYS=14;
const FORECAST_STALE_JUDGEMENT_ENABLED=false;
const FORECAST_EXCLUDED_CATEGORIES=['non_consumable','equipment'];
const FORECAST_HOME_LIMIT=6;
const daysBetween=(a,b)=>{if(!a||!b)return null;const d1=new Date(a+'T00:00:00+09:00'),d2=new Date(b+'T00:00:00+09:00');return Math.round((d2-d1)/86400000)};
function forecastThresholds(){const t=state.shopping.thresholds;return{restockAtRemainingUses:{max:t?.restockAtRemainingUses?.max??FORECAST_DEFAULT_THRESHOLDS.restockAtRemainingUses.max},buyForSafety:{daysUntilEmptyMax:t?.buyForSafety?.daysUntilEmptyMax??FORECAST_DEFAULT_THRESHOLDS.buyForSafety.daysUntilEmptyMax},buyToday:{unknownRateConfirmedInventoryBelow:t?.buyToday?.unknownRateConfirmedInventoryBelow??FORECAST_DEFAULT_THRESHOLDS.buyToday.unknownRateConfirmedInventoryBelow}}}
function forecastRateFor(item){return array(state.shopping.consumptionRates).find(r=>r.inventoryId===item.id)||null}
// 最終確認日より後に記録された、同じ商品名の購入履歴を加算する（購入を挟んでも見落とさない）
function forecastRecentPurchases(item){if(!item.lastConfirmedDate)return 0;return array(state.shopping.purchaseLog).filter(p=>p.date>item.lastConfirmedDate&&norm(p.productName)===norm(item.productName)).reduce((sum,p)=>sum+(Number(p.quantity)||0),0)}
// 推定在庫 = 最終確認数量 + 確認後の購入数量 - 経過日数×1日あたり使用量（0未満にはしない・確定値は変更しない）
function forecastFor(item){
  if(item.confirmedQuantity==null||!item.lastConfirmedDate)return{status:'unknown',reason:'no-baseline'};
  const rate=forecastRateFor(item);
  if(!rate||!(Number(rate.quantityPerDay)>0)){
    // 使用ペース不明：修正1の指示どおり、赤・黄へは格上げせず一律「⚪ 一度在庫を確認」として扱う。
    // buyToday.unknownRateConfirmedInventoryBelow は在庫確認後プロンプト側でのみ使う（下記参照）。
    return{status:'unknown',reason:'no-rate',confirmedQuantity:item.confirmedQuantity,lastConfirmedDate:item.lastConfirmedDate};
  }
  const elapsed=daysBetween(item.lastConfirmedDate,today())??0;
  const purchased=forecastRecentPurchases(item);
  let estimate=item.confirmedQuantity+purchased-elapsed*rate.quantityPerDay;
  if(estimate<0)estimate=0;
  const daysLeft=estimate/rate.quantityPerDay;
  const th=forecastThresholds();
  let status='ok';
  if(estimate<=th.restockAtRemainingUses.max)status='red';
  else if(daysLeft<=th.buyForSafety.daysUntilEmptyMax||(FORECAST_STALE_JUDGEMENT_ENABLED&&elapsed>=FORECAST_STALE_DAYS))status='amber';
  return{status,estimate,daysLeft,elapsed,purchased,rate,confirmedQuantity:item.confirmedQuantity,lastConfirmedDate:item.lastConfirmedDate};
}
function forecastStatusMeta(status){return{red:{icon:'🔴',label:'確認してください'},amber:{icon:'🟠',label:'そろそろ確認'},unknown:{icon:'⚪',label:'一度在庫を確認'}}[status]||{icon:'',label:''}}
function eligibleForecastItems(){return array(state.shopping.inventory).filter(i=>!FORECAST_EXCLUDED_CATEGORIES.includes(i.category))}
function forecastCardHtml(item,forecast){
  const meta=forecastStatusMeta(forecast.status);
  let metaHtml;
  if(forecast.status==='unknown'){
    metaHtml=forecast.reason==='no-baseline'
      ?`<span>確定在庫の記録がありません</span>`
      :`<span>確定 ${esc(item.confirmedQuantity)}${esc(item.unit||'')}${item.lastConfirmedDate?`（${esc(item.lastConfirmedDate)}確認）`:''}</span><span>使用ペース未設定</span>`;
  }else{
    const roundedEstimate=Math.round((forecast.estimate??0)*10)/10;
    const rateText=forecast.rate?`${forecast.rate.quantityPerDay}${forecast.rate.unit||item.unit||''}/日`:'';
    metaHtml=`<span>確定 ${esc(item.confirmedQuantity)}${esc(item.unit||'')}（${esc(item.lastConfirmedDate)}確認）</span><span>予測 約${esc(roundedEstimate)}${esc(item.unit||'')}</span>${rateText?`<span>使用ペース ${esc(rateText)}</span>`:''}`;
  }
  return`<article class="list-card forecast-card forecast-${forecast.status}"><h3>${esc(item.productName||'名称未設定')}</h3><div class="forecast-badge">${meta.icon} ${esc(meta.label)}</div><div class="meta">${metaHtml}</div><div class="item-actions"><button class="primary-small" data-action="check-stock" data-id="${esc(item.id)}">在庫を確認</button></div></article>`;
}
// 優先順位 red > amber > unknown。unknownで画面が埋まらないよう、red/amberを入れてから
// 残り枠だけをunknownで埋める（合計はFORECAST_HOME_LIMIT件まで）。
function renderStockCheck(){
  const groups={red:[],amber:[],unknown:[]};
  eligibleForecastItems().forEach(item=>{const forecast=forecastFor(item);if(groups[forecast.status])groups[forecast.status].push({item,forecast})});
  const byEstimateAsc=(a,b)=>(a.forecast.estimate??0)-(b.forecast.estimate??0);
  groups.red.sort(byEstimateAsc);groups.amber.sort(byEstimateAsc);
  const redAndAmber=[...groups.red,...groups.amber];
  const remaining=Math.max(0,FORECAST_HOME_LIMIT-redAndAmber.length);
  const top=[...redAndAmber,...groups.unknown.slice(0,remaining)].slice(0,FORECAST_HOME_LIMIT);
  $('stock-check-list').innerHTML=top.length?top.map(({item,forecast})=>forecastCardHtml(item,forecast)).join(''):'<div class="empty">確認が必要な在庫は見当たりません</div>'}

function renderAll(){const c=counts(state);$('shopping-count').textContent=c.shopping;$('inventory-count').textContent=c.inventory;$('belongings-count').textContent=c.belongings;const integrated=!!readJson(KEYS.integrated);$('sync-badge').textContent=integrated?'利用中':'未統合';$('sync-badge').classList.toggle('ok',integrated);renderStockCheck();renderToday();renderShopping();renderInventory();renderBelongingFilters();renderBelongings();renderSettings()}
function renderToday(){const shopping=array(state.shopping.shoppingList).slice(0,5),unknown=array(state.shopping.inventory).filter(i=>i.confirmedQuantity==null).slice(0,3);const rows=[...shopping.map(i=>({label:i.productName||'名称未設定',meta:`買うもの${i.plannedQuantity!=null?`・${i.plannedQuantity}${i.unit||''}`:''}`})),...unknown.map(i=>({label:i.productName||'名称未設定',meta:'在庫数を確認'}))];$('today-summary').innerHTML=rows.length?rows.map(r=>`<div class="summary-row"><strong>${esc(r.label)}</strong><span>${esc(r.meta)}</span></div>`).join(''):'<div class="empty">今日確認する候補はありません</div>'}
function renderShopping(){const all=array(state.shopping.shoppingList),q=norm($('shopping-search')?.value||'');let items=all.filter(i=>!q||norm([i.productName,i.note,i.unit].join(' ')).includes(q));items=sortShopping(items);$('shopping-list').innerHTML=items.length?items.map(i=>`<article class="list-card"><h3>${esc(i.productName||'名称未設定')}</h3><div class="meta"><span>${i.plannedQuantity!=null?`予定 ${esc(i.plannedQuantity)}${esc(i.unit||'')}`:'数量未設定'}</span>${i.note?`<span>${esc(i.note)}</span>`:''}</div><div class="item-actions"><button class="primary-small" data-action="buy-inventory" data-id="${esc(i.id)}">購入→在庫</button><button data-action="buy-belonging" data-id="${esc(i.id)}">購入→持ち物</button><button class="danger-small" data-action="delete-shopping" data-id="${esc(i.id)}">削除</button></div></article>`).join(''):`<div class="empty">${all.length?'該当する買うものはありません':'買い物リストは空です'}</div>`}
function renderInventory(){const q=norm($('inventory-search').value);let items=array(state.shopping.inventory).filter(i=>!q||norm([i.productName,i.note,i.category].join(' ')).includes(q));items=sortInventory(items);$('inventory-list').innerHTML=items.length?items.map(i=>`<article class="list-card"><h3>${esc(i.productName||'名称未設定')}</h3><div class="meta"><span class="pill">${i.confirmedQuantity==null?'要確認':`${esc(i.confirmedQuantity)}${esc(i.unit||'')}`}</span>${i.lastConfirmedDate?`<span>確認 ${esc(i.lastConfirmedDate)}</span>`:''}${i.note?`<span>${esc(i.note)}</span>`:''}</div><div class="item-actions"><button data-action="edit-inventory" data-id="${esc(i.id)}">数量・商品を編集</button><button class="danger-small" data-action="delete-inventory" data-id="${esc(i.id)}">削除</button></div></article>`).join(''):'<div class="empty">該当する在庫はありません</div>'}
function renderBelongingFilters(){const items=array(state.belongings),category=$('belongings-category'),location=$('belongings-location'),cv=category.value,lv=location.value;const cats=[...new Set(items.map(i=>i.category).filter(Boolean))].sort(),locs=[...new Set(items.map(i=>i.location).filter(Boolean))].sort();category.innerHTML='<option value="">すべてのカテゴリ</option>'+cats.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');location.innerHTML='<option value="">すべての場所</option>'+locs.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');category.value=cats.includes(cv)?cv:'';location.value=locs.includes(lv)?lv:'';$('location-options').innerHTML=locs.map(v=>`<option value="${esc(v)}"></option>`).join('')}
function renderBelongings(){const q=norm($('belongings-search').value),cat=$('belongings-category').value,loc=$('belongings-location').value;let items=array(state.belongings).filter(i=>(!q||norm([i.name,i.location,i.detail].join(' ')).includes(q))&&(!cat||i.category===cat)&&(!loc||i.location===loc));items=sortBelongings(items);$('belongings-list').innerHTML=items.length?items.map(i=>`<article class="list-card"><h3>${esc(i.name||'名称未設定')}</h3><div class="meta"><span class="pill">📍 ${esc(i.location||'場所未設定')}</span>${i.category?`<span>${esc(i.category)}</span>`:''}${i.detail?`<span>${esc(i.detail)}</span>`:''}</div><div class="item-actions"><button data-action="edit-belonging" data-id="${esc(i.id)}">編集・移動</button><button class="danger-small" data-action="delete-belonging" data-id="${esc(i.id)}">削除</button></div></article>`).join(''):'<div class="empty">該当する持ち物はありません</div>'}
function renderSettings(){const c=counts(state),integrated=readJson(KEYS.integrated);$('migration-status').innerHTML=integrated?`最終更新：<strong>${esc(new Date(state.metadata.updatedAt).toLocaleString('ja-JP'))}</strong><br>買うもの ${c.shopping}件 ／ 在庫 ${c.inventory}件 ／ 持ち物 ${c.belongings}件`:'まだ統合データを作成していません。';$('import-sources-btn').textContent=integrated?'元アプリのデータで置き換える':'元アプリから統合データを作る'}

function addShopping(){const name=$('shopping-name').value.trim();if(!name){showToast('商品名を入力してください');return}const raw=$('shopping-qty').value,qty=raw===''?null:Number(raw);state.shopping.shoppingList.push({id:uid('shop'),productName:name,plannedQuantity:Number.isFinite(qty)?qty:null,unit:$('shopping-unit').value.trim()||null,note:$('shopping-note').value.trim()||null,createdAt:nowIso()});['shopping-name','shopping-qty','shopping-unit','shopping-note'].forEach(id=>$(id).value='');persist('買うものに追加しました')}
function recordPurchase(item,qty){state.shopping.purchaseLog.push({id:uid('purchase'),date:today(),productName:item.productName,quantity:qty,unit:item.unit||'',sourceShoppingId:item.id})}
function removeShopping(id){state.shopping.shoppingList=state.shopping.shoppingList.filter(i=>i.id!==id)}
function purchaseToInventory(id){const item=state.shopping.shoppingList.find(i=>i.id===id);if(!item)return;const qty=Number(item.plannedQuantity)>0?Number(item.plannedQuantity):1,existing=state.shopping.inventory.find(i=>norm(i.productName)===norm(item.productName));if(existing){existing.confirmedQuantity=(Number(existing.confirmedQuantity)||0)+qty;existing.unit=existing.unit||item.unit||null;existing.lastConfirmedDate=today()}else state.shopping.inventory.push({id:uid('inv'),productName:item.productName,confirmedQuantity:qty,unit:item.unit||null,lastConfirmedDate:today(),category:'consumable',note:item.note||'買い物リストから登録'});recordPurchase(item,qty);removeShopping(id);persist(`${item.productName}を在庫へ登録しました`)}

function openBelongingModal(id=null,shoppingId=null){belongingEditId=id;purchaseShoppingId=shoppingId;const item=id?state.belongings.find(i=>i.id===id):null,shop=shoppingId?state.shopping.shoppingList.find(i=>i.id===shoppingId):null;$('belonging-modal-title').textContent=shoppingId?'購入品を持ち物へ登録':id?'持ち物を編集・移動':'持ち物を追加';$('belonging-name').value=item?.name||shop?.productName||'';$('belonging-location').value=item?.location||'';$('belonging-detail').value=item?.detail||shop?.note||'';$('belonging-category-edit').innerHTML=CATEGORIES.map(c=>`<option>${esc(c)}</option>`).join('');$('belonging-category-edit').value=item?.category||'その他';$('belonging-modal').hidden=false;setTimeout(()=>$('belonging-name').focus(),30)}
function saveBelonging(){const name=$('belonging-name').value.trim(),location=$('belonging-location').value.trim();if(!name||!location){showToast('品名と場所を入力してください');return}const wasEdit=!!belongingEditId,values={name,location,category:$('belonging-category-edit').value,detail:$('belonging-detail').value.trim(),updatedAt:today()};if(belongingEditId){const index=state.belongings.findIndex(i=>i.id===belongingEditId);if(index>=0)state.belongings[index]={...state.belongings[index],...values}}else state.belongings.push({id:uid('item'),savedAt:today(),...values});if(purchaseShoppingId){const shop=state.shopping.shoppingList.find(i=>i.id===purchaseShoppingId);if(shop){recordPurchase(shop,Number(shop.plannedQuantity)>0?Number(shop.plannedQuantity):1);removeShopping(shop.id)}}closeBelongingModal();persist(wasEdit?'持ち物を更新しました':'持ち物を登録しました')}
function closeBelongingModal(){$('belonging-modal').hidden=true;belongingEditId=null;purchaseShoppingId=null}
function openInventoryModal(id=null){inventoryEditId=id;const item=id?state.shopping.inventory.find(i=>i.id===id):null;$('inventory-modal-title').textContent=id?'在庫を編集':'在庫を追加';$('inventory-name-edit').value=item?.productName||'';$('inventory-qty-edit').value=item?.confirmedQuantity??'';$('inventory-unit-edit').value=item?.unit||'';$('inventory-note-edit').value=item?.note||'';$('inventory-modal').hidden=false;setTimeout(()=>$('inventory-name-edit').focus(),30)}
function saveInventory(){const name=$('inventory-name-edit').value.trim(),raw=$('inventory-qty-edit').value,qty=Number(raw),wasEdit=!!inventoryEditId;if(!name||raw===''||!Number.isFinite(qty)||qty<0){showToast('商品名と0以上の数量を入力してください');return}const values={productName:name,confirmedQuantity:qty,unit:$('inventory-unit-edit').value.trim()||null,note:$('inventory-note-edit').value.trim()||null,lastConfirmedDate:today()};let savedId=inventoryEditId;if(inventoryEditId){const index=state.shopping.inventory.findIndex(i=>i.id===inventoryEditId);if(index>=0)state.shopping.inventory[index]={...state.shopping.inventory[index],...values}}else{savedId=uid('inv');state.shopping.inventory.push({id:savedId,category:'consumable',...values})}closeInventoryModal();persist(wasEdit?'在庫を更新しました':'在庫を追加しました');maybePromptAddToShopping(state.shopping.inventory.find(i=>i.id===savedId))}
function closeInventoryModal(){$('inventory-modal').hidden=true;inventoryEditId=null}
// 「在庫を確認」操作後、確定数量が少なければ買い物リストへの追加を提案する。
// あくまで選択肢を示すだけで、ユーザーがボタンを押さない限り買い物リストは変更しない。
let stockPromptItem=null;
// 旧かいもの帖と同じ判定を使う：使用ペースが分かっている商品は restockAtRemainingUses.max 以下、
// 分からない商品は buyToday.unknownRateConfirmedInventoryBelow 未満（比較演算子も含めて旧仕様どおり）。
function isLowStock(item){const th=forecastThresholds(),rate=forecastRateFor(item);return rate&&Number(rate.quantityPerDay)>0?item.confirmedQuantity<=th.restockAtRemainingUses.max:item.confirmedQuantity<th.buyToday.unknownRateConfirmedInventoryBelow}
function maybePromptAddToShopping(item){if(!item||item.confirmedQuantity==null)return;if(!isLowStock(item))return;if(state.shopping.shoppingList.some(s=>norm(s.productName)===norm(item.productName)))return;stockPromptItem=item;$('stock-prompt-name').textContent=item.productName||'名称未設定';$('stock-prompt-qty').textContent=`${item.confirmedQuantity}${item.unit||''}`;$('stock-prompt-modal').hidden=false}
function closeStockPrompt(){$('stock-prompt-modal').hidden=true;stockPromptItem=null}
function confirmStockPromptAdd(){if(!stockPromptItem)return;state.shopping.shoppingList.push({id:uid('shop'),productName:stockPromptItem.productName,plannedQuantity:null,unit:stockPromptItem.unit||null,status:'未購入',note:'在庫確認から追加',createdAt:nowIso()});closeStockPrompt();persist('買い物リストに追加しました')}
function handleListAction(event){const button=event.target.closest('[data-action]');if(!button)return;const{id,action}=button.dataset;if(action==='buy-inventory')purchaseToInventory(id);if(action==='buy-belonging')openBelongingModal(null,id);if(action==='edit-belonging')openBelongingModal(id);if(action==='edit-inventory')openInventoryModal(id);if(action==='check-stock')openInventoryModal(id);if(action==='delete-shopping'&&confirm('この買うものを削除しますか？')){removeShopping(id);persist('買うものから削除しました')}if(action==='delete-belonging'&&confirm('この持ち物を削除しますか？')){state.belongings=state.belongings.filter(i=>i.id!==id);persist('持ち物を削除しました')}if(action==='delete-inventory'&&confirm('この在庫を削除しますか？')){state.shopping.inventory=state.shopping.inventory.filter(i=>i.id!==id);persist('在庫を削除しました')}}

function showView(name){document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view===name));window.scrollTo({top:0,behavior:'smooth'});$('main').focus({preventScroll:true})}
function globalSearch(){const q=norm($('global-search').value),box=$('search-results');if(!q){box.hidden=true;box.innerHTML='';return}const results=[];array(state.shopping.shoppingList).forEach(i=>{if(norm([i.productName,i.note].join(' ')).includes(q))results.push({kind:'買うもの',name:i.productName,meta:i.note||''})});array(state.shopping.inventory).forEach(i=>{if(norm([i.productName,i.note].join(' ')).includes(q))results.push({kind:'在庫',name:i.productName,meta:i.confirmedQuantity==null?'数量要確認':`${i.confirmedQuantity}${i.unit||''}`})});array(state.belongings).forEach(i=>{if(norm([i.name,i.location,i.detail].join(' ')).includes(q))results.push({kind:'持ち物',name:i.name,meta:i.location||''})});box.hidden=false;box.innerHTML=results.length?results.slice(0,20).map(r=>`<div class="result-row"><div class="result-kind">${esc(r.kind)}</div><strong>${esc(r.name||'名称未設定')}</strong>${r.meta?`<div class="meta">${esc(r.meta)}</div>`:''}</div>`).join(''):'<div class="empty">見つかりませんでした</div>'}
function backupJson(){return JSON.stringify(state,null,2)}
function showJsonModal(){$('json-text').value=backupJson();$('json-modal').hidden=false}
async function copyJson(){if(!readJson(KEYS.integrated)){showToast('先に統合データを作成してください');return}const text=backupJson();try{await navigator.clipboard.writeText(text);showToast('JSONをコピーしました')}catch{showJsonModal();$('json-text').focus();$('json-text').select();showToast('下の文字を選択してコピーしてください')}}
async function exportIntegrated(){if(!readJson(KEYS.integrated)){showToast('先に統合データを作成してください');return}const name=`kurashi-cho-backup-${today()}.json`,file=new File([backupJson()],name,{type:'application/json'});if(navigator.share&&navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'くらし帖バックアップ'});showToast('バックアップを共有しました');return}catch(e){if(e.name==='AbortError')return}}showJsonModal();showToast('JSONをコピーして保存してください')}
async function importFile(file){try{const parsed=JSON.parse(await file.text());if(!validIntegrated(parsed))throw new Error('統合版のJSON形式ではありません');state=normalizeState(parsed);persist('統合データを読み込みました')}catch(e){showToast(`読み込めませんでした：${e.message}`)}}
async function importSourceFile(file){try{const parsed=JSON.parse(await file.text());if(validIntegrated(parsed)){state=normalizeState(parsed);persist('統合版のバックアップを読み込みました');return}let kind=null,data=null;if(Array.isArray(parsed)){kind='belongings';data=parsed}else if(Array.isArray(parsed?.ledger)){kind='belongings';data=parsed.ledger}else if(Array.isArray(parsed?.inventory)&&Array.isArray(parsed?.shoppingList)){kind='shopping';data=parsed}if(!kind)throw new Error('かいもの帖／持ち物台帳のJSON形式ではありません');writeJson(KEYS.backup,state);state=buildIntegrated({shopping:kind==='shopping'?data:state.shopping,belongings:kind==='belongings'?data:state.belongings});persist(kind==='shopping'?'かいもの帖のデータを取り込みました':'持ち物台帳のデータを取り込みました')}catch(e){showToast(`読み込めませんでした：${e.message}`)}}
function clearIntegrated(){if(!confirm('統合データを削除しますか？\n元アプリのデータは削除されません。'))return;localStorage.removeItem(KEYS.integrated);state=buildIntegrated({shopping:null,belongings:null});renderAll();showToast('統合データを削除しました');showMigrationIfAvailable()}
function showToast(message){const el=$('toast');clearTimeout(toastTimer);el.textContent=message;el.classList.add('show');toastTimer=setTimeout(()=>el.classList.remove('show'),3200)}

document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>showView(t.dataset.view)));document.querySelectorAll('[data-go]').forEach(t=>t.addEventListener('click',()=>showView(t.dataset.go)));
$('global-search').addEventListener('input',globalSearch);$('shopping-search').addEventListener('input',renderShopping);$('shopping-sort').addEventListener('change',renderShopping);$('inventory-search').addEventListener('input',renderInventory);$('inventory-sort').addEventListener('change',renderInventory);$('belongings-search').addEventListener('input',renderBelongings);$('belongings-category').addEventListener('change',renderBelongings);$('belongings-location').addEventListener('change',renderBelongings);$('belongings-sort').addEventListener('change',renderBelongings);
$('shopping-list').addEventListener('click',handleListAction);$('inventory-list').addEventListener('click',handleListAction);$('belongings-list').addEventListener('click',handleListAction);$('stock-check-list').addEventListener('click',handleListAction);
$('add-shopping-btn').addEventListener('click',addShopping);$('add-inventory-btn').addEventListener('click',()=>openInventoryModal());$('add-belonging-btn').addEventListener('click',()=>openBelongingModal());$('home-add-belonging').addEventListener('click',()=>openBelongingModal());
$('belonging-cancel').addEventListener('click',closeBelongingModal);$('belonging-save').addEventListener('click',saveBelonging);$('inventory-cancel').addEventListener('click',closeInventoryModal);$('inventory-save').addEventListener('click',saveInventory);$('stock-prompt-skip').addEventListener('click',closeStockPrompt);$('stock-prompt-add').addEventListener('click',confirmStockPromptAdd);
$('migration-confirm').addEventListener('click',importSources);$('migration-later').addEventListener('click',()=>$('migration-modal').hidden=true);
$('import-sources-btn').addEventListener('click',()=>{if(readJson(KEYS.integrated)&&!confirm('現在の統合データを元アプリのデータで置き換えますか？\n現在の内容は端末内に自動バックアップします。'))return;importSources()});$('refresh-btn').addEventListener('click',()=>{renderAll();showToast('表示を更新しました')});
$('export-btn').addEventListener('click',exportIntegrated);$('copy-json-btn').addEventListener('click',copyJson);$('json-close').addEventListener('click',()=>$('json-modal').hidden=true);$('json-copy-again').addEventListener('click',copyJson);$('import-source-file-btn').addEventListener('click',()=>$('import-source-file').click());$('import-source-file').addEventListener('change',e=>{const file=e.target.files?.[0];if(file)importSourceFile(file);e.target.value=''});$('import-btn').addEventListener('click',()=>$('import-file').click());$('import-file').addEventListener('change',e=>{const file=e.target.files?.[0];if(file)importFile(file);e.target.value=''});$('clear-integrated-btn').addEventListener('click',clearIntegrated);
load();if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
