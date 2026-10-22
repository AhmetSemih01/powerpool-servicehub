import {createEmailAccount} from './lib/admin-account.mjs';
import {startRegistration,verifyRegistration,emailAddress,mailReady} from './lib/registration.mjs';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { quoteCurrency, formatMoney } from './js/currency.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(process.env.POWERPOOL_DATA_DIR || join(ROOT, 'data'));
mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(join(DATA, 'servicehub.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES records(id), type TEXT NOT NULL, name TEXT NOT NULL, bytes BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS counters (year INTEGER PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS intake_requests (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, record_id TEXT NOT NULL REFERENCES records(id));`);
db.exec(readFileSync(join(ROOT,'lib','registration.sql'),'utf8'));
let testMailTransport;
export function setMailTransportForTest(value){if(process.env.POWERPOOL_TEST!=='1')throw new Error('Only isolated tests');testMailTransport=value;}
const mailDB={prepare(sql){let values=[];const stmt={bind(...args){values=args;return stmt;},first(){return db.prepare(sql).get(...values)||null;},all(){return {results:db.prepare(sql).all(...values)};},run(){return {meta:{changes:db.prepare(sql).run(...values).changes}};}};return stmt;},batch(statements){return transaction(()=>statements.map(stmt=>stmt.run()));}};
const getSetting = key => { const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; };
const setSetting = (key, value) => db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
const CATALOG_DATA = JSON.parse(readFileSync(join(ROOT,'catalog','products.json'),'utf8'));
const CATALOG = CATALOG_DATA.items;
if(new Set(CATALOG.map(p=>p.product)).size!==CATALOG.length) throw new Error('Katalogda yinelenen ürün adı var.');
const STATUSES = ['received', 'review', 'waiting', 'approved', 'repair', 'repaired', 'tested', 'shipped'];
const STATUS_LABEL = { received:'Kabul Edildi', review:'İncelemede', waiting:'Onay Bekliyor', approved:'Onaylandı', repair:'Onarımda', repaired:'Onarım Tamamlandı', tested:'Test Tamamlandı', shipped:'Teslim Edildi / Kargoya Verildi' };
const sessions = new Map(), attempts = new Map();
const PORT = Number(process.env.PORT || 4174);
const HOST = '127.0.0.1';
const ORIGIN = `http://${HOST}:${PORT}`;
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
const usernameOf=value=>{const name=text(value,'Kullanıcı adı',40,true).toLowerCase();if(!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(name))fail('Kullanıcı adı 3–40 karakter olmalı; a-z, rakam, nokta, tire ve alt çizgi kullanın.');return name;};
const publicUser=(key,a)=>({username:key==='account'?'admin':a.username,name:key==='account'?'Yönetici':a.name,role:key==='account'?'admin':'staff',active:a.active!==false,pending:a.pending===true,rejected:a.rejected===true,email:a.email||'',emailVerified:!!a.emailVerifiedAt});
function passwordHash(password, salt) { return scryptSync(password, salt, 64).toString('hex'); }
function json(res, value, status=200) { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
async function body(req,maxBytes=22*1024*1024) {
  if (!String(req.headers['content-type']).startsWith('application/json')) fail('JSON içerik gerekli.', 415);
  const chunks=[]; let size=0;
  for await (const chunk of req) { size += chunk.length; if(size > maxBytes) fail('İstek boyutu sınırı aşıldı.', 413); chunks.push(chunk); }
  try { const v=JSON.parse(Buffer.concat(chunks).toString()); if(!v || typeof v !== 'object' || Array.isArray(v)) fail('Geçersiz içerik.'); return v; } catch(e) { if(e.status) throw e; fail('Geçersiz JSON.'); }
}
function session(req) {
  const id = /(?:^|;\s*)pp_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  const s = sessions.get(id);
  if (!s || s.until < Date.now()) { if(id) sessions.delete(id); return null; }
  const a=getSetting(s.userId||'account');if(!a||a.active===false||a.pending===true||a.rejected===true){sessions.delete(id);return null;}
  return { ...s, id, userId:s.userId||'account', user:publicUser(s.userId||'account',a) };
}
function requireSession(req) { const s=session(req); if(!s) fail('Oturum açmanız gerekiyor.',401); return s; }
function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result=fn(); db.exec('COMMIT'); return result; } catch(e) { db.exec('ROLLBACK'); throw e; } }
function record(id) { const row=db.prepare('SELECT value FROM records WHERE id=?').get(id); if(!row) fail('Servis kaydı bulunamadı.',404); return JSON.parse(row.value); }
function store(r) { db.prepare('UPDATE records SET value=? WHERE id=?').run(JSON.stringify(r),r.id); }
function staffName(value) { const name=text(value,'Personel',100,true); if(!(getSetting('staff') || []).includes(name)) fail('Önce Ayarlar bölümüne personel ekleyin veya kayıtlı personeli seçin.'); return name; }
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
    return { id:randomBytes(16).toString('hex'), name, type:p.type, bytes };
  });
}
const safe=v=>String(v ?? '—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function printDocument(r,type) {
  const titles={accept:'Servis Kabul Formu',inspect:'Teknik İnceleme Raporu',finish:'Onarım ve Teslim Formu'};
  if(!Object.hasOwn(titles,type)) fail('Belge türü bulunamadı.',404);
  const rows=[['Servis Numarası',r.id],['Kabul Tarihi',new Date(r.createdAt).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'})],['Müşteri / Firma',r.customer],['Müşteri Türü',r.customerType==='dealer'?'Bayi':'Bireysel'],['E-posta',r.email],['Telefon',r.phone],['Adres',r.address],['Ürün',r.product],['Model / Teknik Özellik',r.model],['Seri Numarası',r.serial],['Durum',STATUS_LABEL[r.status]],['Kabul Eden',r.handledBy],['Bildirilen Arıza',r.issue]];
  if(type==='accept') rows.push(['Satın Alma Tarihi',r.purchaseDate],['Aksesuarlar',r.accessories],['Fiziksel Durum',r.condition]);
  else rows.push(['Teknik Personel',r.technician],['Teknik Tespit',r.findings],['Garanti Değerlendirmesi',({pending:'Değerlendiriliyor',warranty:'Garanti kapsamında',outside:'Garanti dışı'})[r.warranty]]);
  if(type==='finish') rows.push(['Yapılan İşlemler',r.work],['Test Sonucu',r.tests]);
  if(r.quoteAmount!=null) rows.push(['Teklif',`${r.quoteNote} — ${formatMoney(r.quoteAmount,quoteCurrency(r))}`]);
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(titles[type])} · ${safe(r.id)}</title><link rel="stylesheet" href="/css/print.css"><script src="/js/print.js" defer></script></head><body><button id="print">Yazdır / PDF Kaydet</button><header><strong>POWERPOOL<small>S E R V I C E H U B</small></strong><span>${safe(r.id)}</span></header><h1>${safe(titles[type])}</h1><table>${rows.map(([k,v])=>`<tr><th>${safe(k)}</th><td>${safe(v === '' || v == null ? '—' : v)}</td></tr>`).join('')}</table>${r.photos.length ? `<h2>Kabul Fotoğrafları</h2><div class="photos">${r.photos.map(p=>`<img src="/api/photos/${p.id}" alt="${safe(p.name)}">`).join('')}</div>`:''}<div class="signatures"><span>Müşteri İmzası</span><span>Servis Yetkilisi İmzası</span></div></body></html>`;
}
export async function handler(req,res){
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','same-origin'); res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try {
    if(req.headers.host!==`${HOST}:${PORT}` && req.headers.host!==`localhost:${PORT}`) fail('Geçersiz sunucu adresi.',403);
    const url=new URL(req.url,ORIGIN), path=url.pathname;
    if(!['GET','POST','PATCH','DELETE'].includes(req.method)) fail('Desteklenmeyen işlem.',405);
    if(req.method!=='GET') {
      const origin=req.headers.origin;
      if(origin && origin!==ORIGIN && origin!==`http://localhost:${PORT}`) fail('İstek kaynağı doğrulanamadı.',403);
      if(req.headers['sec-fetch-site']==='cross-site') fail('Çapraz site isteği engellendi.',403);
    }
    if(path==='/api/session' && req.method==='GET') { const s=session(req); return json(res,{setup:!getSetting('account'),authenticated:!!s,csrf:s?.csrf||null,user:s?.user||null,emailRegistration:mailReady(process.env)}); }
    if(['/api/register','/api/register/verify'].includes(path)&&req.method==='POST'){
      if(!getSetting('account'))fail('İlk kurulum henüz tamamlanmadı.',409);
      const data=await body(req,4096),context={db:mailDB,env:{...process.env,MAIL_TRANSPORT:testMailTransport},data,ip:req.socket.remoteAddress,passwordHash,text};
      return json(res,await (path==='/api/register'?startRegistration(context):verifyRegistration(context)),path==='/api/register'?202:201);
    }
    if(['/api/setup','/api/login'].includes(path) && req.method==='POST') {
      const key=req.socket.remoteAddress, now=Date.now(); const a=attempts.get(key);
      if(a && a.until>now && a.count>=10) fail('Çok fazla giriş denemesi. 15 dakika sonra yeniden deneyin.',429);
      attempts.set(key,{count:a && a.until>now ? a.count+1 : 1,until:a && a.until>now ? a.until : now+900000});
      const data=await body(req), password=text(data.password,'Şifre',200,true);
      const identifier=path==='/api/setup'?'admin':text(data.email||data.username||'admin','E-posta veya kullanıcı adı',254,true);
      const loginName=identifier.includes('@')?null:usernameOf(identifier);
      const emailUser=loginName===null?db.prepare('SELECT user_key FROM account_emails WHERE email=?').get(emailAddress(identifier)):null;
      const loginKey=loginName===null?(emailUser?.user_key||'user:unknown-email'):loginName==='admin'?'account':'user:'+loginName;
      if(path==='/api/setup') {
        if(getSetting('account')) fail('Kurulum zaten tamamlandı.',409);
        if(password.length<8) fail('En az 8 karakterli bir şifre belirleyin.');
        const salt=randomBytes(24).toString('hex'); setSetting('account',{salt,hash:passwordHash(password,salt)});
      } else {
        if(!getSetting('account'))fail('Önce ilk kurulumu tamamlayın.',409);
        const a=getSetting(loginKey),check=a||{salt:'invalid-account-salt',hash:'0'.repeat(128)};
        const valid=timingSafeEqual(Buffer.from(check.hash,'hex'),Buffer.from(passwordHash(password,check.salt),'hex'));
        if(!a||!valid)fail('E-posta, kullanıcı adı veya şifre hatalı.',401);
          if(a.pending===true)fail('E-posta adresiniz doğrulandı. Hesabınız yönetici onayı bekliyor.',403);
          if(a.rejected===true)fail('Başvurunuz yönetici tarafından reddedilmiş. Yöneticiyle iletişime geçin.',403);
          if(a.active===false)fail('Hesabınız pasif. Yöneticiyle iletişime geçin.',403);
      }
      attempts.delete(key);
      for(const [id,s] of sessions) if(s.until<Date.now()) sessions.delete(id);
      if(sessions.size>=100) sessions.delete(sessions.keys().next().value);
      const id=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex'); sessions.set(id,{csrf,userId:loginKey,until:Date.now()+12*3600000});
      res.setHeader('Set-Cookie',`pp_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
      return json(res,{csrf,user:publicUser(loginKey,getSetting(loginKey))});
    }
    if(path.startsWith('/api/') || path==='/print') {
      const s=requireSession(req);
      if(req.method!=='GET' && req.headers['x-csrf-token']!==s.csrf) fail('Güvenlik anahtarı geçersiz. Sayfayı yenileyin.',403);
      if(path==='/api/logout' && req.method==='POST') { sessions.delete(s.id); res.setHeader('Set-Cookie','pp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res,{ok:true}); }
      const adminOnly=path==='/api/users'||path.startsWith('/api/users/')||path==='/api/backup'||(path==='/api/settings'&&req.method==='PATCH')||req.method==='DELETE';
      if(adminOnly&&s.user.role!=='admin')fail('Bu işlem için yönetici yetkisi gerekiyor.',403);
      if(path==='/api/users'&&req.method==='GET')return json(res,db.prepare("SELECT key,value FROM settings WHERE key LIKE 'user:%' ORDER BY key").all().map(row=>publicUser(row.key,JSON.parse(row.value))));
      if(path==='/api/users'&&req.method==='POST'){
        const data=await body(req);
        if(Object.hasOwn(data,'email')){const {key,account}=await createEmailAccount({db:mailDB,data,name:staffName(data.name),passwordHash,text});return json(res,publicUser(key,account),201);}
        const username=usernameOf(data.username),name=staffName(data.name),password=text(data.password,'Şifre',200,true),key='user:'+username;
        if(username==='admin'||getSetting(key))fail('Bu kullanıcı adı zaten kullanılıyor.',409);
        if(password.length<8)fail('En az 8 karakterli bir şifre belirleyin.');if(password!==data.confirmPassword)fail('Şifreler aynı değil.');
        if(db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'user:%' AND COALESCE(json_extract(value,'$.pending'),0)=0 AND COALESCE(json_extract(value,'$.rejected'),0)=0").get().n>=40)fail('En fazla 40 kullanıcı eklenebilir.');
        const salt=randomBytes(24).toString('hex'),account={username,name,active:true,salt,hash:passwordHash(password,salt)};setSetting(key,account);return json(res,publicUser(key,account),201);
      }
      if(path.startsWith('/api/users/')&&req.method==='PATCH'){
        const username=usernameOf(decodeURIComponent(path.slice('/api/users/'.length)));if(username==='admin')fail('Yönetici hesabı burada değiştirilemez.');
        const key='user:'+username,account=getSetting(key);if(!account)fail('Kullanıcı bulunamadı.',404);
        const data=await body(req),next={...account};
        if(data.approve===true){
          if(!account.pending&&!account.rejected)fail('Bu hesap zaten onaylanmış.');
          if(db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'user:%' AND COALESCE(json_extract(value,'$.pending'),0)=0 AND COALESCE(json_extract(value,'$.rejected'),0)=0").get().n>=40)fail('En fazla 40 kullanıcı eklenebilir.');
          next.name=staffName(data.name);next.pending=false;next.rejected=false;next.active=true;
        }
        if(data.reject===true){if(!account.pending)fail('Bu hesap onay beklemiyor.');next.pending=false;next.rejected=true;next.active=false;}
        if(data.approve===true&&data.reject===true)fail('Tek bir işlem seçin.');
        if(Object.hasOwn(data,'active')){if(account.pending||account.rejected)fail('Başvuruyu önce personel eşleştirerek onaylayın.');if(typeof data.active!=='boolean')fail('Geçerli hesap durumu seçin.');next.active=data.active;}
        if(Object.hasOwn(data,'password')){const password=text(data.password,'Şifre',200,true);if(password.length<8)fail('En az 8 karakterli bir şifre belirleyin.');if(password!==data.confirmPassword)fail('Şifreler aynı değil.');next.salt=randomBytes(24).toString('hex');next.hash=passwordHash(password,next.salt);}
        if(!Object.hasOwn(data,'active')&&!Object.hasOwn(data,'password')&&data.approve!==true&&data.reject!==true)fail('Değişiklik seçin.');
        setSetting(key,next);for(const [id,item] of sessions)if(item.userId===key)sessions.delete(id);return json(res,publicUser(key,next));
      }
      if(path==='/api/password' && req.method==='PATCH') {
        const data=await body(req),current=text(data.currentPassword,'Mevcut şifre',200,true),next=text(data.newPassword,'Yeni şifre',200,true);
        if(next.length<8) fail('En az 8 karakterli bir şifre belirleyin.');
        if(next!==data.confirmPassword) fail('Yeni şifreler aynı değil.');
        const key='password:'+s.id,now=Date.now(),attempt=attempts.get(key);
        if(attempt&&attempt.until>now&&attempt.count>=10) fail('Çok fazla şifre denemesi. 15 dakika sonra yeniden deneyin.',429);
        attempts.set(key,{count:attempt&&attempt.until>now?attempt.count+1:1,until:attempt&&attempt.until>now?attempt.until:now+900000});
        const account=getSetting(s.userId);
        if(!timingSafeEqual(Buffer.from(account.hash,'hex'),Buffer.from(passwordHash(current,account.salt),'hex'))) fail('Mevcut şifre yanlış.');
        const salt=randomBytes(24).toString('hex');setSetting(s.userId,{...account,salt,hash:passwordHash(next,salt)});
        for(const [id,item] of sessions) if(id!==s.id&&(item.userId||'account')===s.userId) sessions.delete(id);
        attempts.delete(key);return json(res,{ok:true});
      }
      if(path==='/api/settings' && req.method==='GET') return json(res,{user:s.user,staff:s.user.role==='staff'?[s.user.name]:getSetting('staff')||[],catalog:CATALOG,brands:CATALOG_DATA.brands,categories:CATALOG_DATA.categories,catalogVersion:CATALOG_DATA.version,statuses:STATUS_LABEL});
      if(path==='/api/settings' && req.method==='PATCH') {
        const data=await body(req);let staff;
        if(Object.hasOwn(data,'addStaff')){
          const name=text(data.addStaff,'Personel adı',100,true),current=getSetting('staff')||[];
          if(current.some(item=>item.toLocaleLowerCase('tr-TR')===name.toLocaleLowerCase('tr-TR')))fail('Bu personel zaten listede.');
          if(current.length>=40)fail('En fazla 40 personel eklenebilir.');
          staff=[...current,name];
        }else if(Object.hasOwn(data,'removeStaff')){
          const name=text(data.removeStaff,'Personel adı',100,true),current=getSetting('staff')||[];
          if(!current.includes(name))fail('Personel zaten kaldırılmış olabilir. Listeyi yenileyin.',409);
          staff=current.filter(item=>item!==name);
        }else{
          if(!Array.isArray(data.staff)||data.staff.length>40)fail('En fazla 40 personel eklenebilir.');
          staff=[...new Set(data.staff.map(v=>text(v,'Personel adı',100,true)))];
        }
        setSetting('staff',staff);return json(res,{staff});
      }
      if(path==='/api/records' && req.method==='GET') return json(res,db.prepare('SELECT value FROM records ORDER BY rowid DESC').all().map(row=>JSON.parse(row.value)));
      if(path==='/api/records' && req.method==='POST') {
        const data=await body(req);
        const requestKey=text(data.requestKey,'İstek anahtarı',50,true);
        if(!/^[a-f0-9-]{36}$/.test(requestKey)) fail('Geçersiz istek anahtarı.');
        const fingerprint=createHash('sha256').update(JSON.stringify(data)).digest('hex');
        const existing=db.prepare('SELECT * FROM intake_requests WHERE key=?').get(requestKey);
        if(existing) { if(existing.fingerprint!==fingerprint) fail('Bu istek daha önce farklı içerikle kaydedilmiş. Kayıt listesini kontrol edin.',409); return json(res,record(existing.record_id)); }
        const product=CATALOG.find(p=>p.product===data.product); if(!product) fail('Katalogdan bir ürün seçin.');
        if(data.brand!=null&&data.brand!==product.brand) fail('Seçilen marka ve model uyuşmuyor.');
        const r={customer:text(data.customer,'Müşteri',100,true),email:text(data.email,'E-posta',150),phone:text(data.phone,'Telefon',40,true),address:text(data.address,'Adres',500),customerType:data.customerType,product:product.product,brand:product.brand,model:product.model,category:product.category,catalogSource:product.source,catalogVersion:CATALOG_DATA.version,serial:text(data.serial,'Seri numarası',100,true),handledBy:s.user.role==='staff'?s.user.name:staffName(data.handledBy),issue:text(data.issue,'Arıza açıklaması',1500,true),purchaseDate:date(data.purchaseDate),accessories:text(data.accessories,'Aksesuarlar',300),condition:text(data.condition,'Fiziksel durum',1000),status:'received',createdAt:new Date().toISOString(),version:1,quoteAmount:null,quoteNote:'',technician:'',warranty:'pending',findings:'',work:'',tests:''};
        if(r.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) fail('Geçerli bir e-posta adresi girin.');
        if(!/^[+\d\s().-]{7,40}$/.test(r.phone) || r.phone.replace(/\D/g,'').length<7) fail('Geçerli bir telefon numarası girin.');
        if(!['individual','dealer'].includes(r.customerType)) fail('Müşteri türü geçersiz.');
        const photos=photoData(data.photos||[]);
        transaction(()=>{
          const year=Number(new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'}).slice(0,4));
          db.prepare('INSERT INTO counters VALUES(?,1) ON CONFLICT(year) DO UPDATE SET value=value+1').run(year);
          const count=db.prepare('SELECT value FROM counters WHERE year=?').get(year).value;
          r.id=`PWR-SRV-${year}-${String(count).padStart(4,'0')}`;
          r.photos=photos.map(({id,name,type})=>({id,name,type}));
          r.history=[{at:r.createdAt,staff:r.handledBy,action:'Servis kaydı oluşturuldu',status:r.status}];
          db.prepare('INSERT INTO records VALUES(?,?)').run(r.id,JSON.stringify(r));
          for(const p of photos) db.prepare('INSERT INTO photos VALUES(?,?,?,?,?)').run(p.id,r.id,p.type,p.name,p.bytes);
          db.prepare('INSERT INTO intake_requests VALUES(?,?,?)').run(requestKey,fingerprint,r.id);
        });
        return json(res,r,201);
      }
      const match=/^\/api\/records\/(PWR-SRV-\d{4}-\d+)$/.exec(path);
      if(match && req.method==='DELETE') {
        const data=await body(req);
        transaction(()=>{
          const r=record(match[1]);
          if(data.version!==r.version) fail('Bu kayıt başka bir pencerede güncellendi. Detayı kapatıp yeniden açın.',409);
          staffName(data.staff);
          if(data.confirmId!==r.id) fail('Silmek için servis numarasını doğrulayın.');
          db.prepare('DELETE FROM photos WHERE record_id=?').run(r.id);
          db.prepare('DELETE FROM intake_requests WHERE record_id=?').run(r.id);
          db.prepare('DELETE FROM records WHERE id=?').run(r.id);
        });
        return json(res,{ok:true,id:match[1]});
      }
      if(match && req.method==='PATCH') {
        const data=await body(req),r=record(match[1]);
        if(data.version!==r.version) fail('Bu kayıt başka bir pencerede güncellendi. Detayı kapatıp yeniden açın.',409);
        const staff=s.user.role==='staff'?s.user.name:staffName(data.staff),now=new Date().toISOString(); let action;
        if(data.action==='status') {
          if(!STATUSES.includes(data.status)) fail('Geçersiz servis durumu.');
          if(data.status==='approved') fail('Müşteri onayını teklif bölümünden kaydedin.');
          if(data.status==='waiting' && r.quoteAmount==null) fail('Önce bir teklif oluşturun.');
          if(['repair','repaired','tested','shipped'].includes(data.status) && r.quoteAmount!=null && !r.approval) fail('Ücretli onarıma başlamadan önce müşteri onayı kaydedilmeli.');
          r.status=data.status; action='Durum güncellendi';
        } else if(data.action==='quote') {
          if(typeof data.amount!=='number'||!Number.isFinite(data.amount)||data.amount<0||data.amount>1e9||Math.abs(data.amount*100-Math.round(data.amount*100))>0.00001) fail('En fazla iki ondalıklı geçerli bir tutar girin.');
          const currency=data.currency ?? quoteCurrency(r);
          if(!['TRY','EUR'].includes(currency)) fail('Para birimi TL (TRY) veya Euro (EUR) olmalıdır.');
          r.quoteAmount=data.amount; r.quoteCurrency=currency; r.quoteNote=text(data.note,'Teklif açıklaması',1000,true); r.status='waiting'; r.approval=null; action=`${currency==='TRY'?'TL':'Euro'} onarım teklifi oluşturuldu`;
        } else if(data.action==='approve') {
          if(r.status!=='waiting'||r.quoteAmount==null) fail('Onay bekleyen bir teklif bulunmuyor.');
          r.approval={by:text(data.approvedBy,'Onay veren kişi',100,true),method:text(data.method,'Onay yöntemi',100,true),at:now,recordedBy:staff}; r.status='approved'; action=`Müşteri onayı kaydedildi: ${r.approval.by} (${r.approval.method})`;
        } else if(data.action==='notes') {
          r.technician=staff; r.findings=text(data.findings,'Teknik tespit',3000); r.work=text(data.work,'Yapılan işlemler',3000); r.tests=text(data.tests,'Test sonucu',2000);
          if(!['pending','warranty','outside'].includes(data.warranty)) fail('Garanti değerlendirmesi geçersiz.');
          r.warranty=data.warranty; action='Teknik inceleme ve onarım notları kaydedildi';
        } else fail('Geçersiz işlem.');
        r.history.push({at:now,staff,action,status:r.status}); r.version++; r.updatedAt=now; store(r); return json(res,r);
      }
      const photo=/^\/api\/photos\/([a-f0-9]{32})$/.exec(path);
      if(photo && req.method==='GET') { const p=db.prepare('SELECT * FROM photos WHERE id=?').get(photo[1]); if(!p) fail('Fotoğraf bulunamadı.',404); res.writeHead(200,{'Content-Type':p.type}); return res.end(Buffer.from(p.bytes)); }
      if(path==='/api/backup' && req.method==='GET') {
        // SQLite's VACUUM INTO produces a consistent snapshot, including photo BLOBs.
        const file=join(DATA,`backup-${randomBytes(12).toString('hex')}.sqlite`);
        const { unlinkSync }=await import('node:fs');
        try { db.prepare('VACUUM INTO ?').run(file); const bytes=readFileSync(file); res.writeHead(200,{'Content-Type':'application/vnd.sqlite3','Content-Disposition':`attachment; filename="powerpool-${new Date().toISOString().slice(0,10)}.sqlite"`}); return res.end(bytes); } finally { try { unlinkSync(file); } catch {} }
      }
      if(path==='/print' && req.method==='GET') { const r=record(url.searchParams.get('id')); const html=printDocument(r,url.searchParams.get('type')); res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); return res.end(html); }
      fail('İşlem bulunamadı.',404);
    }
    if(req.method!=='GET') fail('İşlem bulunamadı.',404);
    const allowed = path==='/' ? 'index.html' : /^\/(css|js|images)\/[a-zA-Z0-9_.-]+$/.test(path) ? path.slice(1) : null;
    if(!allowed) fail('Dosya bulunamadı.',404);
    let bytes; try { bytes=readFileSync(join(ROOT,allowed)); } catch { fail('Dosya bulunamadı.',404); }
    res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'})[extname(allowed)]||'application/octet-stream'}); res.end(bytes);
  } catch(e) { if(!res.headersSent) json(res,{error:e.status?e.message:'İşlem tamamlanamadı. Veriler değiştirilmedi; yeniden deneyin.'},e.status||500); else res.end(); if(!e.status) console.error(e); }
}
const server = http.createServer(handler);
if(process.env.POWERPOOL_TEST!=='1') server.listen(PORT,HOST,()=>console.log(`POWERPOOL ServiceHub: ${ORIGIN}`));
export function closeDatabase(){db.close();}
function shutdown(){server.close(()=>{db.close();process.exit(0);});}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
