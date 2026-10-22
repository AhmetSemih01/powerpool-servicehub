import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import worker from '../src/worker.mjs';

const dir=mkdtempSync(join(tmpdir(),'powerpool-cloud-'));
let sqlite=new DatabaseSync(join(dir,'test.sqlite'));
sqlite.exec(readFileSync(new URL('../migrations/0001_servicehub.sql',import.meta.url),'utf8'));
sqlite.exec(readFileSync(new URL('../migrations/0002_user_sessions.sql',import.meta.url),'utf8'));
sqlite.exec(readFileSync(new URL('../migrations/0003_email_verification.sql',import.meta.url),'utf8'));
sqlite.exec(readFileSync(new URL('../migrations/0004_operations.sql',import.meta.url),'utf8'));
class DB {
  withSession(){return this;}
  prepare(sql){
    let values=[];const result={
      bind(...args){values=args;return result;},
      async first(){return sqlite.prepare(sql).get(...values)||null;},
      async all(){return {results:sqlite.prepare(sql).all(...values)};},
      async run(){const r=sqlite.prepare(sql).run(...values);return {meta:{changes:r.changes}};}
    };return result;
  }
  async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}
}
const photos=new Map();let failPut=false,failDelete=false;
const env={DB:new DB(),SETUP_TOKEN:'test-only-setup-key-not-production',PHOTOS:{
  async put(id,bytes){if(failPut)throw new Error('quota');photos.set(id,Uint8Array.from(bytes));},
  async get(id){return photos.get(id)?.buffer||null;},
  async delete(id){if(failDelete)throw new Error('quota');photos.delete(id);}
},ASSETS:{async fetch(){return new Response('<!doctype html><title>POWERPOOL</title>');}}};
env.RATE_TRANSPORT={async fetch(){const d=new Date(),day=String(d.getUTCDate()).padStart(2,'0'),month=String(d.getUTCMonth()+1).padStart(2,'0');return new Response(`<Tarih_Date Tarih="${day}.${month}.${d.getUTCFullYear()}"><Currency Kod="EUR"><Unit>1</Unit><BanknoteSelling>40.1234</BanknoteSelling></Currency></Tarih_Date>`);}};
let cookie='',csrf='',record;
const jobs=[];
const payload=()=>({requestKey:crypto.randomUUID(),customer:'Bulut Test',customerType:'individual',email:'test@example.com',phone:'05551234567',product:'iGarden M1-80',serial:'TEST-CLOUD',handledBy:'Test Personel',issue:'Motor çalışmıyor',photos:[{name:'test.png',type:'image/png',data:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')}]});
async function request(path,method='GET',data,extra={}){
  const res=await worker.fetch(new Request('https://service.example'+path,{method,headers:{cookie,'x-csrf-token':csrf,'cf-connecting-ip':'192.0.2.1',...(data?{'content-type':'application/json'}:{}),...extra},...(data?{body:JSON.stringify(data)}:{})}),env,{waitUntil(p){jobs.push(p);}});
  let parsed;try{parsed=await res.json();}catch{parsed=null;}
  return {status:res.status,headers:res.headers,data:parsed};
}
test('kurulum anahtarı olmadan hesap sahiplenilemez; varlıklar ve oturum',async()=>{
  assert.equal((await request('/api/records')).status,401);
  assert.equal((await request('/api/session')).data.setup,true);
  assert.equal((await request('/api/setup','POST',{password:'Strong-Test-Password-123'})).status,403);
  const r=await request('/api/setup','POST',{password:'Strong-Test-Password-123',setupToken:env.SETUP_TOKEN});
  assert.equal(r.status,200);assert.ok(r.headers.get('set-cookie').includes('Secure'));
  cookie=r.headers.get('set-cookie').split(';')[0];csrf=r.data.csrf;
  assert.equal((await request('/api/setup','POST',{password:'Strong-Test-Password-123',setupToken:env.SETUP_TOKEN})).status,409);
  assert.equal((await request('/api/session')).data.authenticated,true);
});
test('yalnızca genel TCMB kuru oturumsuz okunur; müşteri kayıtları korunur',async()=>{
  const rate=await request('/api/rates','GET',undefined,{cookie:''});assert.equal(rate.status,200);assert.equal(rate.data.rate,40.1234);assert.equal(rate.data.source,'TCMB');
  assert.equal((await request('/api/records','GET',undefined,{cookie:''})).status,401);
  assert.equal((await request('/api/audit','GET',undefined,{cookie:''})).status,401);
});

test('katalog korunur; personel, CSRF, kaynak ve özel dosyalar',async()=>{
  assert.equal((await request('/api/settings')).data.catalog.length,495);
  assert.equal((await request('/api/settings','PATCH',{staff:['Test Personel']},{'x-csrf-token':'wrong'})).status,403);
  assert.equal((await request('/api/settings','PATCH',{staff:['Test Personel']},{origin:'https://attacker.example'})).status,403);
  assert.equal((await request('/api/settings','PATCH',{staff:['Test Personel']})).status,200);
  for(const path of ['/wrangler.jsonc','/src/worker.mjs','/catalog/products.json'])assert.equal((await request(path)).status,404);
});
test('fotoğraflı kayıt, yeniden gönderim ve numara atomik kaydedilir',async()=>{
  const data=payload();const r=await request('/api/records','POST',data);assert.equal(r.status,201);record=r.data;
  assert.match(record.id,/^PWR-SRV-\d{4}-0001$/);assert.equal(photos.size,1);
  const again=await request('/api/records','POST',data);assert.equal(again.status,200);assert.equal(again.data.id,record.id);
  assert.equal((await request('/api/records','POST',{...data,issue:'farklı'})).status,409);
  const pic=await worker.fetch(new Request('https://service.example/api/photos/'+record.photos[0].id,{headers:{cookie}}),env,{});
  assert.equal(pic.status,200);assert.equal((await pic.arrayBuffer()).byteLength,8);
  assert.equal((await request('/api/photos/'+record.photos[0].id,'GET',undefined,{cookie:''})).status,401);
});
test('KV kota hatası yarım servis kaydı veya harcanmış numara bırakmaz',async()=>{
  failPut=true;assert.equal((await request('/api/records','POST',payload())).status,503);failPut=false;
  assert.equal((await request('/api/records')).data.length,1);
  const r=await request('/api/records','POST',{...payload(),photos:[]});assert.equal(r.status,201);assert.match(r.data.id,/-0002$/);
});
test('Euro teklif, TCMB TL karşılığı, müşteri onayı, eşzamanlı düzenleme ve belgeler',async()=>{
  for(const currency of ['EUR']){
    const q=await request('/api/records/'+record.id,'PATCH',{version:record.version,staff:'Test Personel',action:'quote',amount:125.50,currency,note:'İşçilik'});
    assert.equal(q.status,200);record=q.data;assert.equal(record.quoteCurrency,currency);assert.equal(record.approval,null);
    for(const type of ['accept','inspect','finish','quote']){
      const doc=await worker.fetch(new Request(`https://service.example/print?id=${record.id}&type=${type}`,{headers:{cookie}}),env,{});
      assert.equal(doc.status,200);const html=await doc.text();assert.ok(html.includes('€125,50'));assert.ok(html.includes('TCMB EUR efektif satış'));assert.ok(html.includes('₺5.035,49'));
    }
    const a=await request('/api/records/'+record.id,'PATCH',{version:record.version,staff:'Test Personel',action:'approve',approvedBy:'Müşteri',method:'Telefon'});assert.equal(a.status,200);record=a.data;
  }
  assert.equal((await request('/api/records/'+record.id,'PATCH',{version:1,staff:'Test Personel',action:'status',status:'review'})).status,409);
});
test('yeniden başlatma sonrasında oturum, kayıt, para birimi ve fotoğraf korunur',async()=>{
  sqlite.close();sqlite=new DatabaseSync(join(dir,'test.sqlite'));sqlite.exec('PRAGMA foreign_keys=ON');env.DB=new DB();
  assert.equal((await request('/api/session')).data.authenticated,true);
  assert.equal((await request('/api/records')).data.find(r=>r.id===record.id).quoteCurrency,'EUR');
  const out=await request('/api/backup');assert.equal(out.status,200);assert.equal(out.data.format,'powerpool-cloud-backup-v1');
  assert.equal(out.data.records.length,2);assert.equal(out.data.photos.length,1);assert.equal(Buffer.from(out.data.photos[0].data,'base64').length,8);
  assert.ok(!JSON.stringify(out.data).includes('Strong-Test-Password'));
});
test('silmede sürüm ve onay doğrulanır; KV silinemese de fotoğraf erişimi derhal kesilir',async()=>{
  const path='/api/records/'+record.id,data={version:record.version,staff:'Test Personel',confirmId:record.id};
  assert.equal((await request(path,'DELETE',{...data,version:1})).status,409);
  assert.equal((await request(path,'DELETE',{...data,confirmId:'yanlış'})).status,400);
  failDelete=true;
  assert.equal((await request(path,'DELETE',data)).status,200);await Promise.all(jobs);
  assert.equal((await request('/api/photos/'+record.photos[0].id)).status,404);
  assert.equal((await request(path,'DELETE',data)).status,404);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM photo_cleanup').get().n,1);
  failDelete=false;
  await request('/api/records','POST',{...payload(),photos:[]});await Promise.all(jobs);
  assert.equal(photos.size,0);assert.equal(sqlite.prepare('SELECT count(*) n FROM photo_cleanup').get().n,0);
  assert.ok(sqlite.prepare('SELECT value FROM counters').get().value>=3);
});
test('çıkış kalıcı oturumu geçersiz kılar; giriş denemeleri sınırlandırılır',async()=>{
  assert.equal((await request('/api/logout','POST',{})).status,200);
  assert.equal((await request('/api/records')).status,401);
  for(let i=0;i<10;i++)assert.equal((await request('/api/login','POST',{password:'wrong'},{'cf-connecting-ip':'192.0.2.2'})).status,401);
  assert.equal((await request('/api/login','POST',{password:'wrong'},{'cf-connecting-ip':'192.0.2.2'})).status,429);
});
test('8 karakter şifre değişimi mevcut şifreyi doğrular ve diğer oturumları kapatır',async()=>{
  const login=await request('/api/login','POST',{password:'Strong-Test-Password-123'},{'cf-connecting-ip':'192.0.2.3'});
  assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];csrf=login.data.csrf;
  const second=await request('/api/login','POST',{password:'Strong-Test-Password-123'},{'cf-connecting-ip':'192.0.2.3'});
  const otherCookie=second.headers.get('set-cookie').split(';')[0];
  const change={currentPassword:'Strong-Test-Password-123',newPassword:'Eight!26',confirmPassword:'Eight!26'};
  assert.equal(change.newPassword.length,8);
  assert.equal((await request('/api/password','PATCH',change,{cookie:''})).status,401);
  assert.equal((await request('/api/password','PATCH',change,{'x-csrf-token':'wrong'})).status,403);
  assert.equal((await request('/api/password','PATCH',{...change,newPassword:'1234567',confirmPassword:'1234567'})).status,400);
  assert.equal((await request('/api/password','PATCH',{...change,confirmPassword:'mismatch'})).status,400);
  assert.equal((await request('/api/password','PATCH',{...change,currentPassword:'incorrect'})).status,400);
  assert.equal((await request('/api/password','PATCH',change)).status,200);
  assert.equal((await request('/api/session')).data.authenticated,true);
  assert.equal((await request('/api/session','GET',undefined,{cookie:otherCookie})).data.authenticated,false);
  assert.equal((await request('/api/login','POST',{password:change.currentPassword},{'cf-connecting-ip':'192.0.2.3'})).status,401);
  assert.equal((await request('/api/login','POST',{password:change.newPassword},{'cf-connecting-ip':'192.0.2.3'})).status,200);
  const account=JSON.parse(sqlite.prepare("SELECT value FROM settings WHERE key='account'").get().value);
  assert.ok(!JSON.stringify(account).includes(change.newPassword));
});

test('personeli tek tek ve son personeli silme geçmiş servis kayıtlarını değiştirmez',async()=>{
  const before=(await request('/api/records')).data;
  assert.equal((await request('/api/settings','PATCH',{staff:['Test Personel','İkinci Personel']})).status,200);
  assert.equal((await request('/api/settings','PATCH',{removeStaff:'Test Personel'},{'x-csrf-token':'wrong'})).status,403);
  assert.equal((await request('/api/settings','PATCH',{removeStaff:'Olmayan'})).status,409);
  const first=await request('/api/settings','PATCH',{removeStaff:'İkinci Personel'});assert.equal(first.status,200);assert.deepEqual(first.data.staff,['Test Personel']);
  const last=await request('/api/settings','PATCH',{removeStaff:'Test Personel'});assert.equal(last.status,200);assert.deepEqual(last.data.staff,[]);
  assert.deepEqual((await request('/api/records')).data,before);
  assert.equal((await request('/api/records','POST',payload())).status,400);
});

test('tek isimle personel ekleme ve e-postasız hızlı kabul',async()=>{
  assert.equal((await request('/api/settings','PATCH',{addStaff:'Test Personel'})).status,200);
  assert.equal((await request('/api/settings','PATCH',{addStaff:'Test Personel'})).status,400);
  assert.equal((await request('/api/settings','PATCH',{addStaff:'   '})).status,400);
  const data={...payload(),photos:[]};delete data.email;
  const created=await request('/api/records','POST',data);assert.equal(created.status,201);assert.equal(created.data.email,'');
  assert.equal((await request('/api/records','POST',{...payload(),email:'invalid'})).status,400);
  await request('/api/settings','PATCH',{staff:Array.from({length:40},(_,i)=>'Personel '+i)});
  assert.equal((await request('/api/settings','PATCH',{addStaff:'Fazladan Personel'})).status,400);
});

const userCookie=r=>r.headers.get('set-cookie').split(';')[0];

test('kullanıcı hesapları: giriş, yetkiler, kişisel şifre, sıfırlama ve pasife alma',async()=>{
  const adminCookie=cookie,adminCsrf=csrf;
  await request('/api/settings','PATCH',{staff:['Hesap Test Personeli']});
  const user={username:'teknisyen.1',role:'admin',name:'Hesap Test Personeli',password:'Personel!2026',confirmPassword:'Personel!2026'};
  assert.equal((await request('/api/users','POST',user,{'x-csrf-token':'wrong'})).status,403);
  assert.equal((await request('/api/users','POST',{...user,username:'admin'})).status,409);
  assert.equal((await request('/api/users','POST',{...user,username:'x'})).status,400);
  assert.equal((await request('/api/users','POST',{...user,password:'short',confirmPassword:'short'})).status,400);
  assert.equal((await request('/api/users','POST',{...user,confirmPassword:'different'})).status,400);
  const created=await request('/api/users','POST',user);assert.equal(created.status,201);assert.equal(created.data.role,'staff');assert.equal(created.data.hash,undefined);
  assert.equal((await request('/api/users','POST',{...user,username:'TEKNISYEN.1'})).status,409);
  const list=await request('/api/users');assert.equal(list.data.length,1);assert.ok(!JSON.stringify(list.data).includes('salt'));assert.ok(!JSON.stringify(list.data).includes(user.password));
  assert.equal((await request('/api/login','POST',{username:user.username,password:'wrong'})).status,401);
  const login=await request('/api/login','POST',{username:'TEKNISYEN.1',password:user.password});assert.equal(login.status,200);
  cookie=userCookie(login);csrf=login.data.csrf;
  assert.equal((await request('/api/session')).data.user.username,user.username);
  assert.equal((await request('/api/users')).status,403);
  assert.equal((await request('/api/users','POST',{...user,username:'other'})).status,403);
  assert.equal((await request('/api/users/'+user.username,'PATCH',{active:false})).status,403);
  assert.equal((await request('/api/backup')).status,403);
  assert.equal((await request('/api/settings','PATCH',{staff:[]})).status,403);
  assert.equal((await request('/api/records/not-a-real-record','DELETE',{})).status,403);
  const config=(await request('/api/settings')).data;assert.deepEqual(config.staff,[user.name]);
  const data={...payload(),handledBy:'Sahte Personel',photos:[]};
  const r=await request('/api/records','POST',data);assert.equal(r.status,201);assert.equal(r.data.handledBy,user.name);
  const note=await request('/api/records/'+r.data.id,'PATCH',{version:r.data.version,staff:'Başka Personel',action:'notes',technician:'Hesap Test Personeli',warranty:'pending',findings:'Test',work:'Test',tests:'Test'});assert.equal(note.status,200);assert.equal(note.data.history.at(-1).staff,user.name);
  const second=await request('/api/login','POST',{username:user.username,password:user.password});assert.equal(second.status,200);const otherCookie=userCookie(second);
  const ownPassword={currentPassword:user.password,newPassword:'Kisisel!2026',confirmPassword:'Kisisel!2026'};
  assert.equal((await request('/api/password','PATCH',ownPassword)).status,200);
  assert.equal((await request('/api/session','GET',undefined,{cookie:adminCookie})).data.authenticated,true);
  assert.equal((await request('/api/session','GET',undefined,{cookie:otherCookie})).data.authenticated,false);
  const staffCookie=cookie;
  cookie=adminCookie;csrf=adminCsrf;
  const reset={password:'Yenilenen!2026',confirmPassword:'Yenilenen!2026'};
  assert.equal((await request('/api/users/'+user.username,'PATCH',reset)).status,200);
  assert.equal((await request('/api/session','GET',undefined,{cookie:staffCookie})).data.authenticated,false);
  assert.equal((await request('/api/login','POST',{username:user.username,password:ownPassword.newPassword})).status,401);
  const fresh=await request('/api/login','POST',{username:user.username,password:reset.password});assert.equal(fresh.status,200);
  assert.equal((await request('/api/users/'+user.username,'PATCH',{active:false})).status,200);
  assert.equal((await request('/api/session','GET',undefined,{cookie:userCookie(fresh)})).data.authenticated,false);
  assert.equal((await request('/api/login','POST',{username:user.username,password:reset.password})).status,403);
  assert.equal((await request('/api/users/'+user.username,'PATCH',{active:true})).status,200);
  assert.equal((await request('/api/login','POST',{username:user.username,password:reset.password})).status,200);
  assert.equal((await request('/api/session','GET',undefined,{cookie:userCookie(fresh)})).data.authenticated,false);
  assert.equal((await request('/api/users/admin','PATCH',{active:false})).status,400);
});


test('e-postayla kayıt: kod doğrulanmadan hesap açılmaz; onay ve ret korunur',async()=>{
  const adminCookie=cookie,adminCsrf=csrf;
  env.BREVO_API_KEY='test-only-key';env.MAIL_FROM='sender@example.com';const sentMails=[];env.MAIL_TRANSPORT={async fetch(url,options){assert.equal(url,'https://api.brevo.com/v3/smtp/email');sentMails.push(JSON.parse(options.body));return Response.json({messageId:'test-message'});}};
  const reg=(data,ip='203.0.113.20')=>request('/api/register','POST',data,{cookie:'','cf-connecting-ip':ip});
  const applicant={name:'Başvuran Kişi',email:'Basvuran.1@example.com',password:'Basvuru!2026',confirmPassword:'Basvuru!2026',active:true,role:'admin',pending:false};
  assert.equal((await request('/api/register','POST',applicant,{cookie:'',origin:'https://attacker.example','cf-connecting-ip':'203.0.113.21'})).status,403);
  for(const [i,change] of [{email:'invalid'},{name:''},{password:'short',confirmPassword:'short'},{confirmPassword:'different'}].entries())assert.equal((await reg({...applicant,...change},'203.0.113.'+(30+i))).status,400);
  const started=await reg(applicant);assert.equal(started.status,202);assert.equal(started.data.verificationRequired,true);assert.equal(started.data.code,undefined);assert.equal(started.headers.get('set-cookie'),null);
  assert.ok(!JSON.stringify((await request('/api/users')).data).includes('basvuran.1@example.com'));
  const verify=(challenge,code)=>request('/api/register/verify','POST',{challenge,code},{cookie:'','cf-connecting-ip':'203.0.113.23'});
  const code=sentMails.at(-1).textContent.match(/\b\d{6}\b/)[0];
  assert.equal((await verify(started.data.challenge,code==='000000'?'000001':'000000')).status,400);
  const confirmed=await verify(started.data.challenge,code);assert.equal(confirmed.status,201);assert.equal(confirmed.data.pending,true);assert.equal(confirmed.data.email,'basvuran.1@example.com');
  assert.equal((await verify(started.data.challenge,code)).status,400);
  assert.equal((await request('/api/session','GET',undefined,{cookie:''})).data.authenticated,false);
  assert.equal((await request('/api/records','GET',undefined,{cookie:''})).status,401);
  assert.equal((await request('/api/login','POST',{username:applicant.email,password:'Yanlis!Sifre'})).status,401);const pendingLogin=await request('/api/login','POST',{username:applicant.email,password:applicant.password});assert.equal(pendingLogin.status,403);assert.match(pendingLogin.data.error,/yönetici onayı bekliyor/);
  assert.equal((await reg(applicant)).status,409);
  const second={...applicant,email:'basvuran.2@example.com'};const started2=await reg(second);assert.equal(started2.status,202);
  const code2=sentMails.at(-1).textContent.match(/\b\d{6}\b/)[0];assert.equal((await verify(started2.data.challenge,code2)).status,201);
  assert.equal((await reg(applicant)).status,409);assert.equal((await reg(applicant)).status,429);
  const listing=(await request('/api/users')).data,waiting=listing.find(u=>u.email==='basvuran.1@example.com'),other=listing.find(u=>u.email==='basvuran.2@example.com');
  assert.equal(waiting.pending,true);assert.equal(waiting.active,false);assert.equal(waiting.role,'staff');assert.equal(waiting.hash,undefined);assert.equal(waiting.emailVerified,true);
  assert.equal((await request('/api/users/'+waiting.username,'PATCH',{active:true})).status,400);
  assert.equal((await request('/api/users/'+waiting.username,'PATCH',{approve:true,name:applicant.name})).status,400);
  assert.equal((await request('/api/users/'+waiting.username,'PATCH',{approve:true,name:'Hesap Test Personeli'},{'x-csrf-token':'wrong'})).status,403);
  assert.equal((await request('/api/users/'+waiting.username,'PATCH',{approve:true,name:'Hesap Test Personeli'})).status,200);
  const login=await request('/api/login','POST',{username:applicant.email,password:applicant.password});assert.equal(login.status,200);cookie=userCookie(login);csrf=login.data.csrf;
  const state=(await request('/api/session')).data;assert.equal(state.user.name,'Hesap Test Personeli');assert.equal(state.user.role,'staff');assert.equal(state.user.emailVerified,true);
  assert.equal((await request('/api/users/'+other.username,'PATCH',{approve:true,name:'Hesap Test Personeli'})).status,403);
  cookie=adminCookie;csrf=adminCsrf;
  assert.equal((await request('/api/users/'+other.username,'PATCH',{reject:true})).status,200);
  assert.equal((await request('/api/login','POST',{username:second.email,password:second.password})).status,403);
  assert.equal((await request('/api/users/'+other.username,'PATCH',{approve:true,name:'Hesap Test Personeli'})).status,200);
  assert.equal((await request('/api/login','POST',{username:second.email,password:second.password})).status,200);
});

test('TCMB kur snapshotı, euro zorunluluğu, ödeme ve iptal; takip linki ve silme günlüğü',async()=>{
  const created=await request('/api/records','POST',{...payload(),handledBy:'Hesap Test Personeli',photos:[]});assert.equal(created.status,201);let r=created.data;
  const patch=async data=>{const out=await request('/api/records/'+r.id,'PATCH',{version:r.version,staff:'Hesap Test Personeli',...data});if(out.status===200)r=out.data;return out;};
  assert.equal((await patch({action:'quote',currency:'TRY',amount:100,note:'Test'})).status,400);
  assert.equal((await patch({action:'quote',currency:'EUR',amount:100,note:'Test',exchange:{rate:1}})).status,200);
  assert.equal(r.quoteRate.rate,40.1234);
  assert.equal((await patch({action:'payment',amount:10,note:'Nakit'})).status,400);
  assert.equal((await patch({action:'approve',approvedBy:'Müşteri',method:'Telefon'})).status,200);
  assert.equal((await patch({action:'payment',amount:30,note:'Nakit'})).status,200);
  assert.equal((await patch({action:'payment',amount:80,note:'Nakit'})).status,400);
  assert.equal((await patch({action:'quote',currency:'EUR',amount:120,note:'Değişiklik'})).status,400);
  const payment=r.payments[0];assert.equal((await patch({action:'paymentVoid',paymentId:payment.id,note:'Yanlış giriş'})).status,200);
  assert.ok(r.payments[0].voidedAt);
  const link=await request('/api/records/'+r.id+'/tracking','POST',{});assert.equal(link.status,200);
  const token=link.data.url.split('#')[1];assert.equal(token.length,64);
  const publicResult=await request('/api/tracking','POST',{token},{cookie:''});assert.equal(publicResult.status,200);assert.equal(publicResult.data.id,r.id);
  for(const key of ['phone','email','customer','address','findings','history','payments'])assert.equal(publicResult.data[key],undefined);
  assert.ok(!sqlite.prepare('SELECT token_hash FROM tracking_links WHERE record_id=?').get(r.id).token_hash.includes(token));
  const another=await request('/api/records/'+r.id+'/tracking','POST',{});assert.equal(another.status,200);
  assert.equal((await request('/api/tracking','POST',{token},{cookie:''})).status,404);
  const activeToken=another.data.url.split('#')[1];
  assert.equal((await request('/api/records/'+r.id,'DELETE',{version:r.version,staff:'Hesap Test Personeli',confirmId:r.id})).status,200);
  assert.equal((await request('/api/tracking','POST',{token:activeToken},{cookie:''})).status,404);
  const audit=await request('/api/audit');assert.equal(audit.status,200);assert.ok(audit.data.some(e=>e.record_id===r.id&&e.action==='Servis kaydı silindi'));
});
test('şifre yenileme: kodla şifre değişir, eski oturum kapanır, kod yeniden kullanılamaz',async()=>{
  const mails=[];env.MAIL_TRANSPORT={async fetch(url,options){mails.push(JSON.parse(options.body));return Response.json({messageId:'reset-test'});}};
  const email='basvuran.1@example.com';
  const login=await request('/api/login','POST',{username:email,password:'Basvuru!2026'},{'cf-connecting-ip':'203.0.113.151'});assert.equal(login.status,200);
  const publicReq=(path,data)=>request(path,'POST',data,{cookie:'','cf-connecting-ip':'203.0.113.150'});
  const unknown=await publicReq('/api/password-reset',{email:'unknown@example.com'});assert.equal(unknown.status,200);assert.equal(mails.length,0);
  const started=await publicReq('/api/password-reset',{email});assert.equal(started.status,200);assert.equal(mails.length,1);assert.match(mails[0].subject,/şifre yenileme/);
  const code=mails[0].textContent.match(/\b\d{6}\b/)[0],password='Reset!Password2026';
  const data={challenge:started.data.challenge,code,password,confirmPassword:password};
  assert.equal((await publicReq('/api/password-reset/verify',{...data,code:code==='000000'?'999999':'000000'})).status,400);
  assert.equal((await publicReq('/api/password-reset/verify',data)).status,200);
  assert.equal((await publicReq('/api/password-reset/verify',data)).status,400);
  assert.equal((await request('/api/session','GET',undefined,{cookie:userCookie(login)})).data.authenticated,false);
  assert.equal((await request('/api/login','POST',{username:email,password:'Basvuru!2026'},{'cf-connecting-ip':'203.0.113.152'})).status,401);
  assert.equal((await request('/api/login','POST',{username:email,password},{'cf-connecting-ip':'203.0.113.153'})).status,200);
});


test('yönetici e-posta ile hesap açar; giriş ve yinelenen adres kontrolü çalışır',async()=>{
  const name=(await request('/api/settings')).data.staff[0];
  const data={name,email:'Admin.Created@Example.com',password:'Email!Password2026',confirmPassword:'Email!Password2026'};
  const before=(await request('/api/users')).data.length;
  assert.equal((await request('/api/users','POST',{...data,email:'invalid'})).status,400);
  const created=await request('/api/users','POST',data);assert.equal(created.status,201);assert.equal(created.data.email,'admin.created@example.com');assert.equal(created.data.role,'staff');assert.equal(created.data.active,true);assert.equal(created.data.emailVerified,false);
  assert.equal((await request('/api/users','POST',{...data,email:'admin.created@example.com'})).status,409);
  assert.equal((await request('/api/users')).data.length,before+1);
  const login=await request('/api/login','POST',{email:data.email,password:data.password},{'cf-connecting-ip':'203.0.113.199'});assert.equal(login.status,200);assert.equal(login.data.user.email,'admin.created@example.com');
  assert.equal((await request('/api/users','POST',{...data,email:'other@example.com'},{cookie:userCookie(login),'x-csrf-token':login.data.csrf})).status,403);
});

after(async()=>{await Promise.all(jobs);sqlite.close();rmSync(dir,{recursive:true,force:true});});



