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
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
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

function afterLogin() {
  if ($('navUserName')) $('navUserName').textContent = CURRENT_USER.name;
  if ($('prepUserName')) $('prepUserName').textContent = CURRENT_USER.name;
  if (CURRENT_USER.role === 'owner') {
    go('owner-home');
    loadOwnerHome();
  } else {
    go('prep-home');
    loadPrepHome();
  }
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
