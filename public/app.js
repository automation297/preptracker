// PrepTracker frontend

let CURRENT_USER = null;
let LANG = 'en';

const $ = id => document.getElementById(id);

const T = {
  en: {
    pinTitle:'Enter your PIN', pinSub:'6-digit code', pinWrong:'Wrong PIN. Try again.',
    atFranklins:"At Franklin's", inventorySub:'Current inventory', newDropoff:'+ Drop-off',
    history:'History', viewAll:'View all →', toProcess:'To Process', toProcessSub:'Log your progress below',
    saveDropoff:'Save Drop-off', dropoffDetail:'Drop-off Detail', settings:'Settings',
    logout:'Log out', inProgress:'In Progress', ready:'✅ Ready', pickedUp:'📦 Picked up',
    noInventory:'Nothing here yet.', confirmPickup:'Confirm Pickup',
    kgDone:'kg done so far', note:'Note (optional)', markReady:'Mark Ready',
    logProgress:'Log Progress', kg:'kg', of:'of', pinChange:'Change PIN',
    save:'Save', cancel:'Cancel',
  },
  pap: {
    pinTitle:'Pon bo PIN', pinSub:'6 sífra', pinWrong:'PIN robes. Purba di nuevo.',
    atFranklins:'Na Franklin su kas', inventorySub:'Inventario aktual', newDropoff:'+ Entrega',
    history:'Historial', viewAll:'Mira tur →', toProcess:'Pa Prepará', toProcessSub:'Log bo progreso aki',
    saveDropoff:'Salbá Entrega', dropoffDetail:'Detaye di Entrega', settings:'Konfigurasjon',
    logout:'Sali', inProgress:'Den Progreso', ready:'✅ Listu', pickedUp:'📦 Rekohí',
    noInventory:'Nada akí ainda.', confirmPickup:'Konfirmá Rekòhi',
    kgDone:'kg hasi asina leu', note:'Nota (opsional)', markReady:'Markrá Listu',
    logProgress:'Log Progreso', kg:'kg', of:'di', pinChange:'Kambia PIN',
    save:'Salbá', cancel:'Kansela',
  },
};

function t(key){ return T[LANG][key] || T.en[key] || key; }

function go(id){
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pg = $(id); if (pg) pg.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (id === 'new-dropoff') { supplyCount = 0; renderDropoffForm(); }
  if (id === 'dropoff-list') loadDropoffList();
  if (id === 'settings') loadSettings();
  if (id === 'prep-history') loadPrepHistory();
  if (id === 'purchases') {
    const back = $('purchasesBack');
    if (back) back.onclick = () => go(CURRENT_USER?.role === 'owner' ? 'owner-home' : 'prep-home');
    if (CURRENT_USER?.role === 'owner') { $('purchaseAddCard').style.display = ''; }
    else { $('purchaseAddCard').style.display = 'none'; }
    renderPurchaseItemDropdown();
    switchPurchaseTab('today');
  }
  if (id === 'stock') {
    const back = $('stockBack');
    if (back) back.onclick = () => go(CURRENT_USER?.role === 'owner' ? 'owner-home' : 'prep-home');
    loadStock();
  }
  if (id === 'seasoning') {
    $('seasonKg').value = '';
    $('seasonResults').style.display = 'none';
    if ($('portionCuts'))   $('portionCuts').style.display   = 'none';
    if ($('planNightCard')) $('planNightCard').style.display = 'none';
    if ($('planNightResult')) $('planNightResult').style.display = 'none';
    ['pPlan6','pPlan8','pPlan10','pPlan12'].forEach(id => { const el = $(id); if(el) el.value=''; });
    const back = $('seasoningBack');
    if (back) back.onclick = () => go(CURRENT_USER?.role === 'owner' ? 'owner-home' : 'prep-home');
  }
  if (id === 'portions') {
    $('portionKg').value = '';
    $('portionResults').style.display = 'none';
    ['pPlanS','pPlanM','pPlanL','pPlanW','pPlanB'].forEach(id => { const el = $(id); if(el) el.value = ''; });
    $('planResult').style.display = 'none';
    const back = $('portionsBack');
    if (back) back.onclick = () => go(CURRENT_USER?.role === 'owner' ? 'owner-home' : 'prep-home');
  }
}

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'same-origin',
    ...opts,
  });
  let data = {};
  try { data = await r.json(); } catch(e) {}
  if (!r.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function toast(msg) {
  const el = $('toast'); el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

function esc(s){ return String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function fmtKg(n){ return Number(n).toFixed(1) + ' kg'; }
function statusBadge(s){
  if (s==='in_progress') return `<span class="badge badge-progress">${t('inProgress')}</span>`;
  if (s==='ready')       return `<span class="badge badge-ready">${t('ready')}</span>`;
  if (s==='picked_up')   return `<span class="badge badge-picked">${t('pickedUp')}</span>`;
  return '';
}
function fmtDate(d){ return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }

// ---------- PIN entry ----------
let PIN = '';

function updateDots() {
  for (let i = 0; i < 6; i++) {
    $('d'+i).classList.toggle('filled', i < PIN.length);
  }
}

function pinKey(digit) {
  if (PIN.length >= 6) return;
  PIN += digit;
  updateDots();
  $('pinError').textContent = '';
  if (PIN.length === 6) submitPin();
}

function pinBack() {
  PIN = PIN.slice(0, -1);
  updateDots();
}

async function submitPin() {
  try {
    const res = await api('/auth/login', { method: 'POST', body: JSON.stringify({ pin: PIN }) });
    CURRENT_USER = res.user;
    PIN = '';
    updateDots();
    afterLogin();
  } catch (e) {
    $('pinError').textContent = t('pinWrong');
    PIN = '';
    updateDots();
  }
}

async function afterLogin() {
  if ($('navUserName')) $('navUserName').textContent = CURRENT_USER.name;
  if ($('prepUserName')) $('prepUserName').textContent = CURRENT_USER.name;
  // Register push after login
  try {
    const { key } = await api('/vapid-key');
    if (key && $('vapidKey')) $('vapidKey').dataset.key = key;
    registerPush();
  } catch(e) {}
  if (CURRENT_USER.role === 'owner') { go('owner-home'); loadOwnerHome(); }
  else { go('prep-home'); loadPrepHome(); }
}

async function doLogout() {
  await api('/auth/logout', { method: 'POST' });
  CURRENT_USER = null;
  PIN = ''; updateDots();
  go('pin');
}

// ---------- boot ----------
(async function(){
  try {
    const res = await api('/auth/me');
    if (res.user) { CURRENT_USER = res.user; afterLogin(); }
    else go('pin');
  } catch(e) { go('pin'); }
})();

// ---------- OWNER: inventory dashboard ----------
async function loadOwnerHome() {
  $('navUserName').textContent = CURRENT_USER.name;
  try {
    const inv = await api('/inventory');
    renderOwnerInventory(inv);
  } catch(e) { $('ownerInventory').innerHTML = `<div class="empty"><h3>${t('noInventory')}</h3></div>`; }
  try {
    const dl = await api('/dropoffs');
    $('ownerRecentList').innerHTML = dl.dropoffs.slice(0,3).map(dropoffCard).join('') ||
      `<div class="empty"><h3>${t('noInventory')}</h3></div>`;
  } catch(e) {}
}

function renderOwnerInventory(inv) {
  const el = $('ownerInventory');
  if (!inv.proteins.length && !inv.supplies.length) {
    el.innerHTML = `<div class="empty"><h3>${t('noInventory')}</h3><p>Drop something off to get started.</p></div>`;
    return;
  }
  // Group proteins by status
  const ready = inv.proteins.filter(p => p.status === 'ready');
  const inProg = inv.proteins.filter(p => p.status === 'in_progress');

  let html = '';
  if (ready.length) {
    html += `<div class="card" style="border-left:4px solid var(--green)">
      <div style="font-weight:800;margin-bottom:12px;color:var(--green)">✅ ${t('ready')}</div>`;
    html += ready.map(p => proteinRowHtml(p)).join('');
    html += `<button class="btn btn-coral" style="width:100%;justify-content:center;margin-top:16px" onclick="openDropoff(${ready[0].dropoff_id})">${t('confirmPickup')} →</button>`;
    html += '</div>';
  }
  if (inProg.length) {
    html += `<div class="card">
      <div style="font-weight:800;margin-bottom:12px;color:var(--mango)">🟡 ${t('inProgress')}</div>`;
    html += inProg.map(p => proteinRowHtml(p)).join('');
    html += '</div>';
  }
  if (inv.supplies.length) {
    html += `<div class="card"><div style="font-weight:800;margin-bottom:12px">📦 Supplies</div>`;
    html += inv.supplies.map(s => `<div class="protein-row"><span class="protein-name">${esc(s.name)}</span><span class="protein-weight">${esc(s.amount)}</span></div>`).join('');
    html += '</div>';
  }
  el.innerHTML = html;
}

function proteinRowHtml(p) {
  const kg = parseFloat(p.latest_kg_done);
  const total = parseFloat(p.weight_kg);
  return `<div class="protein-row">
    <div>
      <div class="protein-name">${esc(p.protein_name)}</div>
      <div class="protein-weight">${fmtKg(kg)} ${t('of')} ${fmtKg(total)}</div>
      ${p.latest_note ? `<div class="protein-note">"${esc(p.latest_note)}"</div>` : ''}
    </div>
    ${statusBadge(p.status)}
  </div>`;
}

function dropoffCard(d) {
  const allReady = Number(d.ready_count) === Number(d.protein_count);
  const badge = d.status === 'picked_up' ? statusBadge('picked_up') :
    allReady ? statusBadge('ready') : statusBadge('in_progress');
  return `<div class="card" style="cursor:pointer" onclick="openDropoff(${d.id})">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-weight:700">${fmtDate(d.dropped_at)}</div>
        <div style="font-size:13px;color:var(--dim)">${d.protein_count} proteins · by ${esc(d.dropped_by)}</div>
      </div>
      ${badge}
    </div>
  </div>`;
}

// ---------- OWNER: drop-off list ----------
async function loadDropoffList() {
  try {
    const dl = await api('/dropoffs');
    $('dropoffList').innerHTML = dl.dropoffs.map(dropoffCard).join('') ||
      `<div class="empty"><h3>${t('noInventory')}</h3></div>`;
  } catch(e) { toast(e.message); }
}

// ---------- OWNER: drop-off detail ----------
let CURRENT_DROPOFF_ID = null;
async function openDropoff(id) {
  CURRENT_DROPOFF_ID = id;
  go('dropoff-detail');
  try {
    const { dropoff: d } = await api('/dropoffs/' + id);
    const allReady = d.proteins.length > 0 && d.proteins.every(p => p.status === 'ready');
    let html = `<div style="margin-bottom:16px">
      <div style="font-size:14px;color:var(--dim)">${fmtDate(d.dropped_at)}</div>
      ${d.notes ? `<div style="margin-top:6px;font-style:italic;color:var(--dim)">${esc(d.notes)}</div>` : ''}
    </div>`;
    html += d.proteins.map(p => `
      <div class="card" style="padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div class="protein-name">${esc(p.protein_name)}</div>
            <div class="protein-weight">${fmtKg(p.latest_kg_done)} ${t('of')} ${fmtKg(p.weight_kg)}</div>
            ${p.latest_note ? `<div class="protein-note">"${esc(p.latest_note)}"</div>` : ''}
          </div>
          ${statusBadge(p.status)}
        </div>
      </div>`).join('');
    if (d.supplies.length) {
      html += `<div class="card"><div style="font-weight:700;margin-bottom:10px">Supplies</div>`;
      html += d.supplies.map(s => `<div class="protein-row"><span>${esc(s.name)}</span><span>${esc(s.amount)}</span></div>`).join('');
      html += '</div>';
    }
    if (d.status === 'open' && allReady) {
      html += `<button class="btn btn-coral" style="width:100%;justify-content:center;margin-top:16px" onclick="confirmPickup(${d.id})">${t('confirmPickup')}</button>`;
    }
    $('dropoffDetail').innerHTML = html;
  } catch(e) { toast(e.message); }
}

async function confirmPickup(id) {
  if (!confirm('Confirm pickup of this drop-off?')) return;
  try {
    await api('/dropoffs/' + id + '/pickup', { method: 'POST' });
    toast('Pickup confirmed!');
    go('owner-home');
    loadOwnerHome();
  } catch(e) { toast(e.message); }
}

// ---------- OWNER: new drop-off form ----------
const PROTEINS = ['Flank Steak','Chicken Breast','Chicken Wings','Chicharron / Pork Belly','Burger Meat / Carni Mula','Bacon'];

function renderDropoffForm() {
  let html = '<div class="card">';
  html += '<div style="font-weight:800;margin-bottom:16px">Proteins (kg)</div>';
  html += PROTEINS.map(name => `
    <div class="field">
      <label>${esc(name)}</label>
      <input type="number" step="0.1" min="0" id="p_${esc(name.replace(/[^a-z]/gi,'_'))}" placeholder="e.g. 25.5">
    </div>`).join('');
  html += '</div>';
  html += '<div class="card" style="margin-top:0"><div style="font-weight:800;margin-bottom:16px">Supplies</div>';
  html += '<div id="suppliesRows"></div>';
  html += `<button class="btn btn-ghost btn-sm" onclick="addSupplyRow()">+ Add supply</button>`;
  html += '</div>';
  html += '<div class="field" style="margin-top:12px"><label>Notes (optional)</label><textarea id="dropoffNotes" rows="2"></textarea></div>';
  $('dropoffForm').innerHTML = html;
  addSupplyRow();
}

let supplyCount = 0;
function addSupplyRow() {
  supplyCount++;
  const div = document.createElement('div');
  div.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-bottom:10px';
  div.id = 'sup_' + supplyCount;
  div.innerHTML = `
    <input type="text" placeholder="Name (e.g. Salt)" id="sname_${supplyCount}">
    <input type="text" placeholder="Amount (e.g. 500g)" id="samt_${supplyCount}">
    <button class="btn btn-ghost btn-sm" onclick="document.getElementById('sup_${supplyCount}').remove()">✕</button>`;
  $('suppliesRows').appendChild(div);
}

async function submitDropoff() {
  const proteins = PROTEINS
    .map(name => ({ protein_name: name, weight_kg: parseFloat(document.getElementById('p_'+name.replace(/[^a-z]/gi,'_'))?.value||0)||0 }))
    .filter(p => p.weight_kg > 0);
  if (!proteins.length) { toast('Add at least one protein weight.'); return; }

  const supplies = [];
  for (let i = 1; i <= supplyCount; i++) {
    const n = document.getElementById('sname_'+i), a = document.getElementById('samt_'+i);
    if (n && a && n.value.trim() && a.value.trim()) supplies.push({ name: n.value.trim(), amount: a.value.trim() });
  }
  const notes = $('dropoffNotes')?.value.trim();
  try {
    await api('/dropoffs', { method: 'POST', body: JSON.stringify({ proteins, supplies, notes }) });
    toast('Drop-off saved!');
    go('owner-home');
    loadOwnerHome();
    supplyCount = 0;
  } catch(e) { toast(e.message); }
}

// ---------- OWNER: settings (change PINs) ----------
async function loadSettings() {
  $('settingsContent').innerHTML = `
    <div class="card">
      <div style="font-weight:800;margin-bottom:16px">${t('pinChange')}</div>
      <div class="field"><label>User ID (1=Owner, 2=Franklin, 3=Mama Franklin)</label>
        <input type="number" id="pinUserId" min="1" max="3" placeholder="e.g. 2"></div>
      <div class="field"><label>New PIN (6 digits)</label>
        <input type="text" id="newPinVal" maxlength="6" placeholder="••••••" inputmode="numeric"></div>
      <button class="btn btn-primary" style="width:100%" onclick="changePin()">${t('save')}</button>
    </div>`;
}

async function changePin() {
  const userId = $('pinUserId').value;
  const pin = $('newPinVal').value.trim();
  if (!/^\d{6}$/.test(pin)) { toast('PIN must be exactly 6 digits.'); return; }
  try {
    await api('/auth/pin/'+userId, { method: 'PATCH', body: JSON.stringify({ pin }) });
    toast('PIN updated!');
    $('newPinVal').value = '';
    $('pinUserId').value = '';
  } catch(e) { toast(e.message); }
}

// ---------- PREP: home dashboard ----------
async function loadPrepHome() {
  $('prepUserName').textContent = CURRENT_USER.name;
  try {
    const inv = await api('/inventory');
    const el = $('prepInventory');
    if (!inv.proteins.length && !inv.supplies.length) {
      el.innerHTML = `<div class="empty"><h3>${t('noInventory')}</h3><p>Nothing to process right now.</p></div>`;
      return;
    }
    let html = '';
    inv.proteins.forEach(p => {
      const kg = parseFloat(p.latest_kg_done);
      const total = parseFloat(p.weight_kg);
      const pct = total > 0 ? Math.min(100, Math.round((kg / total) * 100)) : 0;
      html += `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div>
            <div class="protein-name">${esc(p.protein_name)}</div>
            <div class="protein-weight">${fmtKg(kg)} ${t('of')} ${fmtKg(total)}</div>
            ${p.latest_note ? `<div class="protein-note">"${esc(p.latest_note)}"</div>` : ''}
          </div>
          ${statusBadge(p.status)}
        </div>
        <div style="background:var(--line);border-radius:99px;height:8px;margin-bottom:14px">
          <div style="background:var(--sea);height:8px;border-radius:99px;width:${pct}%;transition:.3s"></div>
        </div>
        ${p.status === 'in_progress' ? `
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" style="flex:1" data-pid="${Number(p.id)}" data-pname="${esc(p.protein_name)}" data-pweight="${Number(p.weight_kg)}" onclick="handleLogProgress(this)">${t('logProgress')}</button>
            <button class="btn btn-ghost btn-sm" onclick="markReady(${p.id})">${t('markReady')}</button>
          </div>` : ''}
      </div>`;
    });
    if (inv.supplies.length) {
      html += `<div class="card"><div style="font-weight:700;margin-bottom:10px">📦 Supplies available</div>`;
      html += inv.supplies.map(s => `<div class="protein-row"><span>${esc(s.name)}</span><span>${esc(s.amount)}</span></div>`).join('');
      html += '</div>';
    }
    el.innerHTML = html;
  } catch(e) { toast(e.message); }
}

// ---------- PREP: log progress ----------
let LOG_PROTEIN_ID = null;

function openLogProgress(id, name, weightKg) {
  LOG_PROTEIN_ID = id;
  $('logProgressTitle').textContent = name;
  $('logProgressForm').innerHTML = `
    <div class="card">
      <div style="font-weight:800;margin-bottom:4px">${esc(name)}</div>
      <div style="color:var(--dim);font-size:14px;margin-bottom:20px">Total: ${fmtKg(weightKg)}</div>
      <div class="field">
        <label>${t('kgDone')}</label>
        <input type="number" id="lgKg" step="0.1" min="0" max="${weightKg}" placeholder="e.g. 45.5" style="font-size:20px;font-weight:700">
      </div>
      <div class="field">
        <label>${t('note')}</label>
        <textarea id="lgNote" rows="2" placeholder="e.g. Marinating overnight"></textarea>
      </div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;font-size:16px;height:52px" onclick="submitProgress()">${t('save')}</button>
    </div>`;
  go('log-progress');
}

async function submitProgress() {
  const kg = parseFloat($('lgKg').value);
  if (isNaN(kg) || kg < 0) { toast('Enter a valid weight.'); return; }
  const note = $('lgNote').value.trim();
  try {
    await api('/proteins/' + LOG_PROTEIN_ID + '/log', { method: 'POST', body: JSON.stringify({ kg_done: kg, note }) });
    toast('Progress saved!');
    go('prep-home');
    loadPrepHome();
  } catch(e) { toast(e.message); }
}

async function markReady(id) {
  if (!confirm('Mark this protein as ready for pickup?')) return;
  try {
    await api('/proteins/' + id + '/ready', { method: 'PATCH' });
    toast('Marked ready!');
    loadPrepHome();
  } catch(e) { toast(e.message); }
}

function handleLogProgress(el) {
  openLogProgress(Number(el.dataset.pid), el.dataset.pname, Number(el.dataset.pweight));
}

// ---------- PREP: history ----------
async function loadPrepHistory() {
  const el = $('prepHistoryList');
  el.innerHTML = '<div class="empty"><p>Loading…</p></div>';
  try {
    const { dropoffs } = await api('/dropoffs');
    const done = dropoffs.filter(d => d.status === 'picked_up');
    if (!done.length) {
      el.innerHTML = `<div class="empty"><h3>${t('noInventory')}</h3><p>No completed batches yet.</p></div>`;
      return;
    }
    el.innerHTML = done.map(d => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div style="font-weight:700">${fmtDate(d.dropped_at)}</div>
            <div style="font-size:13px;color:var(--dim)">${d.protein_count} protein${Number(d.protein_count) !== 1 ? 's' : ''}</div>
            ${d.picked_up_at ? `<div style="font-size:12px;color:var(--dim);margin-top:2px">Picked up ${fmtDate(d.picked_up_at)}</div>` : ''}
          </div>
          <span class="badge badge-picked">${t('pickedUp')}</span>
        </div>
      </div>`).join('');
  } catch(e) { el.innerHTML = `<div class="empty"><p>${e.message}</p></div>`; }
}

// ---------- PUSH NOTIFICATIONS ----------

async function registerPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
    const existing = await reg.pushManager.getSubscription();
    const sub = existing || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(document.getElementById('vapidKey')?.dataset?.key || ''),
    });
    await api('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub }) });
  } catch(e) { console.log('push setup:', e.message); }
}

// ---------- PORTION CALCULATOR ----------

// Suggested split percentages across all menu items (by protein weight)
const AUTO_SPLIT = [
  // Single portions
  { group:'basket', label:'Basket Small',   sub:'6 oz each',  g:170, pct:0.08 },
  { group:'basket', label:'Basket Medium',  sub:'10 oz each', g:283, pct:0.22 },
  { group:'basket', label:'Basket Large',   sub:'12 oz each', g:340, pct:0.13 },
  // Wraps
  { group:'wrap',   label:'Burrito',        sub:'8 oz each',  g:227, pct:0.10 },
  { group:'wrap',   label:'Quesadilla',     sub:'8 oz each',  g:227, pct:0.06 },
  { group:'wrap',   label:'Sandwich',       sub:'8 oz each',  g:227, pct:0.04 },
  // Burger
  { group:'burger', label:'Burger',         sub:'6 oz each',  g:170, pct:0.05 },
  // Mix baskets — protein contribution per order
  { group:'mix', label:'Mix Small  (2-protein S = 3oz ea · 3-protein S = 2oz ea)', sub:'avg 2 oz per order', g:57,  pct:0.05 },
  { group:'mix', label:'Mix Medium (2-protein M = 5oz ea · 3-protein M = 3oz ea · 4-protein M = 2.5oz ea)', sub:'avg 3 oz per order', g:85,  pct:0.18 },
  { group:'mix', label:'Mix Large  (2-protein L = 6oz ea · 3-protein L = 4oz ea · 4-protein L = 3oz ea)',  sub:'avg 4 oz per order', g:113, pct:0.09 },
];

function portionRow(label, sub, count, isLast) {
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;${isLast?'':'border-bottom:1px solid var(--line)'}">
    <div><div style="font-weight:600;font-size:14px">${label}</div><div style="font-size:12px;color:var(--dim)">${sub}</div></div>
    <div style="font-weight:800;font-size:24px;color:var(--sea-deep);min-width:50px;text-align:right">${count}</div>
  </div>`;
}

function calcPortions() {
  const kg = parseFloat($('portionKg').value) || 0;
  if (kg <= 0) { $('portionResults').style.display = 'none'; return; }
  const grams = kg * 1000;

  const basket = AUTO_SPLIT.filter(r => r.group === 'basket');
  const wrap   = AUTO_SPLIT.filter(r => r.group === 'wrap');
  const burger = AUTO_SPLIT.filter(r => r.group === 'burger');
  const mix    = AUTO_SPLIT.filter(r => r.group === 'mix');

  function renderGroup(items) {
    return items.map((r, i) => {
      const count = Math.floor(grams * r.pct / r.g);
      const kgUsed = (grams * r.pct / 1000).toFixed(1);
      return portionRow(r.label, r.sub + ' · ' + kgUsed + ' kg', count, i === items.length - 1);
    }).join('');
  }

  $('rowsBasket').innerHTML = renderGroup(basket);
  $('rowsWrap').innerHTML   = renderGroup(wrap);
  $('rowsBurger').innerHTML = renderGroup(burger);
  $('rowsMix').innerHTML    = renderGroup(mix);
  $('portionResults').style.display = 'block';
}

function calcPlan() {
  const s    = parseInt($('pPlanS').value)    || 0;
  const m    = parseInt($('pPlanM').value)    || 0;
  const l    = parseInt($('pPlanL').value)    || 0;
  const w    = parseInt($('pPlanW').value)    || 0;
  const b    = parseInt($('pPlanB').value)    || 0;
  const mxS  = parseInt($('pPlanMixS').value) || 0;
  const mxM  = parseInt($('pPlanMixM').value) || 0;
  const mxL  = parseInt($('pPlanMixL').value) || 0;
  const total = s + m + l + w + b + mxS + mxM + mxL;
  if (total === 0) { $('planResult').style.display = 'none'; return; }
  const totalG = (s*170) + (m*283) + (l*340) + (w*227) + (b*170) + (mxS*57) + (mxM*85) + (mxL*113);
  const totalKg = (totalG / 1000).toFixed(2);
  $('planKg').textContent = totalKg + ' kg';
  const parts = [];
  if (s)   parts.push(s   + ' Basket S');
  if (m)   parts.push(m   + ' Basket M');
  if (l)   parts.push(l   + ' Basket L');
  if (w)   parts.push(w   + ' Wrap');
  if (b)   parts.push(b   + ' Burger');
  if (mxS) parts.push(mxS + ' Mix S');
  if (mxM) parts.push(mxM + ' Mix M');
  if (mxL) parts.push(mxL + ' Mix L');
  $('planPortions').textContent = parts.join(' · ') + ' = ' + total + ' total';
  $('planResult').style.display = 'block';
}

// ---------- SEASONING + PORTIONS CALCULATOR (combined) ----------

// Bag cut groups — the only sizes prep needs to cut
// pct = share of the kg going into this bag size
const BAG_CUTS = [
  { oz:  6, g: 170, pct: 0.45, label: 'Basket Small · Burger · Mix stock',       color: 'var(--sea-deep)' },
  { oz:  8, g: 227, pct: 0.20, label: 'Wraps (Burrito · Quesadilla · Sandwich)', color: '#e67e22' },
  { oz: 10, g: 283, pct: 0.22, label: 'Basket Medium',                            color: '#FFAA00' },
  { oz: 12, g: 340, pct: 0.13, label: 'Basket Large',                             color: 'var(--coral)' },
];

function calcSeasoning() {
  const kg = parseFloat($('seasonKg').value) || 0;
  if (kg <= 0) {
    $('seasonResults').style.display = 'none';
    if ($('portionCuts'))   $('portionCuts').style.display   = 'none';
    if ($('planNightCard')) $('planNightCard').style.display = 'none';
    return;
  }

  // Seasoning amounts
  const compleet = kg * 0.25;
  const badia    = kg * 0.25;
  const chicken  = kg * 0.25;
  const paprika  = kg * 0.125;
  const maggi    = kg * 0.25;
  const oil      = compleet + badia + chicken + paprika;
  $('sCompleet').textContent = compleet.toFixed(2) + ' oz';
  $('sBadia').textContent    = badia.toFixed(2)    + ' oz';
  $('sChicken').textContent  = chicken.toFixed(2)  + ' oz';
  $('sPaprika').textContent  = paprika.toFixed(2)  + ' oz';
  $('sMaggi').textContent    = maggi.toFixed(2)    + ' oz';
  $('sOil').textContent      = oil.toFixed(2)      + ' oz';
  $('seasonResults').style.display = 'block';

  // Bag cut breakdown
  const grams = kg * 1000;
  const rows = BAG_CUTS.map((cut, i) => {
    const count = Math.floor(grams * cut.pct / cut.g);
    const kgUsed = (grams * cut.pct / 1000).toFixed(1);
    const isLast = i === BAG_CUTS.length - 1;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:13px 0;${isLast?'':'border-bottom:1px solid var(--line)'}">
      <div>
        <div style="font-weight:700;font-size:15px">${cut.oz}oz bags</div>
        <div style="font-size:12px;color:var(--dim);margin-top:2px">${cut.label} · ${kgUsed} kg</div>
      </div>
      <div style="font-weight:800;font-size:28px;color:${cut.color};min-width:60px;text-align:right">${count}</div>
    </div>`;
  });
  $('portionCutRows').innerHTML = rows.join('');
  $('portionCuts').style.display = 'block';
  $('planNightCard').style.display = 'block';
}

function calcPlanNight() {
  const b6  = parseInt($('pPlan6').value)  || 0;
  const b8  = parseInt($('pPlan8').value)  || 0;
  const b10 = parseInt($('pPlan10').value) || 0;
  const b12 = parseInt($('pPlan12').value) || 0;
  const total = b6 + b8 + b10 + b12;
  if (!total) { $('planNightResult').style.display = 'none'; return; }
  const grams = (b6*170) + (b8*227) + (b10*283) + (b12*340);
  const kg = (grams/1000).toFixed(2);
  $('planNightKg').textContent = kg + ' kg';
  const parts = [];
  if (b6)  parts.push(b6  + ' × 6oz');
  if (b8)  parts.push(b8  + ' × 8oz');
  if (b10) parts.push(b10 + ' × 10oz');
  if (b12) parts.push(b12 + ' × 12oz');
  $('planNightBreak').textContent = parts.join(' · ');
  $('planNightResult').style.display = 'block';
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ============================================================
// PURCHASES TRACKER
// ============================================================

const PURCHASE_ITEMS = [
  // Proteins
  { name:'Flank Steak',              category:'protein',    unit:'kg' },
  { name:'Chicken Breast',           category:'protein',    unit:'kg' },
  { name:'Chicken Wings',            category:'protein',    unit:'kg' },
  { name:'Burger Meat / Carni Mula', category:'protein',    unit:'kg' },
  { name:'Chicharron / Pork Belly',  category:'protein',    unit:'kg' },
  { name:'Bacon',                    category:'protein',    unit:'kg' },
  { name:'Hotdog / Salchicha',       category:'protein',    unit:'pieces', pack:10, packLabel:'packs of 10' },
  // Bread
  { name:'12" Tortilla',             category:'bread',      unit:'pieces', pack:12, packLabel:'packs of 12' },
  { name:'Burger Bun',               category:'bread',      unit:'pieces', pack:8,  packLabel:'packs of 8' },
  // Dairy / Cheese
  { name:'Mozzarella Cheese',        category:'dairy',      unit:'kg', pack:2, packLabel:'2kg blocks' },
  // Sides
  { name:'Fries',                    category:'sides',      unit:'kg', pack:2.5, packLabel:'sacks of 2.5kg' },
  // Drinks
  { name:'Soda / Refresco',          category:'drinks',     unit:'pieces', pack:12, packLabel:'packs of 12' },
  { name:'Water / Awa',              category:'drinks',     unit:'pieces', pack:24, packLabel:'packs of 24' },
  { name:'Energy Drink',             category:'drinks',     unit:'pieces', pack:24, packLabel:'packs of 24' },
  // Sauces
  { name:'Garlic Sauce',             category:'sauce',      unit:'bottles' },
  { name:'Rosada Sauce',             category:'sauce',      unit:'bottles' },
  { name:'Pinda Sauce',              category:'sauce',      unit:'bottles' },
  // Condiments
  { name:'Ketchup',                  category:'condiment',  unit:'cans' },
  { name:'Mayonnaise',               category:'condiment',  unit:'bottles' },
  { name:'Oil',                      category:'condiment',  unit:'L' },
  { name:'Salt',                     category:'condiment',  unit:'kg' },
  // Veggies
  { name:'Lettuce',                  category:'veggies',    unit:'kg' },
  { name:'Tomato',                   category:'veggies',    unit:'kg' },
  { name:'Onion',                    category:'veggies',    unit:'kg' },
  { name:'Avocado / Palta',          category:'veggies',    unit:'pieces' },
  { name:'Corn',                     category:'veggies',    unit:'cans' },
  { name:'Jalapeño',                 category:'veggies',    unit:'cans' },
  { name:'Custom / Other',           category:'other',      unit:'' },
];

const CAT_COLOR = {
  protein:'#FF4D2E', bread:'#FFAA00', dairy:'#9b59b6', sides:'#27ae60',
  drinks:'#3498db', sauce:'#e67e22', condiment:'#7f8c8d', veggies:'#2ecc71', other:'#95a5a6',
};

function renderPurchaseItemDropdown() {
  const sel = $('pItem');
  if (!sel || sel.querySelector('option[value="Flank Steak"]')) return;
  const byCategory = {};
  PURCHASE_ITEMS.forEach(it => {
    if (!byCategory[it.category]) byCategory[it.category] = [];
    byCategory[it.category].push(it);
  });
  let html = '<option value="">— choose item —</option>';
  Object.keys(byCategory).forEach(cat => {
    html += `<optgroup label="${cat.charAt(0).toUpperCase()+cat.slice(1)}">`;
    byCategory[cat].forEach(it => { html += `<option value="${esc(it.name)}">${esc(it.name)}</option>`; });
    html += '</optgroup>';
  });
  sel.innerHTML = html;
}

function onPurchaseItemChange() {
  const val = $('pItem').value;
  const item = PURCHASE_ITEMS.find(i => i.name === val);
  const customWrap = $('pCustomNameWrap');
  if (val === 'Custom / Other') {
    customWrap.style.display = '';
    $('pUnit').value = '';
  } else {
    customWrap.style.display = 'none';
    if (item) $('pUnit').value = item.unit;
  }
  updatePurchasePreview();
}

function updatePurchasePreview() {
  const val = $('pItem').value;
  const item = PURCHASE_ITEMS.find(i => i.name === val);
  const qty = parseFloat($('pQty').value) || 0;
  const preview = $('pPackPreview');
  if (!preview) return;
  if (item && item.pack && qty > 0) {
    const total = qty * item.pack;
    preview.style.display = '';
    preview.innerHTML = `<div style="font-size:13px;color:var(--sea-deep);font-weight:600;background:rgba(10,140,154,.08);padding:10px 12px;border-radius:10px">
      ${qty} ${item.packLabel} = <strong>${total} ${item.unit}</strong> total &nbsp;·&nbsp; ${qty} is how many packs you bought
    </div>`;
  } else {
    preview.style.display = 'none';
  }
}

let PURCHASE_TAB = 'today';

async function switchPurchaseTab(range) {
  PURCHASE_TAB = range;
  ['Today','Week','Month'].forEach(t => {
    const btn = $('tab'+t);
    if (btn) btn.className = 'btn btn-sm' + (range === t.toLowerCase() ? ' btn-primary' : ' btn-ghost');
  });
  await loadPurchases(range);
}

async function loadPurchases(range) {
  const el = $('purchaseList');
  el.innerHTML = '<div class="empty"><p>Loading…</p></div>';
  try {
    const data = await api('/purchases?range=' + range);
    if (!data.purchases.length) {
      el.innerHTML = '<div class="empty"><h3>No purchases yet</h3><p>Log your first purchase above.</p></div>';
      return;
    }
    const total = parseFloat(data.total);
    let html = `<div class="card" style="margin-bottom:8px;background:linear-gradient(135deg,var(--sea-deep),var(--sea));color:#fff">
      <div style="font-size:13px;opacity:.8;margin-bottom:4px">Total spent ${range === 'today' ? 'today' : range === 'week' ? 'this week' : 'this month'}</div>
      <div style="font-size:32px;font-weight:800">FL ${total.toFixed(2)}</div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">`;
    Object.entries(data.byCategory).sort((a,b) => b[1]-a[1]).forEach(([cat, amt]) => {
      const pct = Math.round((amt/total)*100);
      html += `<span style="background:rgba(255,255,255,.2);padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700">${cat} FL ${Number(amt).toFixed(0)} (${pct}%)</span>`;
    });
    html += '</div></div>';

    // Group by date
    const byDate = {};
    data.purchases.forEach(p => {
      const d = p.bought_at.split('T')[0];
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(p);
    });
    Object.entries(byDate).forEach(([date, items]) => {
      const dayTotal = items.reduce((s,i) => s+parseFloat(i.price_fl), 0);
      const label = date === new Date().toISOString().split('T')[0] ? 'Today' : new Date(date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
      html += `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="font-weight:800">${label}</div>
          <div style="font-size:13px;color:var(--dim)">FL ${dayTotal.toFixed(2)}</div>
        </div>`;
      items.forEach((p,i) => {
        const isLast = i === items.length-1;
        const unitCost = (parseFloat(p.price_fl)/parseFloat(p.qty)).toFixed(2);
        html += `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;${isLast?'':'border-bottom:1px solid var(--line)'}">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="width:8px;height:8px;border-radius:50%;background:${CAT_COLOR[p.category]||'#95a5a6'};flex-shrink:0;display:inline-block"></span>
              <span style="font-weight:600;font-size:14px">${esc(p.item_name)}</span>
            </div>
            <div style="font-size:12px;color:var(--dim);margin-top:3px;padding-left:16px">${esc(p.qty)} ${esc(p.unit)} · FL ${unitCost}/${esc(p.unit.replace(/s$/,''))}${p.notes ? ' · ' + esc(p.notes) : ''}</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-weight:800;white-space:nowrap">FL ${parseFloat(p.price_fl).toFixed(2)}</span>
            ${CURRENT_USER?.role==='owner' ? `<button onclick="deletePurchase(${p.id})" style="border:none;background:none;color:var(--dim);cursor:pointer;font-size:16px;padding:2px">✕</button>` : ''}
          </div>
        </div>`;
      });
      html += '</div>';
    });
    el.innerHTML = html;
  } catch (e) { el.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; }
}

async function submitPurchase() {
  const sel = $('pItem').value;
  const item = PURCHASE_ITEMS.find(i => i.name === sel);
  const item_name = sel === 'Custom / Other' ? $('pCustomName').value.trim() : sel;
  const category = item ? item.category : 'other';
  const price_fl = parseFloat($('pPrice').value);
  const qty = parseFloat($('pQty').value);
  const unit = $('pUnit').value.trim();
  const notes = $('pNote').value.trim();

  if (!item_name) { toast('Choose or enter an item name.'); return; }
  if (!price_fl || price_fl <= 0) { toast('Enter the price you paid.'); return; }
  if (!qty || qty <= 0) { toast('Enter the quantity.'); return; }
  if (!unit) { toast('Enter the unit (kg, pieces, etc.).'); return; }

  // If it's a pack item, auto-generate note
  const packNote = (item && item.pack && !notes)
    ? `${qty} ${item.packLabel} = ${qty*item.pack} ${item.unit}`
    : notes;

  try {
    await api('/purchases', { method:'POST', body: JSON.stringify({ item_name, category, price_fl, qty, unit, notes: packNote }) });
    toast('Purchase saved!');
    $('pItem').value = '';
    $('pPrice').value = '';
    $('pQty').value = '';
    $('pUnit').value = '';
    $('pNote').value = '';
    $('pCustomName').value = '';
    $('pCustomNameWrap').style.display = 'none';
    if ($('pPackPreview')) $('pPackPreview').style.display = 'none';
    await loadPurchases(PURCHASE_TAB);
  } catch (e) { toast(e.message); }
}

async function deletePurchase(id) {
  if (!confirm('Delete this purchase?')) return;
  try {
    await api('/purchases/' + id, { method:'DELETE' });
    toast('Deleted.');
    await loadPurchases(PURCHASE_TAB);
  } catch (e) { toast(e.message); }
}

// ============================================================
// STOCK / KITCHEN COUNTDOWN
// ============================================================

// Items in the stock setup form (non-protein)
const STOCK_OTHER = [
  { key:'tortilla',  label:'12" Tortilla',       unit:'pieces', icon:'📄' },
  { key:'burger_bun',label:'Burger Bun',          unit:'pieces', icon:'🍞' },
  { key:'hotdog',    label:'Hotdog / Salchicha',  unit:'pieces', icon:'🌭', note:'S=4pcs · M=6pcs · L=8pcs' },
  { key:'fries',     label:'Fries',               unit:'kg',     icon:'🍟' },
  { key:'cheese',    label:'Mozzarella Cheese',   unit:'kg',     icon:'🧀' },
];

// Category display order / icons for countdown
const STOCK_CATEGORY_INFO = {
  basket:  { label:'🧺 Single Protein Baskets', icon:'🧺' },
  wrap:    { label:'🌯 Wraps',                  icon:'🌯' },
  burger:  { label:'🍔 Burger',                 icon:'🍔' },
  mix:     { label:'🔀 Mix Baskets',             icon:'🔀' },
  hotdog:  { label:'🌭 Hotdogs',                icon:'🌭' },
  bread:   { label:'📄 Tortillas / Buns',        icon:'📄' },
  sides:   { label:'🍟 Sides',                  icon:'🍟' },
  dairy:   { label:'🧀 Dairy',                  icon:'🧀' },
  other:   { label:'📦 Other',                  icon:'📦' },
};

async function loadStock() {
  const el = $('stockContent');
  el.innerHTML = '<div class="empty"><p>Loading…</p></div>';
  try {
    const data = await api('/stock/tonight');
    if (!data.session) {
      renderStockSetup(el);
    } else if (data.session.status === 'closed') {
      renderShiftSummary(el, data.items);
    } else {
      renderLiveCountdown(el, data.session, data.items);
    }
  } catch (e) { el.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; }
}

// ---- SETUP FORM ----

let stockProteinRows = [];

function renderStockSetup(el) {
  stockProteinRows = [{ protein:'', kg:'' }];
  el.innerHTML = `
    <div class="card">
      <div style="font-weight:800;font-size:16px;margin-bottom:4px">Tonight's Stock</div>
      <div style="font-size:13px;color:var(--dim);margin-bottom:16px">What's prepped and ready for service?</div>

      <div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Proteins seasoned</div>
      <div id="stockProteinList"></div>
      <button class="btn btn-ghost btn-sm" onclick="addStockProteinRow()" style="margin-bottom:16px">+ Add protein</button>
      <button class="btn btn-ghost btn-sm" onclick="fillStockFromPrep()" style="margin-left:8px;margin-bottom:16px">↓ Fill from today's prep</button>

      <div id="stockProteinPreview" style="margin-bottom:16px"></div>

      <div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Other items</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:4px">
        ${STOCK_OTHER.map(s => `
          <div class="field">
            <label>${s.icon} ${esc(s.label)}${s.note ? '<span style="font-weight:400;font-size:11px"> ('+s.note+')</span>' : ''}</label>
            <input type="number" id="so_${s.key}" min="0" step="${s.unit==='kg'?'0.5':'1'}" placeholder="0" oninput="updateStockHotdogPreview()">
          </div>`).join('')}
      </div>
      <div id="hotdogPreview" style="margin-bottom:12px"></div>

    </div>
    <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:4px;height:52px;font-size:16px" onclick="submitOpenShift()">Open Service Tonight</button>`;
  renderStockProteinList();
}

function renderStockProteinList() {
  $('stockProteinList').innerHTML = stockProteinRows.map((r, i) => `
    <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-bottom:10px">
      <select id="spName_${i}" onchange="updateStockPortionPreview()">
        <option value="">— protein —</option>
        ${['Flank Steak','Chicken Breast','Chicken Wings','Burger Meat / Carni Mula','Chicharron / Pork Belly','Bacon']
          .map(p => `<option value="${p}"${r.protein===p?' selected':''}>${p}</option>`).join('')}
      </select>
      <input type="number" id="spKg_${i}" step="0.5" min="0" placeholder="kg" value="${r.kg}" oninput="updateStockPortionPreview()">
      ${stockProteinRows.length > 1 ? `<button class="btn btn-ghost btn-sm" onclick="removeStockProteinRow(${i})">✕</button>` : '<div></div>'}
    </div>`).join('');
}

function addStockProteinRow() {
  stockProteinRows.push({ protein:'', kg:'' });
  renderStockProteinList();
}

function removeStockProteinRow(i) {
  stockProteinRows.splice(i, 1);
  renderStockProteinList();
  updateStockPortionPreview();
}

function updateStockPortionPreview() {
  // Read current rows from DOM
  stockProteinRows.forEach((r, i) => {
    const nameEl = $('spName_'+i), kgEl = $('spKg_'+i);
    if (nameEl) r.protein = nameEl.value;
    if (kgEl) r.kg = parseFloat(kgEl.value) || 0;
  });

  const totalKg = stockProteinRows.reduce((s, r) => s + (parseFloat(r.kg)||0), 0);
  if (totalKg <= 0) { $('stockProteinPreview').innerHTML = ''; return; }

  const grams = totalKg * 1000;
  let html = `<div style="background:rgba(10,140,154,.07);border-radius:12px;padding:14px;border:1px solid rgba(10,140,154,.2)">
    <div style="font-size:12px;font-weight:700;color:var(--sea-deep);margin-bottom:10px">Bag cuts from ${totalKg.toFixed(1)} kg</div>`;
  BAG_CUTS.forEach((cut, i) => {
    const count = Math.floor(grams * cut.pct / cut.g);
    const isLast = i === BAG_CUTS.length - 1;
    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;${isLast?'':'border-bottom:1px solid var(--line)'}">
      <span style="font-size:13px;color:var(--dim)">${cut.oz}oz · ${cut.label.split('·')[0].trim()}</span>
      <span style="font-weight:800;font-size:18px;color:${cut.color}">${count}</span>
    </div>`;
  });
  html += '</div>';
  $('stockProteinPreview').innerHTML = html;
}

function updateStockHotdogPreview() {
  const pcs = parseFloat($('so_hotdog')?.value) || 0;
  const preview = $('hotdogPreview');
  if (!preview || !pcs) { if (preview) preview.innerHTML = ''; return; }
  preview.innerHTML = `<div style="font-size:12px;color:var(--dim);padding:8px 12px;background:rgba(255,170,0,.1);border-radius:8px">
    ${pcs} hotdog pieces → S: ${Math.floor(pcs/4)} · M: ${Math.floor(pcs/6)} · L: ${Math.floor(pcs/8)} portions
  </div>`;
}

async function fillStockFromPrep() {
  try {
    const inv = await api('/inventory');
    const proteins = inv.proteins.filter(p => p.latest_kg_done > 0);
    if (!proteins.length) { toast('No proteins logged in today\'s prep.'); return; }
    stockProteinRows = proteins.map(p => ({ protein: p.protein_name, kg: parseFloat(p.latest_kg_done) }));
    renderStockProteinList();
    updateStockPortionPreview();
    toast('Filled from today\'s prep!');
  } catch (e) { toast(e.message); }
}

async function submitOpenShift() {
  updateStockPortionPreview();

  const totalKg = stockProteinRows.reduce((s, r) => s + (parseFloat(r.kg)||0), 0);
  const items = [];

  // Add bag-cut items
  if (totalKg > 0) {
    const grams = totalKg * 1000;
    BAG_CUTS.forEach(cut => {
      const count = Math.floor(grams * cut.pct / cut.g);
      if (count > 0) {
        items.push({ item_name: cut.oz + 'oz bags', category: 'protein', unit: 'bags', start_qty: count });
      }
    });
  }

  // Add other items
  STOCK_OTHER.forEach(s => {
    const val = parseFloat($('so_'+s.key)?.value) || 0;
    if (val > 0) {
      if (s.key === 'hotdog') {
        // Store hotdog as sub-items for each size
        [['Hotdog S',4],['Hotdog M',6],['Hotdog L',8]].forEach(([name, pcs]) => {
          items.push({ item_name: name, category: 'hotdog', unit: 'portions', start_qty: Math.floor(val/pcs) });
        });
      } else {
        const cat = s.key === 'tortilla' || s.key === 'burger_bun' ? 'bread' : s.key === 'fries' ? 'sides' : 'dairy';
        items.push({ item_name: s.label, category: cat, unit: s.unit, start_qty: val });
      }
    }
  });

  if (!items.length) { toast('Enter at least one item.'); return; }

  try {
    await api('/stock/open', { method:'POST', body: JSON.stringify({ items }) });
    toast('Service started!');
    loadStock();
  } catch (e) { toast(e.message); }
}

// ---- LIVE COUNTDOWN ----

let stockRefreshTimer = null;

function renderLiveCountdown(el, session, items) {
  clearTimeout(stockRefreshTimer);

  // Group by category
  const groups = {};
  items.forEach(item => {
    if (!groups[item.category]) groups[item.category] = [];
    groups[item.category].push(item);
  });

  const catOrder = ['basket','wrap','burger','mix','hotdog','bread','sides','dairy','other'];

  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div style="font-weight:800;font-size:16px;color:var(--green)">🟢 Service Live</div>
    <button class="btn btn-ghost btn-sm" onclick="loadStock()">↻ Refresh</button>
  </div>`;

  catOrder.forEach(cat => {
    if (!groups[cat]) return;
    const info = STOCK_CATEGORY_INFO[cat] || { label: cat };
    html += `<div class="card" style="margin-bottom:10px">
      <div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">${info.label}</div>`;
    groups[cat].forEach((item, idx) => {
      const cur = parseFloat(item.current_qty);
      const start = parseFloat(item.start_qty);
      const pct = start > 0 ? cur / start : 1;
      const color = pct < 0.15 ? 'var(--coral)' : pct < 0.3 ? '#FFAA00' : 'var(--green)';
      const isLast = idx === groups[cat].length - 1;
      html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:11px 0;${isLast?'':'border-bottom:1px solid var(--line)'}">
        <div>
          <div style="font-weight:600;font-size:14px">${esc(item.item_name)}</div>
          <div style="font-size:11px;color:var(--dim)">${item.unit} · started: ${start}${item.unit==='kg'?' kg':''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <div style="font-weight:800;font-size:26px;color:${color};min-width:56px;text-align:right">${cur % 1 === 0 ? cur : cur.toFixed(1)}</div>
          <button onclick="stockUse(${item.id}, 1)" style="width:44px;height:44px;border-radius:12px;border:2px solid ${color};background:#fff;font-size:22px;font-weight:800;cursor:pointer;color:${color}">−</button>
        </div>
      </div>`;
    });
    html += '</div>';
  });

  if (CURRENT_USER?.role === 'owner' || CURRENT_USER?.role === 'prep') {
    html += `<button class="btn btn-coral" style="width:100%;justify-content:center;margin-top:4px;height:52px;font-size:16px" onclick="renderEndOfNightForm()">Close Shift & Log Leftovers</button>`;
  }

  $('stockContent').innerHTML = html;

  // Auto-refresh every 30s for kitchen device
  stockRefreshTimer = setTimeout(loadStock, 30000);
}

async function stockUse(id, amount) {
  try {
    const data = await api('/stock/use/' + id, { method:'PATCH', body: JSON.stringify({ amount }) });
    // Update just the count in-place without full reload
    const item = data.item;
    const cur = parseFloat(item.current_qty);
    const start = parseFloat(item.start_qty);
    const pct = start > 0 ? cur / start : 1;
    const color = pct < 0.15 ? 'var(--coral)' : pct < 0.3 ? '#FFAA00' : 'var(--green)';
    // Find and update the count element (the large number div)
    const btn = document.querySelector(`button[onclick="stockUse(${id}, 1)"]`);
    if (btn) {
      const countEl = btn.previousElementSibling;
      if (countEl) { countEl.textContent = cur % 1 === 0 ? cur : cur.toFixed(1); countEl.style.color = color; }
      btn.style.borderColor = color; btn.style.color = color;
    }
  } catch (e) { toast(e.message); }
}

// ---- END OF NIGHT ----

let EON_ITEMS = [];

async function renderEndOfNightForm() {
  const el = $('stockContent');
  try {
    const data = await api('/stock/tonight');
    EON_ITEMS = data.items;
    let html = `<div class="card">
      <div style="font-weight:800;font-size:16px;margin-bottom:4px">End of Night</div>
      <div style="font-size:13px;color:var(--dim);margin-bottom:16px">Count what's actually left and we'll tell you what to prep tomorrow.</div>
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:6px;margin-bottom:6px">
        <div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase">Item</div>
        <div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;text-align:center">Started</div>
        <div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;text-align:center">Left</div>
      </div>`;
    EON_ITEMS.forEach(item => {
      html += `<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:6px;align-items:center;padding:8px 0;border-top:1px solid var(--line)">
        <div style="font-size:13px;font-weight:600">${esc(item.item_name)}</div>
        <div style="text-align:center;color:var(--dim)">${item.start_qty}</div>
        <input type="number" id="eon_${item.id}" min="0" step="${item.unit==='kg'?'0.5':'1'}"
               style="border:1.5px solid var(--line);border-radius:8px;padding:8px;text-align:center;font-size:14px;font-weight:700;width:100%"
               placeholder="0">
      </div>`;
    });
    html += '</div>';
    html += `<button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px;height:52px;font-size:16px" onclick="submitCloseShift()">Save & See Tomorrow's Plan</button>`;
    el.innerHTML = html;
  } catch (e) { toast(e.message); }
}

async function submitCloseShift() {
  const items = EON_ITEMS.map(item => ({
    id: item.id,
    end_qty: parseFloat($('eon_'+item.id)?.value) || 0,
  }));
  try {
    const data = await api('/stock/close', { method:'POST', body: JSON.stringify({ items }) });
    renderShiftSummary($('stockContent'), data.items);
  } catch (e) { toast(e.message); }
}

function renderShiftSummary(el, items) {
  const sold = items.map(item => ({
    ...item,
    soldQty: parseFloat(item.start_qty) - (item.end_qty != null ? parseFloat(item.end_qty) : parseFloat(item.current_qty)),
  })).filter(i => parseFloat(i.start_qty) > 0);

  // Sort by sold qty desc (what was most popular)
  sold.sort((a, b) => b.soldQty - a.soldQty);

  // Basket-type items for recommendation
  const portionSold = sold.filter(i => ['basket','wrap','burger','mix'].includes(i.category));

  let html = `<div class="card" style="border-left:4px solid var(--green)">
    <div style="font-weight:800;font-size:16px;margin-bottom:2px">Tonight's Summary</div>
    <div style="font-size:13px;color:var(--dim);margin-bottom:14px">What went out tonight</div>`;

  const groups = {};
  sold.forEach(i => {
    if (!groups[i.category]) groups[i.category] = [];
    groups[i.category].push(i);
  });
  const catOrder = ['basket','wrap','burger','mix','hotdog','bread','sides','dairy','other'];
  catOrder.forEach(cat => {
    if (!groups[cat]) return;
    const info = STOCK_CATEGORY_INFO[cat] || { label: cat };
    html += `<div style="margin-bottom:12px"><div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">${info.label}</div>`;
    groups[cat].forEach(item => {
      const pct = parseFloat(item.start_qty) > 0 ? item.soldQty / parseFloat(item.start_qty) : 0;
      html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:13px">${esc(item.item_name)}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:80px;height:6px;background:var(--line);border-radius:99px">
            <div style="width:${Math.min(100,Math.round(pct*100))}%;height:6px;background:var(--sea);border-radius:99px"></div>
          </div>
          <span style="font-weight:700;font-size:13px;min-width:30px;text-align:right">${item.soldQty % 1 === 0 ? item.soldQty : item.soldQty.toFixed(1)}</span>
        </div>
      </div>`;
    });
    html += '</div>';
  });
  html += '</div>';

  // Tomorrow's recommendation
  if (portionSold.length > 0) {
    const top = portionSold.slice(0, 3);
    const slow = portionSold.slice(-2).filter(i => i.soldQty < (portionSold[0].soldQty * 0.2));
    html += `<div class="card" style="margin-top:10px;border-left:4px solid var(--mango)">
      <div style="font-weight:800;font-size:15px;margin-bottom:10px;color:var(--sea-deep)">🎯 Tomorrow's Prep Focus</div>`;
    top.forEach(i => {
      html += `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px">
        <span style="color:var(--green);font-size:16px">↑</span>
        <div><span style="font-weight:700">${esc(i.item_name)}</span> sold <strong>${i.soldQty % 1 === 0 ? i.soldQty : i.soldQty.toFixed(1)}</strong> tonight — keep prep level or increase</div>
      </div>`;
    });
    slow.forEach(i => {
      html += `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px">
        <span style="color:var(--coral);font-size:16px">↓</span>
        <div><span style="font-weight:700">${esc(i.item_name)}</span> moved slow (${i.soldQty % 1 === 0 ? i.soldQty : i.soldQty.toFixed(1)} sold) — reduce prep or shift mix toward faster sellers</div>
      </div>`;
    });
    html += '</div>';
  }

  html += `<button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:8px" onclick="loadStock()">↻ Check tomorrow's shift</button>`;
  el.innerHTML = html;
}
