'use strict';
import {filterProducts} from './catalog-utils.js';
import {quoteCurrency,formatMoney} from './currency.js';
import {nextActionFor,groupCustomers} from './workflow.js';
const $ = selector => document.querySelector(selector);
const setupLinkToken=/^#setup=([a-f0-9]{48})$/.exec(location.hash)?.[1];
if(setupLinkToken){$('#setupToken').value=setupLinkToken;history.replaceState(null,'',location.pathname+location.search);}
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const titles = {dashboard:'Ana Sayfa',new:'Yeni Servis Kaydı',records:'Servisler',approvals:'Bekleyen Onaylar',dealers:'Bayiler',customers:'Müşteriler',reports:'Raporlar',settings:'Ayarlar'};
let currentRate=null;
let records=[], settings={staff:[],catalog:[],statuses:{}}, csrf='', setup=false, selectedId=null, saving=false, previewURLs=[], intakeKey=crypto.randomUUID(),users=[],resetUsername='',approveUsername='',registrationChallenge='',registrationEmail='',registrationUntil=0,emailRegistrationEnabled=false;
const time=iso=>new Date(iso).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'});
function notify(message) { $('#globalMessage').textContent=message; $('#globalMessage').classList.remove('hidden'); }
async function api(path, method='GET', value) {
  const response=await fetch(path,{method,headers:{...(value?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{'X-CSRF-Token':csrf}:{})},...(value?{body:JSON.stringify(value)}:{})});
  const data=await response.json();
  if(!response.ok) {
    if(response.status===401 && !['/api/login','/api/setup','/api/password-reset','/api/password-reset/verify'].includes(path)) { $('#detailDialog').close(); $('#app').classList.add('hidden'); $('#auth').classList.remove('hidden'); $('#password').value=''; $('#authError').textContent='Oturumunuz sona erdi. Yeniden giriş yapın.'; }
    throw new Error(data.error || 'İşlem tamamlanamadı.');
  }
  return data;
}
function options(list, selected='') { return '<option value="">Personel seçin</option>'+list.map(name=>`<option ${name===selected?'selected':''}>${esc(name)}</option>`).join(''); }
function rows(data) {
  return data.length ? data.map(r=>`<tr><td><button class="record-link" data-record="${esc(r.id)}">${esc(r.id)}</button></td><td>${esc(r.product)}<small class="serial">${esc(r.serial)}</small></td><td>${esc(r.customer)}</td><td><span class="pill ${r.status==='waiting'?'amber':['repaired','tested','shipped'].includes(r.status)?'green':r.status==='review'?'purple':'blue'}">${esc(settings.statuses[r.status])}</span></td></tr>`).join('') : '<tr><td colspan="4" class="empty">Henüz kayıt yok.</td></tr>';
}
function render() {
  $('#recentRows').innerHTML=rows(records.slice(0,5));
  const q=$('#search').value.trim().toLocaleLowerCase('tr-TR'), filter=$('#statusFilter').value;
  $('#allRows').innerHTML=rows(records.filter(r=>(!filter||r.status===filter)&&(!$('#staffFilter').value||r.handledBy===$('#staffFilter').value||r.technician===$('#staffFilter').value)&&(!$('#brandFilter').value||r.brand===$('#brandFilter').value)&&[r.id,r.product,r.customer,r.serial,r.phone,r.brand,r.model,r.handledBy,r.technician].some(v=>String(v||'').toLocaleLowerCase('tr-TR').includes(q))));
  document.querySelectorAll('[data-quick-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.quickFilter===filter)));
  $('#activeCount').textContent=records.filter(r=>r.status!=='shipped').length;
  $('#inspectionCount').textContent=records.filter(r=>r.status==='received').length;
  $('#approvalCount').textContent=records.filter(r=>r.status==='waiting').length;
  const month=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'}).slice(0,7);
  $('#completedCount').textContent=records.filter(r=>r.status==='shipped'&&r.history.some(h=>h.status==='shipped'&&new Date(h.at).toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'}).startsWith(month))).length;
  const activities=records.flatMap(r=>r.history.map(h=>({...h,id:r.id}))).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,5);
  $('#activityList').innerHTML=activities.length ? activities.map(h=>`<div class="activity"><div class="dot"></div><div><p>${esc(h.action)}</p><small>${esc(h.id)} · ${esc(h.staff)}<br>${esc(time(h.at))}</small></div></div>`).join('') : '<p class="muted">İlk kaydınızla işlem geçmişi başlayacak.</p>';
  const people=groupCustomers(records,$('#customerTypeFilter').value);
  $('#customerRows').innerHTML=people.length?people.map(p=>`<tr><td>${esc(p.customer)}</td><td>${p.customerType==='dealer'?'Bayi':'Bireysel'}</td><td>${esc(p.email||'—')}</td><td>${esc(p.phone)}</td><td>${p.count}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">Bu türde müşteri kaydı yok.</td></tr>';
  $('#statusReport').innerHTML=Object.entries(settings.statuses).map(([key,label])=>`<div><span>${esc(label)}</span><strong>${records.filter(r=>r.status===key).length}</strong></div>`).join('');
  const productCounts=new Map();records.forEach(r=>productCounts.set(r.product,(productCounts.get(r.product)||0)+1));
  $('#productReport').innerHTML=productCounts.size?[...productCounts].sort((a,b)=>b[1]-a[1]).map(([product,count])=>`<div><span>${esc(product)}</span><strong>${count}</strong></div>`).join(''):'<p class="muted">Henüz servis kaydı yok.</p>';
}
function showProductInfo() {
  const p=settings.catalog.find(p=>p.product===$('#product').value);
  $('#categoryHint').textContent=p?`${settings.categories[p.category]}${p.note?' · '+p.note:''}`:'Marka ve model seçin.';
  $('#catalogSource').hidden=!p;
  if(p) { $('#catalogSource').href=`${p.source.url}#page=${p.source.page}`;$('#catalogSource').textContent=`Katalog kaynağı · PDF sayfa ${p.source.page} ↗`; }
}
function setModels(resetBrand=false) {
  const previous=$('#product').value;
  if(resetBrand) {
    $('#modelSearch').value='';
    const groups=[...new Set(settings.catalog.filter(p=>p.brand===$('#brand').value).map(p=>p.category))];
    $('#productGroup').innerHTML='<option value="">Tüm ürün grupları</option>'+groups.map(g=>`<option value="${g}">${esc(settings.categories[g])}</option>`).join('');
  }
  const products=filterProducts(settings.catalog,$('#brand').value,$('#productGroup').value,$('#modelSearch').value);
  $('#product').innerHTML=`<option value="">${products.length?'Model seçin':'Aramaya uygun model bulunamadı'}</option>`+products.map(p=>`<option value="${esc(p.product)}" ${!resetBrand&&p.product===previous?'selected':''}>${esc(p.model)}</option>`).join('');
  $('#modelCount').textContent=`${products.length} model / ürün seçeneği`;
  showProductInfo();
}
function renderStaffMembers(){
  $('#staffMembers').innerHTML=settings.staff.length?settings.staff.map((name,index)=>`<li><span>${esc(name)}</span><button type="button" class="secondary staff-remove" data-remove-staff="${index}" aria-label="${esc(name)} personelini sil">Sil</button></li>`).join(''):'<li class="muted">Kayıtlı personel yok.</li>';
}
function updateStaffList(staff){
  const previous=$('#handledBy').value;settings.staff=staff;
  $('#handledBy').innerHTML=options(staff,previous);$('#userPerson').innerHTML=options(staff);$('#approveUserPerson').innerHTML=options(staff);renderStaffMembers();
}
function applySettings() {
  document.querySelectorAll('[data-admin-only]').forEach(el=>el.classList.toggle('hidden',settings.user?.role!=='admin'));
  if($('#currentAccount'))$('#currentAccount').textContent=settings.user?`${settings.user.name} (${settings.user.email||settings.user.username})`:'';
  const previous=$('#handledBy').value;
  $('#handledBy').innerHTML=options(settings.staff,previous);
  renderStaffMembers();
  $('#userPerson').innerHTML=options(settings.staff);$('#approveUserPerson').innerHTML=options(settings.staff);
  if(settings.user?.role==='staff')$('#handledBy').value=settings.user.name;
  $('#catalogList').innerHTML=settings.brands.map(brand=>{const products=settings.catalog.filter(p=>p.brand===brand);return `<li><details><summary>${esc(brand)} <span class="muted">(${products.length})</span></summary><ul>${products.map(p=>`<li>${esc(p.model)} · <span class="muted">${esc(settings.categories[p.category])}</span></li>`).join('')}</ul></details></li>`;}).join('');
  $('#catalogVersion').textContent=`Katalog kontrolü: ${settings.catalogVersion} · ${settings.catalog.length} ürün / model seçeneği`;
  $('#brand').innerHTML=settings.brands.map(b=>`<option>${esc(b)}</option>`).join('');
  $('#statusFilter').innerHTML='<option value="">Tüm durumlar</option>'+Object.entries(settings.statuses).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('');
  setModels(true);
}
async function load() { [records,settings]=await Promise.all([api('/api/records'),api('/api/settings')]); applySettings(); $('#staffFilter').innerHTML='<option value="">Tüm personel</option>'+settings.staff.map(v=>`<option>${esc(v)}</option>`).join(''); $('#brandFilter').innerHTML='<option value="">Tüm markalar</option>'+settings.brands.map(v=>`<option>${esc(v)}</option>`).join(''); render(); loadRate();if(settings.user?.role==='admin')await loadUsers(); }
function closeMenu() { $('#sidebar').classList.remove('show'); $('#mobile').setAttribute('aria-expanded','false'); }
function goto(page) {
  if(page==='approvals'){page='records';$('#statusFilter').value='waiting';render();}
  if(page==='dealers'){page='customers';$('#customerTypeFilter').value='dealer';render();}
  if(page==='reports'){page='dashboard';$('#dashboardReports').open=true;}

  document.querySelectorAll('[data-view]').forEach(e=>e.classList.toggle('hidden',e.id!==page));
  document.querySelectorAll('#nav button').forEach(e=>e.classList.toggle('active',e.dataset.page===page));
  $('#breadcrumb').textContent=titles[page]; closeMenu();
  if(page==='new'&&!settings.staff.length) notify('İlk kayıttan önce Ayarlar bölümüne servis personelini ekleyin.');
}
document.querySelectorAll('[data-page],[data-goto]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.recordFilter!==undefined){$('#statusFilter').value=b.dataset.recordFilter;render();}goto(b.dataset.page||b.dataset.goto);}));
$('#mobile').addEventListener('click',()=>{const open=$('#sidebar').classList.toggle('show');$('#mobile').setAttribute('aria-expanded',String(open));});
document.addEventListener('keydown',e=>{if(e.key==='Escape') closeMenu();});
$('#brand').addEventListener('change',()=>setModels(true));
$('#productGroup').addEventListener('change',()=>setModels());
$('#modelSearch').addEventListener('input',()=>setModels());
$('#product').addEventListener('change',showProductInfo);
$('#customerTypeFilter').addEventListener('change',render);
document.querySelectorAll('[data-quick-filter]').forEach(button=>button.addEventListener('click',()=>{$('#statusFilter').value=button.dataset.quickFilter;render();}));
$('#search').addEventListener('input',render); $('#statusFilter').addEventListener('change',render);
$('#year').textContent=new Date().getFullYear();
$('#purchaseDate').max=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'});
$('#refresh').addEventListener('click',async()=>{try{records=await api('/api/records');render();notify('Kayıtlar yenilendi.');}catch(e){notify(e.message);}});
$('#passwordForm').addEventListener('submit',async e=>{
  e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');if(!form.reportValidity())return;
  $('#passwordResult').textContent='';
  if($('#newPassword').value!==$('#confirmNewPassword').value){$('#passwordResult').textContent='Yeni şifreler aynı değil.';return;}
  button.disabled=true;
  try{await api('/api/password','PATCH',{currentPassword:$('#currentPassword').value,newPassword:$('#newPassword').value,confirmPassword:$('#confirmNewPassword').value});form.reset();$('#passwordResult').textContent='Şifreniz değiştirildi. Diğer cihazlardaki oturumlar kapatıldı.';}
  catch(error){$('#passwordResult').textContent=error.message;}finally{button.disabled=false;}
});
let staffBusy=false;
async function saveStaffChange(data,message){
  if(staffBusy)return;staffBusy=true;$('#staffResult').textContent='';
  document.querySelectorAll('#staffMembers button,#staffForm button').forEach(b=>b.disabled=true);
  try{const result=await api('/api/settings','PATCH',data);updateStaffList(result.staff);if(data.addStaff)$('#staffName').value='';$('#staffResult').textContent=message;}
  catch(error){$('#staffResult').textContent=error.message;}
  finally{staffBusy=false;document.querySelectorAll('#staffMembers button,#staffForm button').forEach(b=>b.disabled=false);}
}
$('#staffMembers').addEventListener('click',e=>{
  const button=e.target.closest('[data-remove-staff]');if(!button||staffBusy)return;
  const name=settings.staff[Number(button.dataset.removeStaff)];if(!name)return;
  if(!confirm(`${name} personel listesinden kaldırılsın mı? Geçmiş servis kayıtlarındaki adı korunur.`))return;
  saveStaffChange({removeStaff:name},'Personel listeden kaldırıldı. Geçmiş servis kayıtları korundu.');
});
$('#staffForm').addEventListener('submit',e=>{
  e.preventDefault();if(!e.currentTarget.reportValidity())return;saveStaffChange({addStaff:$('#staffName').value},'Personel eklendi.');
});
function clearPreview() { previewURLs.forEach(URL.revokeObjectURL); previewURLs=[]; $('#photoPreview').replaceChildren(); }
function validateFiles(files) { if(files.length>5||files.some(f=>f.size>3*1024*1024||!['image/jpeg','image/png','image/webp'].includes(f.type))) throw new Error('En fazla 5 JPG, PNG veya WEBP fotoğraf seçin; her biri en fazla 3 MB olmalı.'); }
$('#intakePhotos').addEventListener('change',()=>{
  clearPreview(); $('#formError').textContent='';
  try { const files=[...$('#intakePhotos').files]; validateFiles(files); for(const f of files) { const img=document.createElement('img'); const url=URL.createObjectURL(f); previewURLs.push(url); img.src=url; img.alt=f.name; $('#photoPreview').append(img); } }
  catch(e){$('#formError').textContent=e.message;$('#intakePhotos').value='';}
});
const readPhoto=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Fotoğraf okunamadı.'));reader.onload=()=>resolve({name:file.name,type:file.type,data:String(reader.result).split(',')[1]});reader.readAsDataURL(file);});
$('#intakeForm').addEventListener('invalid',event=>{const details=event.target.closest('details');if(details)details.open=true;},true);
$('#intakeForm').addEventListener('submit',async e=>{
  e.preventDefault(); if(saving) return; const form=e.currentTarget;
  if(!form.reportValidity()) return;
  saving=true; $('#saveRecord').disabled=true; $('#formError').textContent='';
  try {
    const files=[...$('#intakePhotos').files]; validateFiles(files);
    const data=Object.fromEntries(new FormData(form)); data.photos=await Promise.all(files.map(readPhoto)); data.requestKey=intakeKey;
    const record=await api('/api/records','POST',data);
    records=[record,...records.filter(r=>r.id!==record.id)]; intakeKey=crypto.randomUUID(); form.reset(); if(settings.user?.role==='staff')$('#handledBy').value=settings.user.name; $('#additionalInfo').open=false; $('#statusFilter').value=''; $('#search').value=''; clearPreview(); setModels(true); render(); goto('records'); notify(`Servis kaydı oluşturuldu: ${record.id}`); openDetail(record.id);
  } catch(e) { $('#formError').textContent=e.message; }
  finally { saving=false; $('#saveRecord').disabled=false; }
});
function field(label,value) { return `<div><small>${esc(label)}</small><strong>${esc(value==null||value===''?'—':value)}</strong></div>`; }
let detailTab='general';
function selectDetailTab(key,focus=false){
  detailTab=key;
  document.querySelectorAll('[data-detail-tab]').forEach(button=>{const active=button.dataset.detailTab===key;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;$('#detail-'+button.dataset.detailTab).hidden=!active;if(active&&focus)button.focus();});
}
function openDetail(id) {
  const r=records.find(r=>r.id===id); if(!r) return; if(selectedId!==id)detailTab='general';selectedId=id;
  $('#detailTitle').textContent=r.id; $('#detailError').textContent='';
  const next=nextActionFor(r);
  $('#detailBody').innerHTML=`<div class="service-summary"><div><strong>${esc(r.product)}</strong><p>${esc(r.customer)}</p></div><span class="pill blue">${esc(settings.statuses[r.status])}</span></div><ol class="service-steps" aria-label="Servis adımları">${[['received','Kabul'],['review','İnceleme'],['waiting','Teklif'],['approved','Onay'],['repair','Onarım'],['tested','Test'],['shipped','Teslim']].map(([key,label])=>`<li ${r.status===key||(key==='repair'&&r.status==='repaired')?'aria-current="step"':''}>${label}</li>`).join('')}</ol><div class="next-step"><span>Sıradaki işlem</span><button type="button" id="nextAction" class="primary">${esc(next.label)}</button></div>
<div class="field staff-actor"><label for="actionStaff">İşlemi Gerçekleştiren Personel *</label><select id="actionStaff">${options(settings.staff,settings.user?.role==='staff'?settings.user.name:r.technician||r.handledBy)}</select></div>
  <div id="detailTabs" class="detail-tabs" role="tablist" aria-label="Servis detayları"><button type="button" role="tab" id="tab-general" data-detail-tab="general" aria-controls="detail-general">Genel Bilgiler</button><button type="button" role="tab" id="tab-work" data-detail-tab="work" aria-controls="detail-work">İşlemler ve Teklif</button><button type="button" role="tab" id="tab-documents" data-detail-tab="documents" aria-controls="detail-documents">Belgeler ve Geçmiş</button></div>
  <div id="detail-general" role="tabpanel" aria-labelledby="tab-general"><div class="detail-grid">${[['Ürün',r.product],['Model / Teknik Özellik',r.model],['Seri Numarası',r.serial],['Müşteri',r.customer],['Müşteri Türü',r.customerType==='dealer'?'Bayi':'Bireysel'],['E-posta',r.email],['Telefon',r.phone],['Adres',r.address],['Kabul Tarihi',time(r.createdAt)],['Durum',settings.statuses[r.status]],['Kabul Eden',r.handledBy],['Arıza',r.issue],['Fiziksel Durum',r.condition],['Satın Alma Tarihi',r.purchaseDate],['Aksesuarlar',r.accessories],['Teklif',quoteLabel(r)],['Teklif Açıklaması',r.quoteNote],['Müşteri Onayı',r.approval?`${r.approval.by} · ${r.approval.method} · ${time(r.approval.at)}`:'Henüz kaydedilmedi']].map(([k,v])=>field(k,v)).join('')}</div>
  ${r.photos.length?`<h3>Kabul Fotoğrafları</h3><div class="preview">${r.photos.map(p=>`<a href="/api/photos/${p.id}" target="_blank" rel="noopener"><img src="/api/photos/${p.id}" alt="${esc(p.name)}"></a>`).join('')}</div>`:''}
</div>
  <div id="detail-work" role="tabpanel" aria-labelledby="tab-work" hidden>${r.status==='waiting'&&r.quoteAmount!=null?`<form id="approveForm" class="detail-form"><h3>Müşteri Onayını Kaydet</h3><p class="muted">Bu işlem otomatik onay göndermez. Müşteriyle görüşülerek alınan onayı kayıt altına alır.</p><div class="formgrid"><div class="field"><label for="approvedBy">Onay Veren Kişi *</label><input id="approvedBy" maxlength="100" required></div><div class="field"><label for="approvalMethod">Onay Yöntemi *</label><select id="approvalMethod"><option>Telefon</option><option>E-posta</option><option>Yüz yüze</option><option>Yazılı mesaj</option></select></div></div><button class="primary">Alınan Onayı Kaydet</button></form>`:''}<form id="quoteForm" class="detail-form"><h3>Servis / Onarım Teklifi</h3><div class="formgrid"><div class="field"><label for="quoteCurrency">Para Birimi *</label><select id="quoteCurrency" required><option value="EUR">Euro (€ / EUR)</option></select></div><div class="field"><label for="quoteAmount">Servis ve onarım tutarı *</label><input id="quoteAmount" type="number" min="0" max="1000000000" step="0.01" required value="${quoteCurrency(r)==='EUR'?(r.quoteAmount??''):''}"></div><div class="field"><label for="quoteNote">Parça / İşçilik Açıklaması *</label><input id="quoteNote" maxlength="1000" required value="${esc(r.quoteNote)}"></div></div><p class="muted">Yeni teklifler euro olarak düzenlenir. TL karşılığı TCMB efektif satış kurundan hesaplanır. Kur ve tarihi teklifle kaydedilir; onaylanan teklif değişmez. Eski TL teklifleri korunur. Yeni teklif önceki onayı kaldırır.</p><p id="quoteConversion" class="hint" role="status"></p><button class="secondary">Teklifi Kaydet</button></form><details class="technical-notes"><summary>Ödemeler ve bakiye</summary><p>Toplam: ${r.quoteAmount==null?'—':formatMoney(r.quoteAmount,quoteCurrency(r))} · Alınan: ${formatMoney((r.payments||[]).reduce((sum,p)=>sum+(p.voidedAt?0:p.amount),0),quoteCurrency(r))} · Kalan: ${r.quoteAmount==null?'—':formatMoney(r.quoteAmount-(r.payments||[]).reduce((sum,p)=>sum+(p.voidedAt?0:p.amount),0),quoteCurrency(r))}</p><div>${(r.payments||[]).map(p=>`<p>${esc(formatMoney(p.amount,p.currency))} · ${esc(time(p.at))} · ${esc(p.note)} · ${esc(p.staff)} ${p.voidedAt?'· İptal edildi':settings.user?.role==='admin'?`<button type="button" class="text-button" data-void-payment="${esc(p.id)}">İptal Et</button>`:''}</p>`).join('')}</div>${r.approval?`<form id="paymentForm" class="detail-form"><label for="paymentAmount">Alınan ödeme (${esc(quoteCurrency(r))})</label><input id="paymentAmount" type="number" min="0.01" step="0.01" required><label for="paymentNote">Ödeme yöntemi / notu</label><input id="paymentNote" maxlength="300" required placeholder="Nakit, havale…"><button class="secondary">Ödemeyi Kaydet</button></form>`:'<p class="muted">Ödeme eklemek için teklif onayını kaydedin.</p>'}</details><details class="technical-notes" ${['repair','repaired','tested'].includes(r.status)?'open':''}><summary>Teknik inceleme ve onarım notları</summary><form id="notesForm" class="detail-form"><h3>Teknik İnceleme / Onarım</h3><div class="field"><label for="warranty">Garanti Değerlendirmesi</label><select id="warranty">${Object.entries({pending:'Değerlendiriliyor',warranty:'Garanti kapsamında',outside:'Garanti dışı'}).map(([k,v])=>`<option value="${k}" ${r.warranty===k?'selected':''}>${v}</option>`).join('')}</select></div>${[['findings','Teknik Tespit',3000],['work','Yapılan İşlemler',3000],['tests','Son Test Sonucu',2000]].map(([k,label,max])=>`<div class="field"><label for="${k}">${label}</label><textarea id="${k}" maxlength="${max}">${esc(r[k])}</textarea></div>`).join('')}<button class="secondary">Teknik Notları Kaydet</button></form></details><details class="advanced-actions"><summary>Durumu elle değiştir</summary><form id="statusForm" class="detail-form"><h3>Servis Durumu</h3><div class="filters"><label class="sr-only" for="nextStatus">Yeni durum</label><select id="nextStatus">${Object.entries(settings.statuses).map(([k,v])=>`<option value="${k}" ${r.status===k?'selected':''} ${k==='approved'?'disabled':''}>${esc(v)}</option>`).join('')}</select><button class="secondary">Durumu Kaydet</button></div></form></details></div>
  <div id="detail-documents" role="tabpanel" aria-labelledby="tab-documents" hidden><h3>Servis Belgeleri</h3><div class="document-actions">${[['accept','Servis Kabul Formu'],['inspect','Teknik İnceleme Raporu'],['finish','Onarım ve Teslim Formu'],['quote','Teklif Formu / PDF']].map(([type,label])=>`<a class="secondary" target="_blank" rel="noopener" href="/print?id=${encodeURIComponent(r.id)}&type=${type}">${label} ↗</a>`).join('')}</div><details class="technical-notes"><summary>Müşteri takip bağlantısı</summary><p class="muted">Bağlantıya sahip kişi ürünün durumunu ve teklifini görebilir. Kişisel bilgiler ve iç notlar paylaşılmaz. Bağlantı 30 gün geçerlidir; yenisi eskisini kapatır. Teklif onayını burada siz kaydedersiniz.</p><button type="button" id="createTracking" class="secondary">Bağlantı Oluştur / Yenile</button> <button type="button" id="revokeTracking" class="secondary">Bağlantıyı Kapat</button><p id="trackingResult" role="status"></p></details><details class="history-details"><summary>İşlem Geçmişi</summary><div class="history">${r.history.slice().reverse().map(h=>`<div><strong>${esc(h.action)}</strong><small>${esc(time(h.at))} · ${esc(h.staff)} · ${esc(settings.statuses[h.status])}</small></div>`).join('')}</div></details><details class="danger-zone ${settings.user?.role==='admin'?'':'hidden'}"><summary>Servis kaydını sil</summary><p class="muted">Bu kayıt, fotoğrafları ve işlem geçmişi kalıcı olarak silinir. Geri almak için önceden alınmış yedek gerekir.</p><button type="button" id="deleteRecord" class="secondary">Servis Kaydını Sil</button></details></div>`;
  if(!$('#detailDialog').open) $('#detailDialog').showModal();
  selectDetailTab(detailTab);
  $('#detailTabs').addEventListener('click',event=>{const tab=event.target.closest('[data-detail-tab]');if(tab)selectDetailTab(tab.dataset.detailTab);});
  $('#detailTabs').addEventListener('keydown',event=>{
    const keys=['general','work','documents'];if(!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;event.preventDefault();
    const index=keys.indexOf(detailTab),nextIndex=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3;selectDetailTab(keys[nextIndex],true);
  });
  $('#nextAction').addEventListener('click',()=>{
    selectDetailTab(next.tab);
    if(next.status){updateRecord(r,{action:'status',status:next.status});return;}
    if(next.target)$('#'+next.target)?.focus();
  });

  $('#statusForm').addEventListener('submit',e=>{e.preventDefault();if($('#nextStatus').value===r.status){$('#detailError').textContent='Kaydetmek için farklı bir servis durumu seçin.';return;}updateRecord(r,{action:'status',status:$('#nextStatus').value});});
  $('#quoteAmount').addEventListener('input',showConversion);showConversion();
  document.querySelectorAll('[data-void-payment]').forEach(button=>button.addEventListener('click',()=>{const note=prompt('Ödeme iptal nedeni:');if(note?.trim())updateRecord(r,{action:'paymentVoid',paymentId:button.dataset.voidPayment,note});}));
  $('#paymentForm')?.addEventListener('submit',e=>{e.preventDefault();updateRecord(r,{action:'payment',amount:Number($('#paymentAmount').value),note:$('#paymentNote').value});});
  for(const [id,revoke] of [['createTracking',false],['revokeTracking',true]])$('#'+id).addEventListener('click',async e=>{e.target.disabled=true;try{const result=await api(`/api/records/${encodeURIComponent(r.id)}/tracking`,'POST',{revoke});const out=$('#trackingResult');out.textContent=result.url||'Bağlantı kapatıldı.';if(result.url){const input=document.createElement('input');input.readOnly=true;input.value=result.url;input.setAttribute('aria-label','Müşteri takip bağlantısı');out.replaceChildren(input);input.select();}}catch(error){$('#trackingResult').textContent=error.message;}finally{e.target.disabled=false;}});
  $('#quoteCurrency').addEventListener('change',()=>{ $('#quoteAmount').value=''; $('#quoteAmount').focus(); });
  $('#deleteRecord').addEventListener('click',async()=>{
    const staff=$('#actionStaff').value;
    if(!staff){$('#detailError').textContent='İşlemi gerçekleştiren personeli seçin.';return;}
    if(!confirm(`${r.id} numaralı servis kaydı, fotoğrafları ve işlem geçmişi kalıcı olarak silinsin mi?`)) return;
    const buttons=[...$('#detailBody').querySelectorAll('button')];
    if(buttons.some(b=>b.disabled)) return;
    buttons.forEach(b=>b.disabled=true);
    try {
      await api(`/api/records/${encodeURIComponent(r.id)}`,'DELETE',{staff,version:r.version,confirmId:r.id});
      records=records.filter(old=>old.id!==r.id); selectedId=null; $('#detailDialog').close(); render(); notify('Servis kaydı silindi.');
    } catch(e){$('#detailError').textContent=e.message;buttons.forEach(b=>b.disabled=false);}
  });
  $('#quoteForm').addEventListener('submit',e=>{e.preventDefault();updateRecord(r,{action:'quote',amount:Number($('#quoteAmount').value),currency:$('#quoteCurrency').value,note:$('#quoteNote').value});});
  $('#approveForm')?.addEventListener('submit',e=>{e.preventDefault();updateRecord(r,{action:'approve',approvedBy:$('#approvedBy').value,method:$('#approvalMethod').value});});
  $('#notesForm').addEventListener('submit',e=>{e.preventDefault();updateRecord(r,{action:'notes',warranty:$('#warranty').value,findings:$('#findings').value,work:$('#work').value,tests:$('#tests').value});});
}
async function updateRecord(record,data) {
  const staff=$('#actionStaff').value;
  if(!staff) { $('#detailError').textContent='İşlemi gerçekleştiren personeli seçin.'; return; }
  const buttons=[...$('#detailBody').querySelectorAll('button')]; if(buttons.some(b=>b.disabled)) return;
  buttons.forEach(b=>b.disabled=true);
  try { const r=await api(`/api/records/${encodeURIComponent(record.id)}`,'PATCH',{...data,staff,version:record.version}); records=records.map(old=>old.id===r.id?r:old); render(); openDetail(r.id); }
  catch(e) { $('#detailError').textContent=e.message; buttons.forEach(b=>b.disabled=false); if(e.message.includes('başka bir pencerede')) { try { records=await api('/api/records'); render(); } catch {} } }
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-record]');if(b)openDetail(b.dataset.record);});
$('#detailClose').addEventListener('click',()=>$('#detailDialog').close());
$('#logout').addEventListener('click',async()=>{try{await api('/api/logout','POST',{});location.reload();}catch(e){notify(e.message);}});
$('#authForm').addEventListener('submit',async e=>{
  e.preventDefault(); $('#authError').textContent=''; $('#authSubmit').disabled=true;
  try { const password=$('#password').value;if(setup&&password!==$('#confirm').value)throw new Error('Şifreler aynı değil.');const result=await api(setup?'/api/setup':'/api/login','POST',{password,username:$('#username').value,...(setup?{setupToken:$('#setupToken').value}:{})});csrf=result.csrf;setup=false;$('#authSwitch').classList.remove('hidden');$('#usernameWrap').hidden=false;$('#username').required=true;$('#confirmWrap').hidden=true;$('#setupTokenWrap').hidden=true;$('#setupToken').required=false;$('#setupToken').value='';$('#confirm').required=false;$('#password').value='';$('#confirm').value='';await load();$('#auth').classList.add('hidden');$('#app').classList.remove('hidden');goto(settings.staff.length||settings.user?.role==='staff'?'dashboard':'settings'); }
  catch(e){$('#authError').textContent=e.message;}finally{$('#authSubmit').disabled=false;}
});
async function init() {
  try { const state=await api('/api/session');setup=state.setup;csrf=state.csrf;emailRegistrationEnabled=state.emailRegistration;$('#authSwitch').classList.toggle('hidden',setup);$('#usernameWrap').hidden=setup;$('#username').required=!setup;$('#setupTokenWrap').hidden=!setup||!!$('#setupToken').value;$('#setupToken').required=setup;$('#authTitle').textContent=setup?'İlk Kurulum':'Servis Sistemine Giriş';$('#authInfo').textContent=setup?'En az 8 karakterli bir yönetici şifresi belirleyin.':'E-posta adresiniz veya mevcut kullanıcı adınızla giriş yapın.';$('#password').minLength=setup?8:1;$('#password').autocomplete=setup?'new-password':'current-password';$('#confirmWrap').hidden=!setup;$('#confirm').required=setup;$('#authSubmit').textContent=setup?'Kurulumu Tamamla':'Giriş Yap';$('#authSubmit').disabled=false;if(state.authenticated){await load();$('#auth').classList.add('hidden');$('#app').classList.remove('hidden');}else if(!setup&&restoreVerification()){showVerificationScreen();} }
  catch(e){$('#authInfo').textContent='Sunucuya bağlanılamadı. Bağlantınızı kontrol edip sayfayı yenileyin.';$('#authError').textContent=e.message;}
  finally{$('#startup').classList.add('hidden');if($('#app').classList.contains('hidden'))$('#auth').classList.remove('hidden');}
}

function renderUsers(){
  const pending=users.filter(u=>u.pending).length;$('#pendingUserCount').textContent=pending+' onay bekliyor';$('#pendingUserCount').classList.toggle('hidden',!pending);
  $('#userMembers').innerHTML=users.length?users.map((u,i)=>`<li><span><strong>${esc(u.name)}</strong><br><small>${esc(u.email||u.username)} · ${u.pending?'Onay Bekliyor':u.rejected?'Reddedildi':u.active?'Aktif':'Pasif'}</small></span><div class="user-actions">${u.pending||u.rejected?`<button type="button" class="secondary" data-approve-user="${i}">Onayla</button>${u.pending?`<button type="button" class="secondary" data-reject-user="${i}">Reddet</button>`:''}`:`<button type="button" class="secondary" data-reset-user="${i}">Şifre Belirle</button><button type="button" class="secondary" data-toggle-user="${i}">${u.active?'Pasife Al':'Aktifleştir'}</button>`}</div></li>`).join(''):'<li class="muted">Henüz personel hesabı oluşturulmadı.</li>';
}
async function loadUsers(){users=await api('/api/users');users.sort((a,b)=>Number(b.pending)-Number(a.pending)||a.username.localeCompare(b.username));renderUsers();}
let usersBusy=false;
async function userChange(task){if(usersBusy)return;usersBusy=true;$('#usersResult').textContent='';document.querySelectorAll('.user-management button').forEach(b=>b.disabled=true);try{await task();await loadUsers();}catch(error){$('#usersResult').textContent=error.message;}finally{usersBusy=false;document.querySelectorAll('.user-management button').forEach(b=>b.disabled=false);}}
$('#userForm').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;if(!form.reportValidity())return;if($('#userPassword').value!==$('#userConfirm').value){$('#usersResult').textContent='Şifreler aynı değil.';return;}userChange(async()=>{await api('/api/users','POST',{name:$('#userPerson').value,email:$('#userEmail').value,password:$('#userPassword').value,confirmPassword:$('#userConfirm').value});form.reset();$('#usersResult').textContent='Hesap oluşturuldu. Personel e-posta adresi ve başlangıç şifresiyle giriş yapabilir.';});});
$('#userMembers').addEventListener('click',e=>{const reset=e.target.closest('[data-reset-user]'),toggle=e.target.closest('[data-toggle-user]');if(usersBusy)return;if(reset){const u=users[Number(reset.dataset.resetUser)];resetUsername=u.username;$('#userResetForm').reset();$('#userResetForm').classList.remove('hidden');$('#userResetTitle').textContent=(u.email||u.username)+' — Yeni Şifre';$('#resetUserPassword').focus();}if(toggle){const u=users[Number(toggle.dataset.toggleUser)];userChange(async()=>{await api('/api/users/'+encodeURIComponent(u.username),'PATCH',{active:!u.active});$('#usersResult').textContent=u.active?'Kullanıcı pasife alındı. Açık oturumları kapatıldı.':'Kullanıcı aktifleştirildi.';});}});
$('#cancelUserReset').addEventListener('click',()=>{$('#userResetForm').reset();$('#userResetForm').classList.add('hidden');resetUsername='';});
$('#userResetForm').addEventListener('submit',e=>{e.preventDefault();if(!resetUsername||!e.currentTarget.reportValidity())return;if($('#resetUserPassword').value!==$('#resetUserConfirm').value){$('#usersResult').textContent='Şifreler aynı değil.';return;}userChange(async()=>{await api('/api/users/'+encodeURIComponent(resetUsername),'PATCH',{password:$('#resetUserPassword').value,confirmPassword:$('#resetUserConfirm').value});$('#userResetForm').reset();$('#userResetForm').classList.add('hidden');resetUsername='';$('#usersResult').textContent='Kullanıcı şifresi güncellendi. Açık oturumları kapatıldı.';});});

function showRegistration(show){
  if(setup)return;
  $('#authForm').classList.toggle('hidden',show);$('#authSwitch').classList.toggle('hidden',show);$('#registerForm').classList.toggle('hidden',!show);
  $('#authTitle').textContent=show?'Kayıt Ol':'Servis Sistemine Giriş';$('#authInfo').textContent=show?'Ad soyad, e-posta adresiniz ve şifrenizle başvurun.':'E-posta adresiniz veya mevcut kullanıcı adınızla giriş yapın.';
  $('#authError').textContent='';$('#registerError').textContent='';$('#password').value='';$('#registerPassword').value='';$('#registerConfirm').value='';
  $('#verifyEmailForm').classList.add('hidden');$('#resumeEmailVerification').classList.toggle('hidden',!restoreVerification());
  $('#registerSubmit').disabled=!emailRegistrationEnabled;
  if(show){$('#registerName').focus();if(!emailRegistrationEnabled)$('#registerError').textContent='E-posta doğrulama kurulumu henüz tamamlanmadı. Yöneticiyle iletişime geçin.';}else $('#username').focus();
}
$('#showRegister').addEventListener('click',()=>{$('#registrationResult').textContent='';showRegistration(true);});
$('#showLogin').addEventListener('click',()=>showRegistration(false));
$('#registerForm').addEventListener('submit',async e=>{
  e.preventDefault();const form=e.currentTarget;if(!form.reportValidity())return;
  $('#registerError').textContent='';if($('#registerPassword').value!==$('#registerConfirm').value){$('#registerError').textContent='Şifreler aynı değil.';return;}
  const button=$('#registerSubmit');if(button.disabled)return;button.disabled=true;
  try{registrationEmail=$('#registerEmail').value.trim().toLowerCase();const result=await api('/api/register','POST',{name:$('#registerName').value,email:registrationEmail,password:$('#registerPassword').value,confirmPassword:$('#registerConfirm').value});
    rememberVerification(result.challenge,registrationEmail,result.expiresIn);$('#registerPassword').value='';$('#registerConfirm').value='';showVerificationScreen();
  }catch(error){$('#registerError').textContent=error.message;}finally{button.disabled=false;}
});
$('#userMembers').addEventListener('click',e=>{
  if(usersBusy)return;const approve=e.target.closest('[data-approve-user]'),reject=e.target.closest('[data-reject-user]');
  if(approve){const u=users[Number(approve.dataset.approveUser)];approveUsername=u.username;$('#userApproveTitle').textContent=(u.email||u.username)+' — Başvuruyu Onayla';$('#approveUserPerson').innerHTML=options(settings.staff,settings.staff.find(n=>n.toLocaleLowerCase('tr-TR')===u.name.toLocaleLowerCase('tr-TR'))||'');$('#userApproveForm').classList.remove('hidden');$('#approveUserPerson').focus();}
  if(reject){const u=users[Number(reject.dataset.rejectUser)];userChange(async()=>{await api('/api/users/'+encodeURIComponent(u.username),'PATCH',{reject:true});$('#usersResult').textContent='Başvuru reddedildi. Hesap servis bilgilerine erişemez.';});}
});
$('#cancelUserApprove').addEventListener('click',()=>{$('#userApproveForm').classList.add('hidden');approveUsername='';});
$('#userApproveForm').addEventListener('submit',e=>{e.preventDefault();if(!approveUsername||!e.currentTarget.reportValidity())return;userChange(async()=>{await api('/api/users/'+encodeURIComponent(approveUsername),'PATCH',{approve:true,name:$('#approveUserPerson').value});$('#userApproveForm').classList.add('hidden');approveUsername='';$('#usersResult').textContent='Başvuru onaylandı. Kullanıcı belirlediği şifreyle giriş yapabilir.';});});

$('#restartRegistration').addEventListener('click',()=>{showRegistration(true);$('#registerError').textContent='Yeni kod istemek için şifrenizi tekrar girin. Gönderimler arasında en az 60 saniye bekleyin.';});
$('#verifyEmailForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!registrationChallenge||!e.currentTarget.reportValidity())return;
  const button=$('#verifyEmailSubmit');if(button.disabled)return;button.disabled=true;$('#verifyEmailError').textContent='';
  try{const result=await api('/api/register/verify','POST',{challenge:registrationChallenge,code:$('#emailCode').value.trim()});$('#registerForm').reset();$('#verifyEmailForm').reset();clearVerification();showRegistration(false);$('#username').value=result.email;$('#registrationResult').textContent=result.message;}
  catch(error){$('#verifyEmailError').textContent=error.message;}finally{button.disabled=false;}
});

function rememberVerification(challenge,email,seconds){
  registrationChallenge=challenge;registrationEmail=email;registrationUntil=Date.now()+Math.min(Number(seconds)||600,600)*1000;
  try{sessionStorage.setItem('powerpool.pending-email',JSON.stringify({challenge,email,until:registrationUntil}));}catch{}
}
function clearVerification(){registrationChallenge='';registrationEmail='';registrationUntil=0;try{sessionStorage.removeItem('powerpool.pending-email');}catch{}}
function restoreVerification(){
  try{const stored=JSON.parse(sessionStorage.getItem('powerpool.pending-email')||'null');if(stored&&typeof stored.challenge==='string'&&/^[a-f0-9]{48}$/.test(stored.challenge)&&typeof stored.email==='string'&&stored.email.length<=254&&stored.until>Date.now()&&stored.until<=Date.now()+600000){registrationChallenge=stored.challenge;registrationEmail=stored.email;registrationUntil=stored.until;return true;}}catch{}
  if(registrationChallenge&&registrationUntil>Date.now())return true;clearVerification();return false;
}
function showVerificationScreen(){
  $('#authForm').classList.add('hidden');$('#authSwitch').classList.add('hidden');$('#registerForm').classList.add('hidden');$('#resumeEmailVerification').classList.add('hidden');$('#verifyEmailForm').classList.remove('hidden');
  $('#authTitle').textContent='E-postanızı Doğrulayın';$('#authInfo').textContent='E-postanıza gönderilen kodu girin.';$('#verifyEmailInfo').textContent='Kod gönderilen adres: '+registrationEmail;$('#verifyEmailError').textContent='';$('#emailCode').value='';$('#emailCode').focus();
}
$('#resumeEmailVerification').addEventListener('click',()=>{if(restoreVerification())showVerificationScreen();else{$('#resumeEmailVerification').classList.add('hidden');$('#registerError').textContent='Kodun süresi dolmuş. Yeniden kod isteyin.';}});

init();

function quoteLabel(r){
  if(r.quoteAmount==null)return '—';
  let label=formatMoney(r.quoteAmount,quoteCurrency(r));
  const rate=r.approval?r.quoteRate:(currentRate||r.quoteRate);
  if(quoteCurrency(r)==='EUR'&&rate)label+=' ≈ '+formatMoney(Math.round(r.quoteAmount*rate.rate*100)/100,'TRY')+' · TCMB '+rate.date;
  return label;
}
async function loadRate(){try{currentRate=await api('/api/rates');$('#rateInfo').textContent=`TCMB EUR efektif satış: ${currentRate.rate.toLocaleString('tr-TR',{maximumFractionDigits:4})} TL · ${currentRate.date}${currentRate.stale?' · Son kayıtlı kur, güncelleme bekleniyor':''}`;}catch(error){$('#rateInfo').textContent=error.message;}showConversion();}
function showConversion(){const out=$('#quoteConversion');if(!out)return;out.textContent=currentRate?`${formatMoney(Number($('#quoteAmount').value||0),'EUR')} ≈ ${formatMoney(Math.round(Number($('#quoteAmount').value||0)*currentRate.rate*100)/100,'TRY')} · TCMB ${currentRate.date}${currentRate.stale?' · Güncelleme bekleniyor':''}`:'TCMB kuru yükleniyor…';}
setInterval(()=>{if(!$('#app').classList.contains('hidden'))loadRate();},3600000);
for(const id of ['staffFilter','brandFilter'])$('#'+id).addEventListener('change',render);
$('#showRecovery').addEventListener('click',()=>{$('#recoveryDialog').showModal();});
$('#closeRecovery').addEventListener('click',()=>{$('#recoveryDialog').close();});
let resetChallenge='';
$('#recoveryStart').addEventListener('submit',async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const result=await api('/api/password-reset','POST',{email:$('#recoveryEmail').value});resetChallenge=result.challenge;$('#recoveryMessage').textContent=result.message;$('#recoveryVerify').hidden=false;$('#recoveryStart').hidden=true;}catch(error){$('#recoveryMessage').textContent=error.message;}finally{button.disabled=false;}});
$('#recoveryVerify').addEventListener('submit',async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const result=await api('/api/password-reset/verify','POST',{challenge:resetChallenge,code:$('#recoveryCode').value,password:$('#recoveryPassword').value,confirmPassword:$('#recoveryConfirm').value});$('#recoveryMessage').textContent=result.message;e.target.reset();e.target.hidden=true;$('#recoveryStart').hidden=false;resetChallenge='';}catch(error){$('#recoveryMessage').textContent=error.message;}finally{button.disabled=false;}});
$('#loadAudit').addEventListener('click',async()=>{try{const entries=await api('/api/audit');$('#auditEntries').replaceChildren(...entries.map(item=>{const p=document.createElement('p');p.textContent=`${time(item.at)} · ${item.record_id} · ${item.actor} · ${item.action}`;return p;}));if(!entries.length)$('#auditEntries').textContent='Henüz işlem yok.';}catch(error){$('#auditEntries').textContent=error.message;}});

$('#restartRecovery').addEventListener('click',()=>{resetChallenge='';$('#recoveryVerify').reset();$('#recoveryVerify').hidden=true;$('#recoveryStart').hidden=false;$('#recoveryMessage').textContent='Yeni kod istemeden önce 60 saniye bekleyin.';});
