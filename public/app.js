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
  if (id === 'seasoning') {
    $('seasonKg').value = '';
    $('seasonResults').style.display = 'none';
    const back = $('seasoningBack');
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

// ---------- SEASONING CALCULATOR ----------
function calcSeasoning() {
  const kg = parseFloat($('seasonKg').value) || 0;
  if (kg <= 0) { $('seasonResults').style.display = 'none'; return; }
  const compleet = kg * 0.25;
  const badia    = kg * 0.25;
  const chicken  = kg * 0.25;
  const paprika  = kg * 0.125;
  const oil      = compleet + badia + chicken + paprika;
  $('sCompleet').textContent = compleet.toFixed(2) + ' oz';
  $('sBadia').textContent    = badia.toFixed(2)    + ' oz';
  $('sChicken').textContent  = chicken.toFixed(2)  + ' oz';
  $('sPaprika').textContent  = paprika.toFixed(2)  + ' oz';
  $('sOil').textContent      = oil.toFixed(2)      + ' oz';
  $('seasonResults').style.display = 'block';
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
