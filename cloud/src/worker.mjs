import catalog from '../catalog/products.json' with {type:'json'};
import {fail,text,date,photoData,printDocument,token,STATUS_LABEL} from './shared.mjs';
import {update} from './update.mjs';
import {startRegistration,verifyRegistration,emailAddress,mailReady} from './registration.mjs';
import {Buffer} from 'node:buffer';
import {createEmailAccount} from './admin-account.mjs';
import {getRate} from './rates.mjs';
import {recover} from './recovery.mjs';

const headers = {
  'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'same-origin',
  'Cache-Control':'no-store',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8',...extra}});
const enc=new TextEncoder();
const usernameOf=value=>{const name=text(value,'Kullanıcı adı',40,true).toLowerCase();if(!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(name))fail('Kullanıcı adı 3–40 karakter olmalı; a-z, rakam, nokta, tire ve alt çizgi kullanın.');return name;};
const publicUser=(key,a)=>({username:key==='account'?'admin':a.username,name:key==='account'?'Yönetici':a.name,role:key==='account'?'admin':'staff',active:a.active!==false,pending:a.pending===true,rejected:a.rejected===true,email:a.email||'',emailVerified:!!a.emailVerifiedAt});
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const digest=async value=>hex(await crypto.subtle.digest('SHA-256',enc.encode(value)));
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;};
async function passwordHash(password,salt){
  const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:100000,hash:'SHA-256'},key,256));
}
async function body(req,maxBytes=22*1024*1024){
  if(!req.headers.get('content-type')?.startsWith('application/json'))fail('JSON içerik gerekli.',415);
  if(Number(req.headers.get('content-length'))>maxBytes)fail('İstek boyutu sınırı aşıldı.',413);
  const reader=req.body?.getReader();if(!reader)fail('Geçersiz JSON.');
  const chunks=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();fail('İstek boyutu sınırı aşıldı.',413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{fail('Geçersiz JSON.');}
  if(!data||typeof data!=='object'||Array.isArray(data))fail('Geçersiz içerik.');return data;
}
async function cleanup(env){
  const pending=await env.DB.prepare('SELECT id FROM photo_cleanup LIMIT 5').all();
  for(const {id} of pending.results){try{await env.PHOTOS.delete(id);await env.DB.prepare('DELETE FROM photo_cleanup WHERE id=?').bind(id).run();}catch{break;}}
}
export default {
  async scheduled(event,env,ctx){ctx.waitUntil(getRate(env,true).catch(()=>{}));},
  async fetch(req,env,ctx){
    const url=new URL(req.url),path=url.pathname;
    const db=env.DB.withSession ? env.DB.withSession('first-primary') : env.DB;
    const setting=async key=>{const row=await db.prepare('SELECT value FROM settings WHERE key=?').bind(key).first();return row?JSON.parse(row.value):null;};
    const getRecord=async id=>{const row=await db.prepare('SELECT value FROM records WHERE id=?').bind(id).first();if(!row)fail('Servis kaydı bulunamadı.',404);return JSON.parse(row.value);};
    let currentUser=null;
    const staffName=async value=>{if(currentUser?.role==='staff')return currentUser.name;return checkedStaff(value);};
    const checkedStaff=async value=>{const name=text(value,'Personel',100,true);if(!(await setting('staff')||[]).includes(name))fail('Önce Ayarlar bölümüne personel ekleyin veya kayıtlı personeli seçin.');return name;};
    try{
      if(!['GET','POST','PATCH','DELETE'].includes(req.method))fail('Desteklenmeyen işlem.',405);
      if(req.method!=='GET'){
        const origin=req.headers.get('origin');if(origin&&origin!==url.origin)fail('İstek kaynağı doğrulanamadı.',403);
        if(req.headers.get('sec-fetch-site')==='cross-site')fail('Çapraz site isteği engellendi.',403);
      }
      if(path==='/api/rates'&&req.method==='GET')return json(await getRate(env));
      if(path==='/health'&&req.method==='GET'){await db.prepare('SELECT 1').first();return json({ok:true});}
      const cookieId=/(?:^|;\s*)pp_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.get('cookie')||'')?.[1];
      let session=cookieId?await db.prepare('SELECT * FROM sessions WHERE id=? AND until>?').bind(await digest(cookieId),Date.now()).first():null;
      const accountKey=session?.user_id==='admin'||!session?.user_id?'account':session.user_id;
      if(session){const account=await setting(accountKey);if(!account||account.active===false||account.pending===true||account.rejected===true)session=null;else currentUser=publicUser(accountKey,account);}
      if(path==='/api/tracking'&&req.method==='POST'){
        const data=await body(req,1024);
        if(!/^[a-f0-9]{64}$/.test(data.token||''))fail('Takip bağlantısı geçersiz.',404);
        const link=await db.prepare('SELECT record_id FROM tracking_links WHERE token_hash=? AND expires>?').bind(await digest(data.token),Date.now()).first();
        if(!link)fail('Takip bağlantısı geçersiz veya süresi dolmuş.',404);
        const r=await getRecord(link.record_id);
        const displayRate=!r.approval&&r.quoteCurrency==='EUR'?await getRate(env).catch(()=>r.quoteRate):r.quoteRate;
        return json({id:r.id,product:r.product,status:STATUS_LABEL[r.status],updatedAt:r.updatedAt||r.createdAt,quoteAmount:r.quoteAmount,quoteCurrency:r.quoteCurrency||'TRY',quoteRate:displayRate||null,approved:!!r.approval});
      }
      if(['/api/password-reset','/api/password-reset/verify'].includes(path)&&req.method==='POST')return json(await recover({db,env,data:await body(req,4096),ip:req.headers.get('cf-connecting-ip')||'local',passwordHash,text,verify:path.endsWith('/verify')}));
      if(path==='/api/session'&&req.method==='GET')return json({setup:!(await setting('account')),authenticated:!!session,csrf:session?.csrf||null,user:currentUser,emailRegistration:mailReady(env)});
      if(['/api/register','/api/register/verify'].includes(path)&&req.method==='POST'){
        if(!(await setting('account')))fail('İlk kurulum henüz tamamlanmadı.',409);
        const data=await body(req,4096),context={db,env,data,ip:req.headers.get('cf-connecting-ip')||'local',passwordHash,text};
        return json(await (path==='/api/register'?startRegistration(context):verifyRegistration(context)),path==='/api/register'?202:201);
      }
      if(['/api/setup','/api/login'].includes(path)&&req.method==='POST'){
        const now=Date.now();
        const attemptKey=await digest(req.headers.get('cf-connecting-ip')||'local');
        const attempt=await db.prepare('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until>? THEN count+1 ELSE 1 END, until=CASE WHEN until>? THEN until ELSE excluded.until END RETURNING count').bind(attemptKey,now+900000,now,now).first();
        if(attempt.count>10)fail('Çok fazla giriş denemesi. 15 dakika sonra yeniden deneyin.',429);
        const data=await body(req),password=text(data.password,'Şifre',200,true);
        const identifier=path==='/api/setup'?'admin':text(data.email||data.username||'admin','E-posta veya kullanıcı adı',254,true);
        const loginName=identifier.includes('@')?null:usernameOf(identifier);
        const emailUser=loginName===null?await db.prepare('SELECT user_key FROM account_emails WHERE email=?').bind(emailAddress(identifier)).first():null;
        const loginKey=loginName===null?(emailUser?.user_key||'user:unknown-email'):loginName==='admin'?'account':'user:'+loginName;
        let account=await setting(loginKey);
        if(path==='/api/setup'){
          if(account)fail('Kurulum zaten tamamlandı.',409);
          if(!env.SETUP_TOKEN||!equal(data.setupToken,env.SETUP_TOKEN))fail('Tek kullanımlık kurulum anahtarı geçersiz.',403);
          if(password.length<8)fail('En az 8 karakterli bir şifre belirleyin.');
          const salt=token(24),hash=await passwordHash(password,salt);
          account={salt,hash,algorithm:'pbkdf2-sha256',iterations:100000};
          const result=await db.prepare("INSERT OR IGNORE INTO settings VALUES('account',?)").bind(JSON.stringify(account)).run();
          if(!result.meta.changes)fail('Kurulum zaten tamamlandı.',409);
        }else{
          if(!(await setting('account')))fail('Önce ilk kurulumu tamamlayın.',409);
          const checkAccount=account||{salt:'invalid-account-salt',hash:''};
          const valid=equal(checkAccount.hash,await passwordHash(password,checkAccount.salt));
          if(!account||!valid)fail('E-posta, kullanıcı adı veya şifre hatalı.',401);
          if(account.pending===true)fail('E-posta adresiniz doğrulandı. Hesabınız yönetici onayı bekliyor.',403);
          if(account.rejected===true)fail('Başvurunuz yönetici tarafından reddedilmiş. Yöneticiyle iletişime geçin.',403);
          if(account.active===false)fail('Hesabınız pasif. Yöneticiyle iletişime geçin.',403);
        }
        const id=token(32),csrf=token(24);
        const loginResults=await db.batch([
          db.prepare('DELETE FROM attempts WHERE key=? OR until<?').bind(attemptKey,now),
          db.prepare('DELETE FROM sessions WHERE until<?').bind(now),
          db.prepare("INSERT INTO sessions(id,csrf,until,user_id) SELECT ?,?,?,? WHERE (SELECT value FROM settings WHERE key=?)=?").bind(await digest(id),csrf,now+12*3600000,loginKey==='account'?'admin':loginKey,loginKey,JSON.stringify(account))
        ]);
        if(!loginResults[2].meta.changes)fail('Şifre bu sırada değiştirildi. Yeniden giriş yapın.',409);
        return json({csrf,user:publicUser(loginKey,account)},200,{'Set-Cookie':`pp_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${url.protocol==='https:'?'; Secure':''}`});
      }
      if(path.startsWith('/api/')||path==='/print'){
        if(!session)fail('Oturum açmanız gerekiyor.',401);
        if(req.method!=='GET'&&!equal(req.headers.get('x-csrf-token'),session.csrf))fail('Güvenlik anahtarı geçersiz. Sayfayı yenileyin.',403);
        if(path==='/api/logout'&&req.method==='POST'){
          await db.prepare('DELETE FROM sessions WHERE id=?').bind(session.id).run();
          return json({ok:true},200,{'Set-Cookie':`pp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${url.protocol==='https:'?'; Secure':''}`});
        }
        const adminOnly=path==='/api/audit'||path==='/api/users'||path.startsWith('/api/users/')||path==='/api/backup'||(path==='/api/settings'&&req.method==='PATCH')||req.method==='DELETE';
        if(adminOnly&&currentUser.role!=='admin')fail('Bu işlem için yönetici yetkisi gerekiyor.',403);
        if(path==='/api/audit'&&req.method==='GET')return json((await db.prepare('SELECT record_id,actor,action,at FROM audit_events ORDER BY id DESC LIMIT 100').all()).results);
        const tracking=/^\/api\/records\/(PWR-SRV-\d{4}-\d+)\/tracking$/.exec(path);
        if(tracking&&req.method==='POST'){
          const r=await getRecord(tracking[1]),data=await body(req,1024);
          const value=data.revoke?null:token(32);
          const statement=value?db.prepare('INSERT INTO tracking_links VALUES(?,?,?) ON CONFLICT(record_id) DO UPDATE SET token_hash=excluded.token_hash,expires=excluded.expires').bind(await digest(value),r.id,Date.now()+30*86400000):db.prepare('DELETE FROM tracking_links WHERE record_id=?').bind(r.id);
          await db.batch([statement,db.prepare('INSERT INTO audit_events(record_id,actor,action,at) VALUES(?,?,?,?)').bind(r.id,currentUser.username,value?'Müşteri takip bağlantısı oluşturuldu':'Müşteri takip bağlantısı kapatıldı',new Date().toISOString())]);
          return json({ok:true,url:value?url.origin+'/track#'+value:null});
        }
        if(path==='/api/users'&&req.method==='GET'){
          const users=await db.prepare("SELECT key,value FROM settings WHERE key LIKE 'user:%' ORDER BY key").all();
          return json(users.results.map(row=>publicUser(row.key,JSON.parse(row.value))));
        }
        if(path==='/api/users'&&req.method==='POST'){
          const data=await body(req);
          if(Object.hasOwn(data,'email')){const {key,account}=await createEmailAccount({db,data,name:await checkedStaff(data.name),passwordHash,text});return json(publicUser(key,account),201);}
          const username=usernameOf(data.username),name=await checkedStaff(data.name),password=text(data.password,'Şifre',200,true);
          if(username==='admin')fail('Bu kullanıcı adı zaten kullanılıyor.',409);
          if(password.length<8)fail('En az 8 karakterli bir şifre belirleyin.');
          if(password!==data.confirmPassword)fail('Şifreler aynı değil.');
          const count=await db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'user:%' AND COALESCE(json_extract(value,'$.pending'),0)=0 AND COALESCE(json_extract(value,'$.rejected'),0)=0").first();if(count.n>=40)fail('En fazla 40 kullanıcı eklenebilir.');
          const salt=token(24),account={username,name,active:true,salt,hash:await passwordHash(password,salt),algorithm:'pbkdf2-sha256',iterations:100000};
          const result=await db.prepare("INSERT OR IGNORE INTO settings SELECT ?,? WHERE (SELECT COUNT(*) FROM settings WHERE key LIKE 'user:%' AND COALESCE(json_extract(value,'$.pending'),0)=0 AND COALESCE(json_extract(value,'$.rejected'),0)=0)<40").bind('user:'+username,JSON.stringify(account)).run();
          if(!result.meta.changes)fail('Bu kullanıcı adı zaten kullanılıyor.',409);
          return json(publicUser('user:'+username,account),201);
        }
        if(path.startsWith('/api/users/')&&req.method==='PATCH'){
          const username=usernameOf(decodeURIComponent(path.slice('/api/users/'.length)));if(username==='admin')fail('Yönetici hesabı burada değiştirilemez.');
          const key='user:'+username,account=await setting(key);if(!account)fail('Kullanıcı bulunamadı.',404);
          const data=await body(req),next={...account};
          if(data.approve===true){
            if(!account.pending&&!account.rejected)fail('Bu hesap zaten onaylanmış.');
            next.name=await checkedStaff(data.name);next.pending=false;next.rejected=false;next.active=true;
          }
          if(data.reject===true){if(!account.pending)fail('Bu hesap onay beklemiyor.');next.pending=false;next.rejected=true;next.active=false;}
          if(data.approve===true&&data.reject===true)fail('Tek bir işlem seçin.');
          if(Object.hasOwn(data,'active')){if(account.pending||account.rejected)fail('Başvuruyu önce personel eşleştirerek onaylayın.');if(typeof data.active!=='boolean')fail('Geçerli hesap durumu seçin.');next.active=data.active;}
          if(Object.hasOwn(data,'password')){const password=text(data.password,'Şifre',200,true);if(password.length<8)fail('En az 8 karakterli bir şifre belirleyin.');if(password!==data.confirmPassword)fail('Şifreler aynı değil.');next.salt=token(24);next.hash=await passwordHash(password,next.salt);}
          if(!Object.hasOwn(data,'active')&&!Object.hasOwn(data,'password')&&data.approve!==true&&data.reject!==true)fail('Değişiklik seçin.');
          const result=await db.batch([
            db.prepare("UPDATE settings SET value=? WHERE key=? AND value=? AND (?=0 OR (SELECT COUNT(*) FROM settings WHERE key LIKE 'user:%' AND COALESCE(json_extract(value,'$.pending'),0)=0 AND COALESCE(json_extract(value,'$.rejected'),0)=0)<40)").bind(JSON.stringify(next),key,JSON.stringify(account),data.approve===true?1:0),
            db.prepare('DELETE FROM sessions WHERE user_id=?').bind(key)
          ]);
          if(!result[0].meta.changes)fail('Kullanıcı değişti veya 40 hesap sınırına ulaşıldı. Listeyi yenileyin.',409);
          return json(publicUser(key,next));
        }
        if(path==='/api/password'&&req.method==='PATCH'){
          const data=await body(req),current=text(data.currentPassword,'Mevcut şifre',200,true),next=text(data.newPassword,'Yeni şifre',200,true);
          if(next.length<8)fail('En az 8 karakterli bir şifre belirleyin.');
          if(next!==data.confirmPassword)fail('Yeni şifreler aynı değil.');
          const now=Date.now(),attemptKey='password:'+session.id;
          const attempt=await db.prepare('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until>? THEN count+1 ELSE 1 END, until=CASE WHEN until>? THEN until ELSE excluded.until END RETURNING count').bind(attemptKey,now+900000,now,now).first();
          if(attempt.count>10)fail('Çok fazla şifre denemesi. 15 dakika sonra yeniden deneyin.',429);
          const account=await setting(accountKey);
          if(!equal(account.hash,await passwordHash(current,account.salt)))fail('Mevcut şifre yanlış.');
          const salt=token(24),hash=await passwordHash(next,salt),newAccount=JSON.stringify({...account,salt,hash,algorithm:'pbkdf2-sha256',iterations:100000});
          const result=await db.batch([
            db.prepare("UPDATE settings SET value=? WHERE key=? AND value=? AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND until>?)").bind(newAccount,accountKey,JSON.stringify(account),session.id,now),
            db.prepare("DELETE FROM sessions WHERE id<>? AND user_id=? AND EXISTS(SELECT 1 FROM settings WHERE key=? AND value=?)").bind(session.id,session.user_id,accountKey,newAccount)
          ]);
          if(!result[0].meta.changes)fail('Şifre veya oturum başka bir pencerede değişti. Yeniden giriş yapın.',409);
          await db.prepare('DELETE FROM attempts WHERE key=?').bind(attemptKey).run();return json({ok:true});
        }
        if(path==='/api/settings'&&req.method==='GET')return json({user:currentUser,staff:currentUser.role==='staff'?[currentUser.name]:await setting('staff')||[],catalog:catalog.items,brands:catalog.brands,categories:catalog.categories,catalogVersion:catalog.version,statuses:STATUS_LABEL});
        if(path==='/api/settings'&&req.method==='PATCH'){
          const data=await body(req);let staff;
          if(Object.hasOwn(data,'addStaff')){
            const name=text(data.addStaff,'Personel adı',100,true),row=await db.prepare("SELECT value FROM settings WHERE key='staff'").first(),current=row?JSON.parse(row.value):[];
            if(current.some(item=>item.toLocaleLowerCase('tr-TR')===name.toLocaleLowerCase('tr-TR')))fail('Bu personel zaten listede.');
            if(current.length>=40)fail('En fazla 40 personel eklenebilir.');
            staff=[...current,name];
            const result=row?await db.prepare("UPDATE settings SET value=? WHERE key='staff' AND value=?").bind(JSON.stringify(staff),row.value).run():await db.prepare("INSERT OR IGNORE INTO settings VALUES('staff',?)").bind(JSON.stringify(staff)).run();
            if(!result.meta.changes)fail('Personel listesi başka bir pencerede değişti. Yeniden deneyin.',409);
          }else if(Object.hasOwn(data,'removeStaff')){
            const name=text(data.removeStaff,'Personel adı',100,true),row=await db.prepare("SELECT value FROM settings WHERE key='staff'").first(),current=row?JSON.parse(row.value):[];
            if(!current.includes(name))fail('Personel zaten kaldırılmış olabilir. Listeyi yenileyin.',409);
            staff=current.filter(item=>item!==name);
            const result=await db.prepare("UPDATE settings SET value=? WHERE key='staff' AND value=?").bind(JSON.stringify(staff),row.value).run();
            if(!result.meta.changes)fail('Personel listesi başka bir pencerede değişti. Sayfayı yenileyin.',409);
          }else{
            if(!Array.isArray(data.staff)||data.staff.length>40)fail('En fazla 40 personel eklenebilir.');
            staff=[...new Set(data.staff.map(v=>text(v,'Personel adı',100,true)))];
            await db.prepare("INSERT INTO settings VALUES('staff',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(staff)).run();
          }
          return json({staff});
        }
        if(path==='/api/records'&&req.method==='GET')return json((await db.prepare('SELECT value FROM records ORDER BY rowid DESC').all()).results.map(row=>JSON.parse(row.value)));
        if(path==='/api/records'&&req.method==='POST'){
          const data=await body(req),requestKey=text(data.requestKey,'İstek anahtarı',50,true);
          if(!/^[a-f0-9-]{36}$/.test(requestKey))fail('Geçersiz istek anahtarı.');
          const fingerprint=await digest(JSON.stringify(data));
          const prior=await db.prepare('SELECT * FROM records WHERE request_key=?').bind(requestKey).first();
          if(prior){if(prior.fingerprint!==fingerprint)fail('Bu istek daha önce farklı içerikle kaydedilmiş. Kayıt listesini kontrol edin.',409);return json(JSON.parse(prior.value));}
          const product=catalog.items.find(p=>p.product===data.product);if(!product)fail('Katalogdan bir ürün seçin.');
          if(data.brand!=null&&data.brand!==product.brand)fail('Seçilen marka ve model uyuşmuyor.');
          const r={customer:text(data.customer,'Müşteri',100,true),email:text(data.email,'E-posta',150),phone:text(data.phone,'Telefon',40,true),address:text(data.address,'Adres',500),customerType:data.customerType,product:product.product,brand:product.brand,model:product.model,category:product.category,catalogSource:product.source,catalogVersion:catalog.version,serial:text(data.serial,'Seri numarası',100,true),handledBy:await staffName(data.handledBy),issue:text(data.issue,'Arıza açıklaması',1500,true),purchaseDate:date(data.purchaseDate),accessories:text(data.accessories,'Aksesuarlar',300),condition:text(data.condition,'Fiziksel durum',1000),status:'received',createdAt:new Date().toISOString(),version:1,quoteAmount:null,quoteCurrency:'EUR',quoteNote:'',technician:'',warranty:'pending',findings:'',work:'',tests:''};
          if(r.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))fail('Geçerli bir e-posta adresi girin.');
          if(!/^[+\d\s().-]{7,40}$/.test(r.phone)||r.phone.replace(/\D/g,'').length<7)fail('Geçerli bir telefon numarası girin.');
          if(!['individual','dealer'].includes(r.customerType))fail('Müşteri türü geçersiz.');
          const photos=photoData(data.photos||[]);
          r.photos=photos.map(({id,name,type})=>({id,name,type}));
          r.history=[{at:r.createdAt,staff:r.handledBy,action:'Servis kaydı oluşturuldu',status:r.status}];
          const uploaded=[];
          try{
            for(const p of photos){await env.PHOTOS.put(p.id,p.bytes);uploaded.push(p.id);}
            const year=Number(new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'}).slice(0,4));
            const idExpr="'PWR-SRV-' || printf('%d',?) || '-' || printf('%04d',(SELECT value FROM counters WHERE year=?))";
            const statements=[
              db.prepare('INSERT INTO counters VALUES(?,1) ON CONFLICT(year) DO UPDATE SET value=value+1').bind(year),
              db.prepare(`INSERT INTO records VALUES(${idExpr},json_set(?,'$.id',${idExpr}),1,?,?)`).bind(year,year,JSON.stringify(r),year,year,requestKey,fingerprint),
              db.prepare('INSERT INTO audit_events(record_id,actor,action,at) SELECT id,?,?,? FROM records WHERE request_key=?').bind(currentUser.username,'Servis kaydı oluşturuldu',r.createdAt,requestKey),
              ...photos.map(p=>db.prepare('INSERT INTO photos VALUES(?,(SELECT id FROM records WHERE request_key=?),?,?,?)').bind(p.id,requestKey,p.type,p.name,p.bytes.length))
            ];
            await db.batch(statements);
          }catch(error){
            for(const id of uploaded){try{await env.PHOTOS.delete(id);}catch{await db.prepare('INSERT OR IGNORE INTO photo_cleanup VALUES(?)').bind(id).run();}}
            const existing=await db.prepare('SELECT * FROM records WHERE request_key=?').bind(requestKey).first();
            if(existing){if(existing.fingerprint!==fingerprint)fail('Bu istek daha önce farklı içerikle kaydedilmiş.',409);return json(JSON.parse(existing.value));}
            console.error('Kayıt veya fotoğraf depolama işlemi tamamlanamadı.');
            fail('Kayıt kaydedilemedi. Ücretsiz depolama kotası veya bağlantı sınırına ulaşılmış olabilir. Kayıt listesini kontrol edip tekrar deneyin.',503);
          }
          ctx.waitUntil(cleanup(env).catch(()=>{}));
          const saved=await db.prepare('SELECT value FROM records WHERE request_key=?').bind(requestKey).first();return json(JSON.parse(saved.value),201);
        }
        const match=/^\/api\/records\/(PWR-SRV-\d{4}-\d+)$/.exec(path);
        if(match&&['PATCH','DELETE'].includes(req.method)){
          const data=await body(req),r=await getRecord(match[1]);
          if(data.version!==r.version)fail('Bu kayıt başka bir pencerede güncellendi. Detayı kapatıp yeniden açın.',409);
          const staff=await staffName(data.staff);
          if(req.method==='DELETE'){
            if(data.confirmId!==r.id)fail('Silmek için servis numarasını doğrulayın.');
            // Queue cleanup only if this exact version is still current. FK cascade removes photo access immediately.
            const results=await db.batch([
              db.prepare('INSERT OR IGNORE INTO photo_cleanup SELECT photos.id FROM photos JOIN records ON records.id=photos.record_id WHERE records.id=? AND records.version=?').bind(r.id,data.version),
              db.prepare('DELETE FROM records WHERE id=? AND version=?').bind(r.id,data.version),
              db.prepare('INSERT INTO audit_events(record_id,actor,action,at) SELECT ?,?,?,? WHERE changes()>0').bind(r.id,currentUser.username,'Servis kaydı silindi',new Date().toISOString())
            ]);
            if(!results[1].meta.changes)fail('Bu kayıt başka bir pencerede güncellendi. Detayı kapatıp yeniden açın.',409);
            ctx.waitUntil(cleanup(env).catch(()=>{}));return json({ok:true,id:r.id});
          }
          if(data.action==='approve'&&r.quoteCurrency==='EUR'){data.exchange=await getRate(env);if(data.exchange.stale||Date.now()-Date.parse(data.exchange.date+'T00:00:00Z')>7*86400000)fail('Teklif onayı için güncel TCMB kuru gerekiyor.',503);}
          if(data.action==='paymentVoid'&&currentUser.role!=='admin')fail('Ödeme iptali için yönetici yetkisi gerekiyor.',403);
          if(data.action==='quote'){
            if(data.currency!=='EUR')fail('Yeni teklifler euro olarak düzenlenir.');
            if((r.payments||[]).some(p=>!p.voidedAt))fail('Ödeme alınmış teklif değiştirilemez. Önce ödeme kayıtlarını kontrol edin.');
            data.exchange=await getRate(env);
            if(data.exchange.stale||Date.now()-Date.parse(data.exchange.date+'T00:00:00Z')>7*86400000)fail('Güncel TCMB kuru doğrulanamadı. Yeni teklif için daha sonra deneyin.',503);
          }
          update(r,data,staff);
          const results=await db.batch([
            db.prepare('UPDATE records SET value=?,version=? WHERE id=? AND version=?').bind(JSON.stringify(r),r.version,r.id,data.version),
            db.prepare('INSERT INTO audit_events(record_id,actor,action,at) SELECT ?,?,?,? WHERE changes()>0').bind(r.id,currentUser.username,r.history.at(-1).action,r.updatedAt)
          ]);
          const result=results[0];
          if(!result.meta.changes)fail('Bu kayıt başka bir pencerede güncellendi. Detayı kapatıp yeniden açın.',409);
          ctx.waitUntil(cleanup(env).catch(()=>{}));return json(r);
        }
        const photo=/^\/api\/photos\/([a-f0-9]{32})$/.exec(path);
        if(photo&&req.method==='GET'){
          const meta=await db.prepare('SELECT * FROM photos WHERE id=?').bind(photo[1]).first();if(!meta)fail('Fotoğraf bulunamadı.',404);
          const bytes=await env.PHOTOS.get(meta.id,'arrayBuffer');
          if(!bytes)fail('Fotoğraf henüz dağıtıma ulaşmadı. Kısa süre sonra yeniden deneyin.',503);
          return new Response(bytes,{headers:{...headers,'Content-Type':meta.type}});
        }
        if(path==='/api/backup'&&req.method==='GET'){
          const rows=await db.prepare('SELECT value FROM records ORDER BY rowid').all();
          const meta=await db.prepare('SELECT * FROM photos ORDER BY id').all();
          const prefix=JSON.stringify({format:'powerpool-cloud-backup-v1',exportedAt:new Date().toISOString(),staff:await setting('staff')||[],records:rows.results.map(r=>JSON.parse(r.value))});
          // Read and encode one photo at a time so a full backup does not fill Worker memory.
          let photoIndex=0;
          const stream=new ReadableStream({
            start(controller){controller.enqueue(enc.encode(prefix.slice(0,-1)+',"photos":['));},
            async pull(controller){try{
              if(photoIndex===meta.results.length){controller.enqueue(enc.encode(']}'));controller.close();return;}
              const p=meta.results[photoIndex],bytes=await env.PHOTOS.get(p.id,'arrayBuffer');
              if(!bytes)throw new Error('Fotoğraf yedeği okunamadı.');
              controller.enqueue(enc.encode((photoIndex?',':'')+JSON.stringify({id:p.id,recordId:p.record_id,type:p.type,name:p.name,data:Buffer.from(bytes).toString('base64')})));photoIndex++;
            }catch(error){controller.error(error);}}
          });
          return new Response(stream,{headers:{...headers,'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="powerpool-yedek-${new Date().toISOString().slice(0,10)}.json"`}});
        }
        if(path==='/print'&&req.method==='GET'){const r=await getRecord(url.searchParams.get('id'));if(!r.approval&&r.quoteCurrency==='EUR')r.quoteRate=await getRate(env).catch(()=>r.quoteRate);return new Response(printDocument(r,url.searchParams.get('type')),{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});}
        fail('İşlem bulunamadı.',404);
      }
      if(req.method!=='GET'||!(path==='/'||path==='/track'||/^\/(css|js|images)\/[a-zA-Z0-9_.-]+$/.test(path)))fail('Dosya bulunamadı.',404);
      const response=await env.ASSETS.fetch(req);const secured=new Response(response.body,response);for(const [k,v] of Object.entries(headers))secured.headers.set(k,v);return secured;
    }catch(error){
      if(!error.status)console.error('Sunucu veya ücretsiz kota hatası.');
      return json({error:error.status?error.message:'İşlem tamamlanamadı. Bağlantıyı ve ücretsiz kotayı kontrol edip yeniden deneyin.'},error.status||503);
    }
  }
};

