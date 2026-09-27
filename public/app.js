const state = { listings: [], photos: [], me: null, config: null, view: 'feed' };

function phoneBridge(type, payload = {}) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    function onMessage(event) {
      const data = event.data;
      if (!data || data.requestId !== requestId) return;
      window.removeEventListener('message', onMessage);
      resolve(data);
    }
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type, requestId, ...payload }, '*');
  });
}

const $ = (s) => document.querySelector(s);
const money = (n) => `$${Number(n || 0).toLocaleString('pt-BR')}`;
const escapeHtml = (s='') => s.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function boot() {
  state.config = await fetch('/api/config').then(r => r.json());
  $('#listingFeeLabel').textContent = money(state.config.listingFee);
  try {
    const r = await phoneBridge('united:phone:getIfruitAccount');
    if (r?.ok && r.username) state.me = r.username;
  } catch {}
  if (!state.me) state.me = localStorage.getItem('dev_ifruit_username') || 'devuser';
  await loadListings();
}

async function loadListings() {
  const q = $('#searchInput').value.trim();
  const cat = $('#categoryFilter').value;
  const url = new URL('/api/listings', location.origin);
  if (q) url.searchParams.set('q', q);
  if (cat) url.searchParams.set('category', cat);
  state.listings = await fetch(url).then(r => r.json());
  renderFeed();
}

function renderFeed() {
  const feed = $('#feed');
  const rows = state.view === 'mine' ? state.listings.filter(x => x.seller_username === state.me) : state.listings;
  if (!rows.length) { feed.innerHTML = `<div class="empty">Nenhum anúncio encontrado.</div>`; return; }
  feed.innerHTML = rows.map(l => {
    const boosted = (l.boosted_until || 0) > Date.now();
    return `<article class="card ${boosted?'boosted':''}" data-id="${l.id}">
      <img src="${escapeHtml(l.images?.[0]||'')}" alt="" />
      <div class="card-body">
        <div class="meta"><span>${escapeHtml(l.category)}</span><span>${boosted?'IMPULSIONADO':''}</span></div>
        <div class="title-row"><h3>${escapeHtml(l.title)}</h3><div class="price">${money(l.price)}</div></div>
        <div class="badge">@${escapeHtml(l.seller_username)}</div>
      </div>
    </article>`;
  }).join('');
  feed.querySelectorAll('.card').forEach(el => el.addEventListener('click', () => openDetail(el.dataset.id)));
}

async function openDetail(id) {
  const l = await fetch(`/api/listings/${id}`).then(r => r.json());
  const boosted = (l.boosted_until || 0) > Date.now();
  const mine = l.seller_username === state.me;
  $('#detail').innerHTML = `
    <div class="sheet-head"><h2>${escapeHtml(l.title)}</h2><button class="ghost" onclick="document.getElementById('detailDialog').close()">Fechar</button></div>
    <img class="detail-hero" src="${escapeHtml(l.images?.[0]||'')}" alt="" />
    <div class="title-row" style="margin-top:14px"><div><div class="meta">${escapeHtml(l.category)}</div><h2>${money(l.price)}</h2></div>${boosted?'<span class="badge">Impulsionado</span>':''}</div>
    <p>${escapeHtml(l.description)}</p>
    <p class="hint">Vendedor: @${escapeHtml(l.seller_username)}${l.phone?` · ${escapeHtml(l.phone)}`:''}</p>
    ${!mine && l.phone ? `<div class="detail-actions"><button id="msgBtn" class="primary">Enviar mensagem</button><button id="contactBtn" class="secondary">Adicionar contato</button></div>` : ''}
    ${mine ? `<div class="boost-box"><strong>Impulsionar anúncio</strong><div class="hint">${money(state.config.boostFee)} para subir o anúncio por ${state.config.boostHours}h.</div><button id="boostBtn" class="primary full">Impulsionar por ${money(state.config.boostFee)}</button></div><div class="detail-actions"><button id="soldBtn" class="secondary">Marcar como vendido</button></div>`:''}
  `;
  $('#detailDialog').showModal();
  $('#msgBtn')?.addEventListener('click', () => phoneBridge('united:phone:openComposeMessage', { phone: l.phone }));
  $('#contactBtn')?.addEventListener('click', () => phoneBridge('united:phone:openNewContact', { phone: l.phone, name: l.seller_username }));
  $('#boostBtn')?.addEventListener('click', async () => {
    const r = await fetch(`/api/listings/${l.id}/boost`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ sellerUsername: state.me }) }).then(r=>r.json());
    if (!r.transactionId) return notice(r.error || 'Não foi possível iniciar o pagamento');
    await openNativePaymentAndWait(r.transactionId, 'boost');
  });
  $('#soldBtn')?.addEventListener('click', async () => {
    await fetch(`/api/listings/${l.id}/mark-sold`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ sellerUsername: state.me }) });
    $('#detailDialog').close(); await loadListings();
  });
}

async function openNativePaymentAndWait(transactionId, kind) {
  const opened = await phoneBridge('united:ifruit:openPay', { id: transactionId });
  if (!opened?.ok) return notice(`iFruit Pay não abriu: ${opened?.error || 'erro desconhecido'}`);
  notice('Pagamento aberto no iFruit Pay. Aguardando confirmação...');
  for (let i=0; i<40; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const s = await fetch(`/api/payments/${encodeURIComponent(transactionId)}/status`).then(r=>r.json());
    if (s.status === 'succeeded') {
      notice(kind === 'boost' ? 'Anúncio impulsionado com sucesso.' : 'Pagamento confirmado. Anúncio publicado.');
      $('#listingDialog').close(); $('#detailDialog').close(); await loadListings(); return;
    }
    if (['failed','canceled'].includes(s.status)) return notice(`Pagamento ${s.status === 'failed' ? 'falhou' : 'foi cancelado'}.`);
  }
  notice('Pagamento ainda pendente. Você pode fechar e conferir novamente em instantes.');
}

function notice(text){ const n=$('#notice'); n.textContent=text; n.classList.remove('hidden'); setTimeout(()=>n.classList.add('hidden'),7000); }

$('#sellBtn').addEventListener('click', () => $('#listingDialog').showModal());
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
$('#pickPhotosBtn').addEventListener('click', async () => {
  const r = await phoneBridge('united:phone:pickPhoto', { max: 10 });
  if (!r?.ok) return r?.cancelled ? null : notice(r?.error || 'Não foi possível abrir a galeria');
  const urls = r.urls || r.photos || (r.url ? [r.url] : []);
  state.photos = urls.filter(x => typeof x === 'string' && x.startsWith('https://')).slice(0,10);
  $('#photoCount').textContent = `${state.photos.length}/10`;
  $('#photoPreview').innerHTML = state.photos.map(u=>`<img src="${escapeHtml(u)}" alt="">`).join('');
});

$('#listingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.photos.length) return notice('Adicione pelo menos uma foto.');
  const fd = new FormData(e.currentTarget);
  const payload = Object.fromEntries(fd.entries());
  payload.sellerUsername = state.me;
  payload.price = Number(payload.price || 0);
  payload.images = state.photos;
  const r = await fetch('/api/listings/draft', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }).then(r=>r.json());
  if (!r.transactionId) return notice(r.error || 'Não foi possível criar o anúncio');
  await openNativePaymentAndWait(r.transactionId, 'listing');
});

$('#searchInput').addEventListener('input', () => { clearTimeout(window.__q); window.__q=setTimeout(loadListings,250); });
$('#categoryFilter').addEventListener('change', loadListings);
document.querySelectorAll('.bottomnav button').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.bottomnav button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); state.view=b.dataset.view; renderFeed();
}));

boot().catch(err => notice(err.message));
