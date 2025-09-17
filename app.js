// --- Config ---
const CFG = window.PPN_CONFIG || {};
const API_BASE = CFG.API_BASE;
const API_KEY  = CFG.API_KEY;
const LIMIT_LATEST = CFG.LIMIT_LATEST ?? 20;

// --- DOM helpers ---
const $  = (s,root=document)=>root.querySelector(s);
function show(el){ el.hidden=false; el.style.display=''; }
function hide(el){ el.hidden=true;  el.style.display='none'; }
function esc(s=''){ return s.replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function buildURL(params){
  const u = new URL(API_BASE);
  u.searchParams.set('key', API_KEY);
  Object.entries(params).forEach(([k,v])=> v!=null && u.searchParams.set(k,String(v)));
  return u.toString();
}

// --- BAN suggestions ---
async function fetchSuggestions(q){
  const u = new URL('https://api-adresse.data.gouv.fr/search/');
  u.searchParams.set('q', q);
  u.searchParams.set('limit','5');
  const r = await fetch(u.toString());
  if (!r.ok) return [];
  const j = await r.json();
  return (j.features||[]).map(f=>({
    label: f.properties.label,
    city: f.properties.city || f.properties.name || '',
    postcode: f.properties.postcode || '',
    citycode: f.properties.citycode || ''
  }));
}
function deptFromPostcode(cp=''){
  if (!cp) return '';
  if (cp.startsWith('97') || cp.startsWith('98')) return cp.slice(0,3); // DOM/TOM
  if (cp.startsWith('20')) return '2A/2B';
  return cp.slice(0,2);
}

// --- Renderers ---
function renderLatestTable(items){
  const rows = (items||[]).slice(0, LIMIT_LATEST).map(it=>`
    <tr>
      <td>${esc(it.city||'')}</td>
      <td>${esc(it.address||'')}</td>
      <td>${esc(it.time||'')}</td>
    </tr>
  `).join('');
  return `
    <div class="ppn-table-wrap">
      <table class="ppn-table">
        <thead><tr><th>Ville</th><th>Adresse</th><th>Heure</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3">Aucun signalement pour aujourd’hui.</td></tr>'}</tbody>
      </table>
    </div>
  `;
}
function renderDetails(list){
  if (!list?.length) return '<li>Aucun détail disponible.</li>';
  return list.map(d=>`
    <li>
      <strong>${esc(d.localisation||'Zone impactée inconnue')}</strong><br>
      Début : ${esc(d.dateDebut||'—')}
      ${d.dateFinPrevue ? ' – Rétablissement estimé : '+esc(d.dateFinPrevue) : ''}
      <br>Type : ${esc(d.typeIncident||'—')} | État : ${esc(d.etat||'—')}
      ${d.nbFoyers!=null ? ' | Foyers concernés : '+esc(String(d.nbFoyers)) : ''}
      ${d.id ? '<br><small>ID : '+esc(d.id)+'</small>' : ''}
    </li>
  `).join('');
}

// --- Elements ---
const input = $('#ppn-address');
const suggest = $('#ppn-suggest');
const btnCheck = $('#ppn-check');
const spinner = $('#ppn-spinner');
const statusBox = $('#ppn-status');

const detailsWrap = $('#ppn-details-wrap');
const detailsList = $('#ppn-details');

const latestWrap = $('#ppn-latest-wrap');
const latestBox = $('#ppn-latest');
const deptSpan = $('#ppn-dept');

const rCity = $('#ppn-report-city');
const rDept = $('#ppn-report-dept');
const rAddr = $('#ppn-report-address');
const rNote = $('#ppn-report-note');
const rBtn  = $('#ppn-report-btn');
const rMsg  = $('#ppn-report-msg');

// --- Autocomplete ---
let suggData = [];
input.addEventListener('input', async (e)=>{
  const q = (e.target.value||'').trim();
  if (!q || q.length<2){ suggest.style.display='none'; suggest.innerHTML=''; return; }
  try{
    const list = await fetchSuggestions(q);
    suggData = list;
    if (!list.length){ suggest.style.display='none'; suggest.innerHTML=''; return; }
    suggest.innerHTML = list.map((s,i)=>`<li data-i="${i}" role="option">${esc(s.label)}</li>`).join('');
    suggest.style.display = 'block';
  }catch{ suggest.style.display='none'; }
});
suggest.addEventListener('click', (e)=>{
  const li = e.target.closest('li'); if (!li) return;
  const sel = suggData[Number(li.dataset.i)];
  input.value = sel.label;
  suggest.style.display='none';
  rCity.value = sel.city || '';
  rDept.value = deptFromPostcode(sel.postcode);
});
document.addEventListener('click', (e)=>{
  if (!suggest.contains(e.target) && e.target !== input) suggest.style.display='none';
});

// --- Check + Latest ---
btnCheck.addEventListener('click', async ()=>{
  const q = (input.value||'').trim();
  if (!q){ statusBox.textContent='Veuillez saisir une adresse ou un code postal.'; statusBox.className='ppn-status err'; return; }

  hide(statusBox); hide(detailsWrap); hide(latestWrap); show(spinner);

  let cp = ''; let city = q;
  const m = q.match(/\b(\d{5})\b/); if (m) cp = m[1];

  try{
    // 1) Statut Enedis
    const uStatus = buildURL({ fn:'status', city, cp });
    const r1 = await fetch(uStatus);
    const j1 = await r1.json();

    hide(spinner);

    if (!j1.ok){
      statusBox.textContent = 'Erreur: ' + (j1.error || 'inconnue');
      statusBox.className = 'ppn-status err'; show(statusBox);
      return;
    }

    // Affichage statut
    if (j1.has_outage){
      statusBox.innerHTML = `⚠️ <strong>Coupure(s) en cours</strong> — ${esc(j1.city)} (${esc(j1.cp)})`;
      statusBox.className = 'ppn-status warn';
      if (j1.details?.length){
        detailsList.innerHTML = renderDetails(j1.details);
        show(detailsWrap);
      }
    } else {
      statusBox.innerHTML = `✅ <strong>Pas de coupure en cours</strong> — ${esc(j1.city)} (${esc(j1.cp)})`;
      statusBox.className = 'ppn-status ok';
    }
    show(statusBox);

    // 2) Derniers signalements (département)
    const dept = j1.dept || deptFromPostcode(j1.cp || cp);
    if (dept){
      const uLatest = buildURL({ fn:'latest', dept });
      const r2 = await fetch(uLatest);
      const j2 = await r2.json();

      if (j2.ok){
        deptSpan.textContent = esc(dept);
        latestBox.innerHTML = renderLatestTable(j2.items || []);
        show(latestWrap);
      }
    }
  }catch{
    hide(spinner);
    statusBox.textContent = 'Erreur réseau.'; statusBox.className='ppn-status err'; show(statusBox);
  }
});

// --- Report ---
rBtn.addEventListener('click', async ()=>{
  const dept = (rDept.value||'').trim();
  const city = (rCity.value||'').trim();
  if (!dept || !city){ rMsg.textContent='Renseignez au moins le département et la ville.'; return; }
  const address = (rAddr.value||'').trim();
  const note = (rNote.value||'').trim();

  try{
    const u = buildURL({ fn:'report', dept, city, address, postal_code:'', note });
    const r = await fetch(u);
    const j = await r.json();
    if (j.ok){
      rMsg.textContent = 'Merci, votre signalement a été enregistré.';
      rAddr.value=''; rNote.value='';
    } else {
      rMsg.textContent = 'Erreur lors de l’enregistrement.';
    }
  }catch{ rMsg.textContent = 'Erreur réseau.'; }
});
