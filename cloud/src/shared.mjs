import {Buffer} from 'node:buffer';
import {quoteCurrency,formatMoney} from '../public/js/currency.js';
const token=n=>Array.from(crypto.getRandomValues(new Uint8Array(n)),b=>b.toString(16).padStart(2,'0')).join('');
export const STATUS_LABEL={ received:'Kabul Edildi', review:'İncelemede', waiting:'Onay Bekliyor', approved:'Onaylandı', repair:'Onarımda', repaired:'Onarım Tamamlandı', tested:'Test Tamamlandı', shipped:'Teslim Edildi / Kargoya Verildi' };
function fail(message, status=400) { const e = new Error(message); e.status = status; throw e; }
function text(value, label, max, required=false) {
  if (typeof value !== 'string' && value != null) fail(`${label} metin olmalıdır.`);
  const result = (value || '').trim();
  if ((required && !result) || result.length > max) fail(`${label}: ${required ? 'boş bırakılamaz; ' : ''}en fazla ${max} karakter.`);
  return result;
}
function date(value) {
  const result = text(value, 'Satın alma tarihi', 10);
  if (result && (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0,10) !== result || result > new Date().toLocaleDateString('sv-SE', { timeZone:'Europe/Istanbul' }))) fail('Geçerli, gelecekte olmayan bir satın alma tarihi girin.');
  return result;
}
function photoData(value) {
  if(!Array.isArray(value) || value.length>5) fail('En fazla 5 fotoğraf eklenebilir.');
  return value.map(p=>{
    if(!p || typeof p !== 'object') fail('Geçersiz fotoğraf.');
    const name=text(p.name,'Fotoğraf adı',200,true);
    if(!['image/jpeg','image/png','image/webp'].includes(p.type) || typeof p.data!=='string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(p.data)) fail('JPG, PNG veya WEBP fotoğraf seçin.');
    const bytes=Buffer.from(p.data,'base64');
    if(bytes.length===0 || bytes.length>3*1024*1024) fail('Fotoğraf başına üst sınır 3 MB.');
    const valid = p.type==='image/jpeg' ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255 : p.type==='image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
    if(!valid) fail('Fotoğraf içeriği belirtilen dosya türüyle uyuşmuyor.');
    return { id:token(16), name, type:p.type, bytes };
  });
}
const safe=v=>String(v ?? '—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function printDocument(r,type) {
  const titles={accept:'Servis Kabul Formu',inspect:'Teknik İnceleme Raporu',finish:'Onarım ve Teslim Formu',quote:'Servis / Onarım Teklifi'};
  if(!Object.hasOwn(titles,type)) fail('Belge türü bulunamadı.',404);
  const rows=[['Servis Numarası',r.id],['Kabul Tarihi',new Date(r.createdAt).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'})],['Müşteri / Firma',r.customer],['Müşteri Türü',r.customerType==='dealer'?'Bayi':'Bireysel'],['E-posta',r.email],['Telefon',r.phone],['Adres',r.address],['Ürün',r.product],['Model / Teknik Özellik',r.model],['Seri Numarası',r.serial],['Durum',STATUS_LABEL[r.status]],['Kabul Eden',r.handledBy],['Bildirilen Arıza',r.issue]];
  if(type==='accept') rows.push(['Satın Alma Tarihi',r.purchaseDate],['Aksesuarlar',r.accessories],['Fiziksel Durum',r.condition]);
  else rows.push(['Teknik Personel',r.technician],['Teknik Tespit',r.findings],['Garanti Değerlendirmesi',({pending:'Değerlendiriliyor',warranty:'Garanti kapsamında',outside:'Garanti dışı'})[r.warranty]]);
  if(type==='finish') rows.push(['Yapılan İşlemler',r.work],['Test Sonucu',r.tests]);
  if(r.quoteAmount!=null) rows.push(['Teklif',`${r.quoteNote} — ${formatMoney(r.quoteAmount,quoteCurrency(r))}`]);
  if(r.quoteRate&&quoteCurrency(r)==='EUR')rows.push(['TL karşılığı',formatMoney(Math.round(r.quoteAmount*r.quoteRate.rate*100)/100,'TRY')],['Kur',`TCMB ${safe(r.quoteRate.type||'EUR döviz satış')}: ${r.quoteRate.rate} TL · ${r.quoteRate.date}`]);
  if(r.approval)rows.push(['Teklif Onayı',`${r.approval.by} · ${r.approval.method} · ${r.approval.at}`]);
  if(r.quoteAmount!=null){const paid=(r.payments||[]).reduce((sum,p)=>sum+(p.voidedAt?0:p.amount),0);rows.push(['Alınan Ödeme',formatMoney(paid,quoteCurrency(r))],['Kalan Bakiye',formatMoney(r.quoteAmount-paid,quoteCurrency(r))]);}
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(titles[type])} · ${safe(r.id)}</title><link rel="stylesheet" href="/css/print.css"><script src="/js/print.js" defer></script></head><body><button id="print">Yazdır / PDF Kaydet</button><header><strong>POWERPOOL<small>S E R V I C E H U B</small></strong><span>${safe(r.id)}</span></header><h1>${safe(titles[type])}</h1><table>${rows.map(([k,v])=>`<tr><th>${safe(k)}</th><td>${safe(v === '' || v == null ? '—' : v)}</td></tr>`).join('')}</table>${r.photos.length ? `<h2>Kabul Fotoğrafları</h2><div class="photos">${r.photos.map(p=>`<img src="/api/photos/${p.id}" alt="${safe(p.name)}">`).join('')}</div>`:''}<div class="signatures"><span>Müşteri İmzası</span><span>Servis Yetkilisi İmzası</span></div></body></html>`;
}

export {fail,text,date,photoData,printDocument,token};
