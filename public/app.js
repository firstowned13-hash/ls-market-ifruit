const CATEGORIES=['all','vehicles','realestate','electronics','clothing','services','other'];
const state={listings:[],photos:[],me:null,config:null,view:'feed',locale:'en',category:'all',strings:{},theme:'light'};
const $=s=>document.querySelector(s);
const escapeHtml=(s='')=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const initials=s=>String(s||'?').slice(0,1).toUpperCase();

function normalizeLocale(value='en'){
  const v=String(value).toLowerCase().replace('_','-');
  if(v.startsWith('pt'))return'pt';
  if(v.startsWith('ko'))return'ko';
  if(v.startsWith('ru'))return'ru';
  return'en';
}
async function loadLocale(locale){
  const lang=normalizeLocale(locale);
  try{state.strings=await fetch('/locales/'+lang+'.json').then(r=>r.json());state.locale=lang;}
  catch{state.strings=await fetch('/locales/en.json').then(r=>r.json());state.locale='en';}
  applyTranslations();
}
function t(key,vars={}){
  let s=state.strings[key]||key;
  for(const[k,v]of Object.entries(vars))s=s.replaceAll('{'+k+'}',String(v));
  return s;
}
function money(n){
  const locale=state.locale==='pt'?'pt-BR':state.locale==='ko'?'ko-KR':state.locale==='ru'?'ru-RU':'en-US';
  return'$'+Number(n||0).toLocaleString(locale);
}
function applyTranslations(){
  document.documentElement.lang=state.locale;
  document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=t(el.dataset.i18n));
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el=>el.placeholder=t(el.dataset.i18nPlaceholder));
  $('#localePill').textContent=state.locale.toUpperCase();
  renderCategoryControls();updateViewLabels();
  if(state.config)$('#listingFeeLabel').textContent=money(state.config.listingFee);
}
function renderCategoryControls(){
  $('#categoryChips').innerHTML=CATEGORIES.map(code=>'<button class="chip '+(state.category===code?'active':'')+'" data-category="'+code+'">'+t('cat_'+code)+'</button>').join('');
  $('#categoryChips').querySelectorAll('.chip').forEach(b=>b.addEventListener('click',()=>{state.category=b.dataset.category;renderCategoryControls();loadListings();}));
  $('#listingCategory').innerHTML=CATEGORIES.filter(c=>c!=='all').map(code=>'<option value="'+code+'">'+t('cat_'+code)+'</option>').join('');
}
function updateViewLabels(){
  if(state.view==='mine'){$('#feedTitle').textContent=t('my_listings');$('#feedSubtitle').textContent='@'+(state.me||'—');}
  else{$('#feedTitle').textContent=t('discover');$('#feedSubtitle').textContent=t('discover_subtitle');}
}
function categoryLabel(code){
  const legacy={'Veículos':'vehicles','Imóveis':'realestate','Eletrônicos':'electronics','Roupas':'clothing','Serviços':'services','Outros':'other'};
  return t('cat_'+(legacy[code]||code||'other'));
}
function phoneBridge(type,payload={}){
  const requestId=crypto.randomUUID();
  return new Promise(resolve=>{
    function onMessage(event){const data=event.data;if(!data||data.requestId!==requestId)return;window.removeEventListener('message',onMessage);resolve(data);}
    window.addEventListener('message',onMessage);window.parent.postMessage({type,requestId,...payload},'*');
  });
}
window.addEventListener('message',async event=>{
  const d=event.data||{};
  if(d.type==='united:phone:locales'){
    const next=normalizeLocale(d.languageUi||d.uiLocale||d.locale);
    if(next!==state.locale){await loadLocale(next);renderFeed();}
  }
  if(d.type==='united:phone:theme'){
    state.theme=d.theme||d.uiTheme||state.theme;document.documentElement.dataset.phoneTheme=state.theme;
  }
});

async function boot(){
  state.config=await fetch('/api/config').then(r=>r.json());
  let requestedLocale='en';
  try{const r=await phoneBridge('united:phone:getLocales');requestedLocale=r?.languageUi||r?.uiLocale||'en';}catch{}
  await loadLocale(requestedLocale);
  try{const r=await phoneBridge('united:phone:getIfruitAccount');if(r?.ok&&r.username)state.me=r.username;}catch{}
  if(!state.me)state.me=localStorage.getItem('dev_ifruit_username')||'devuser';
  updateViewLabels();await loadListings();
}
async function loadListings(){
  const q=$('#searchInput').value.trim();const url=new URL('/api/listings',location.origin);
  if(q)url.searchParams.set('q',q);if(state.category!=='all')url.searchParams.set('category',state.category);
  const data=await fetch(url).then(r=>r.json());state.listings=Array.isArray(data)?data:[];renderFeed();
}
function renderFeed(){
  updateViewLabels();const feed=$('#feed');const rows=state.view==='mine'?state.listings.filter(x=>x.seller_username===state.me):state.listings;
  if(!rows.length){feed.innerHTML='<div class="empty">'+t('no_results')+'</div>';return;}
  feed.innerHTML=rows.map(l=>{const boosted=(l.boosted_until||0)>Date.now();return'<article class="card '+(boosted?'boosted':'')+'" data-id="'+escapeHtml(l.id)+'"><div class="card-image-wrap"><img src="'+escapeHtml(l.images?.[0]||'')+'" alt="">'+(boosted?'<span class="boost-badge">'+t('boosted')+'</span>':'')+'</div><div class="card-body"><div class="card-cat">'+escapeHtml(categoryLabel(l.category))+'</div><div class="card-title">'+escapeHtml(l.title)+'</div><div class="card-price">'+money(l.price)+'</div><div class="card-footer"><div class="seller-line"><span class="avatar">'+initials(l.seller_username)+'</span><span>@'+escapeHtml(l.seller_username)+'</span></div></div></div></article>';}).join('');
  feed.querySelectorAll('.card').forEach(el=>el.addEventListener('click',()=>openDetail(el.dataset.id)));
}
async function openDetail(id){
  const l=await fetch('/api/listings/'+encodeURIComponent(id)).then(r=>r.json());const boosted=(l.boosted_until||0)>Date.now();const mine=l.seller_username===state.me;
  const gallery=(l.images||[]).map(src=>'<img src="'+escapeHtml(src)+'" alt="">').join('');
  $('#detail').innerHTML='<div class="sheet-handle"></div><div class="sheet-head"><div><div class="eyebrow">'+escapeHtml(categoryLabel(l.category))+'</div><h2>'+escapeHtml(l.title)+'</h2></div><button id="detailClose" class="ghost round">×</button></div><div class="detail-gallery">'+gallery+'</div><div class="detail-price">'+money(l.price)+'</div>'+(boosted?'<span class="boost-badge" style="position:static;display:inline-flex;margin-top:8px">'+t('boosted')+'</span>':'')+'<div class="detail-description">'+escapeHtml(l.description)+'</div><div class="detail-seller"><div class="seller-line"><span class="avatar">'+initials(l.seller_username)+'</span><span><strong>@'+escapeHtml(l.seller_username)+'</strong><br><small>'+t('seller')+(l.phone?' · '+escapeHtml(l.phone):'')+'</small></span></div></div>'+(!mine&&l.phone?'<div class="detail-actions two"><button id="msgBtn" class="primary">'+t('send_message')+'</button><button id="contactBtn" class="secondary">'+t('add_contact')+'</button></div>':'')+(mine?'<div class="boost-box"><strong>'+t('boost_listing')+'</strong><div class="hint">'+t('boost_desc',{price:money(state.config.boostFee),hours:state.config.boostHours})+'</div><button id="boostBtn" class="primary full">'+t('boost_for',{price:money(state.config.boostFee)})+'</button></div><div class="detail-actions"><button id="soldBtn" class="secondary">'+t('mark_sold')+'</button></div>':'');
  $('#detailDialog').showModal();$('#detailClose').addEventListener('click',()=>$('#detailDialog').close());
  $('#msgBtn')?.addEventListener('click',()=>phoneBridge('united:phone:openComposeMessage',{phone:l.phone}));
  $('#contactBtn')?.addEventListener('click',()=>phoneBridge('united:phone:openNewContact',{phone:l.phone,name:l.seller_username}));
  $('#boostBtn')?.addEventListener('click',async()=>{const r=await fetch('/api/listings/'+l.id+'/boost',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sellerUsername:state.me})}).then(r=>r.json());if(!r.transactionId)return notice(r.error||t('payment_start_error'));await openNativePaymentAndWait(r.transactionId,'boost');});
  $('#soldBtn')?.addEventListener('click',async()=>{await fetch('/api/listings/'+l.id+'/mark-sold',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sellerUsername:state.me})});$('#detailDialog').close();await loadListings();});
}
async function openNativePaymentAndWait(transactionId,kind){
  const opened=await phoneBridge('united:ifruit:openPay',{id:transactionId});if(!opened?.ok)return notice(t('pay_open_error',{error:opened?.error||'unknown'}));notice(t('pay_waiting'));
  for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,3000));const s=await fetch('/api/payments/'+encodeURIComponent(transactionId)+'/status').then(r=>r.json());if(s.status==='succeeded'){notice(kind==='boost'?t('boost_success'):t('publish_success'));$('#listingDialog').close();$('#detailDialog').close();await loadListings();return;}if(s.status==='failed')return notice(t('payment_failed'));if(s.status==='canceled')return notice(t('payment_canceled'));}
  notice(t('payment_pending'));
}
function notice(text){const n=$('#notice');n.textContent=text;n.classList.remove('hidden');clearTimeout(window.__noticeTimer);window.__noticeTimer=setTimeout(()=>n.classList.add('hidden'),7000);}

$('#sellBtn').addEventListener('click',()=>$('#listingDialog').showModal());
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
$('#pickPhotosBtn').addEventListener('click',async()=>{const r=await phoneBridge('united:phone:pickPhoto',{max:10});if(!r?.ok)return r?.cancelled?null:notice(r?.error||t('gallery_error'));const urls=r.urls||r.photos||(r.url?[r.url]:[]);state.photos=urls.filter(x=>typeof x==='string'&&x.startsWith('https://')).slice(0,10);$('#photoCount').textContent=state.photos.length+'/10';$('#photoPreview').innerHTML=state.photos.map(u=>'<img src="'+escapeHtml(u)+'" alt="">').join('');});
$('#listingForm').addEventListener('submit',async e=>{e.preventDefault();if(!state.photos.length)return notice(t('photo_required'));const fd=new FormData(e.currentTarget);const payload=Object.fromEntries(fd.entries());payload.sellerUsername=state.me;payload.price=Number(payload.price||0);payload.images=state.photos;const r=await fetch('/api/listings/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(r=>r.json());if(!r.transactionId)return notice(r.error||t('create_error'));await openNativePaymentAndWait(r.transactionId,'listing');});
$('#searchInput').addEventListener('input',()=>{clearTimeout(window.__q);window.__q=setTimeout(loadListings,250)});
document.querySelectorAll('.bottomnav button').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.bottomnav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.view=b.dataset.view;renderFeed();}));
boot().catch(err=>notice(err.message));
