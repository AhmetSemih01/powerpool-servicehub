import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {filterProducts} from '../js/catalog-utils.js';

const temp=mkdtempSync(join(tmpdir(),'powerpool-test-'));
process.env.POWERPOOL_DATA_DIR=temp; process.env.POWERPOOL_TEST='1'; process.env.PORT='4174';
const {handler,closeDatabase,setMailTransportForTest}=await import('../server.mjs');
let cookie='',csrf='';
async function request(url,method='GET',data,extra={}) {
  const req=Readable.from(data==null?[]:[Buffer.from(JSON.stringify(data))]);
  req.url=url;req.method=method;req.headers={host:'127.0.0.1:4174',origin:'http://127.0.0.1:4174',...(data?{'content-type':'application/json'}:{}),cookie,'x-csrf-token':csrf,...extra};req.socket={remoteAddress:extra['x-test-ip']||'127.0.0.1'};
  const res={status:200,headers:{},headersSent:false,body:null,setHeader(k,v){this.headers[k.toLowerCase()]=v;},writeHead(n,h={}){this.status=n;this.headersSent=true;for(const[k,v]of Object.entries(h))this.setHeader(k,v);},end(value=''){this.body=Buffer.isBuffer(value)?value:Buffer.from(value);}};
  await handler(req,res);
  const type=res.headers['content-type']||'';
  return {...res,data:type.includes('application/json')?JSON.parse(res.body.toString()):res.body.toString()};
}
const valid=()=>({requestKey:randomUUID(),customer:'Test Müşteri',customerType:'individual',email:'test@example.com',phone:'0555 123 45 67',address:'Test adres',product:'iGarden M1-80',serial:'SERIAL-1',handledBy:'Ayşe Yılmaz',issue:'Robot hareket etmiyor.',purchaseDate:'2025-01-01',accessories:'Şarj cihazı',condition:'Çizik var',photos:[]});
let id,version,photoId,firstRequest;
test('ilk kurulum, şifre ve erişim koruması',async()=>{
  assert.equal((await request('/api/records')).status,401);
  assert.equal((await request('/api/session')).data.setup,true);
  assert.equal((await request('/api/setup','POST',{password:'short'})).status,400);
  const created=await request('/api/setup','POST',{password:'Test-Strong-Password-123'});
  assert.equal(created.status,200);cookie=created.headers['set-cookie'].split(';')[0];csrf=created.data.csrf;
  assert.equal((await request('/api/setup','POST',{password:'Different-password-123'})).status,409);
  assert.equal((await request('/api/login','POST',{password:'incorrect'})).status,401);
  assert.equal((await request('/api/session')).data.authenticated,true);
  assert.equal((await request('/api/records','POST',valid(),{'x-csrf-token':'wrong'})).status,403);
  assert.equal((await request('/api/settings','PATCH',{staff:['Personel']},{origin:'https://attacker.example'})).status,403);
  assert.equal((await request('/api/session','GET',null,{host:'attacker.example'})).status,403);
});
test('katalog birebir korunur; hayali veri bulunmaz; personel kaydı gerekir',async()=>{
  assert.deepEqual((await request('/api/records')).data,[]);
  const config=(await request('/api/settings')).data;
  assert.deepEqual(config.brands,['İ-Garden','Aquax','Bs Pool','Antech','MineuerX','MajeuerX']);
  for(const product of ['iGarden M1-80','AQUAX W30','BS Pool N-BsSalt 25','MineuerX 1 HP'])assert.ok(config.catalog.some(p=>p.product===product));
  assert.equal((await request('/api/records','POST',valid())).status,400);
  assert.equal((await request('/api/settings','PATCH',{staff:['Ayşe Yılmaz','Mehmet Kaya']})).status,200);
});
test('fotoğraflı kayıt tüm alanlarıyla kalıcı veritabanına yazılır',async()=>{
  const photo={name:'kabul.png',type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZOQAAAAASUVORK5CYII='};
  firstRequest={...valid(),photos:[photo]};
  const r=await request('/api/records','POST',firstRequest);assert.equal(r.status,201);
  id=r.data.id;version=r.data.version;photoId=r.data.photos[0].id;
  assert.match(id,/^PWR-SRV-\d{4}-0001$/);assert.equal(r.data.email,firstRequest.email);assert.equal(r.data.condition,'Çizik var');assert.equal(r.data.accessories,'Şarj cihazı');assert.equal(r.data.history.length,1);
  const independent=new DatabaseSync(join(temp,'servicehub.sqlite'));assert.equal(independent.prepare('SELECT count(*) AS n FROM records').get().n,1);assert.equal(independent.prepare('SELECT count(*) AS n FROM photos').get().n,1);independent.close();
  const image=await request('/api/photos/'+photoId);assert.equal(image.status,200);assert.ok(image.body.equals(Buffer.from(photo.data,'base64')));
});
test('tekrar gönderilen aynı kayıt çoğalmaz; farklı içerikle yeniden kullanılamaz',async()=>{
  const repeat=await request('/api/records','POST',firstRequest);assert.equal(repeat.status,200);assert.equal(repeat.data.id,id);
  assert.equal((await request('/api/records')).data.length,1);
  assert.equal((await request('/api/records','POST',{...firstRequest,issue:'Farklı arıza'})).status,409);
});
test('bozuk alanlar ve fotoğraflar reddedilir; kayıt sayısı ve sıra bozulmaz',async()=>{
  for(const change of [{email:'invalid'},{phone:'abcdefghi'},{customer:'   '},{product:'Unknown'},{purchaseDate:'2025-02-30'},{purchaseDate:'2999-01-01'},{photos:[{name:'bad.png',type:'image/png',data:Buffer.from('not a png').toString('base64')}]},{photos:Array(6).fill({})}]) {
    const r=await request('/api/records','POST',{...valid(),...change});assert.equal(r.status,400,JSON.stringify(change));
  }
  assert.equal((await request('/api/records')).data.length,1);
  const r=await request('/api/records','POST',{...valid(),product:'MineuerX 1 HP',serial:'SERIAL-2',customerType:'dealer'});assert.equal(r.status,201);assert.match(r.data.id,/-0002$/);assert.equal(r.data.category,'pump');
});
test('teklif, ücretsiz teklif, müşteri onayı, notlar ve geçmiş doğru kaydedilir',async()=>{
  const update=async data=>{const r=await request('/api/records/'+id,'PATCH',{version,staff:'Mehmet Kaya',...data});if(r.status===200)version=r.data.version;return r;};
  assert.equal((await update({action:'quote',amount:-1,note:'Parça'})).status,400);
  assert.equal((await update({action:'quote',amount:1.001,note:'Parça'})).status,400);
  const quote=await update({action:'quote',amount:0,note:'Garanti kapsamında işlem'});assert.equal(quote.status,200);assert.equal(quote.data.status,'waiting');assert.equal(quote.data.quoteAmount,0);
  assert.equal((await update({action:'status',status:'approved'})).status,400);
  assert.equal((await update({action:'status',status:'repair'})).status,400);
  const approval=await update({action:'approve',approvedBy:'Müşteri Adı',method:'Telefon'});assert.equal(approval.status,200);assert.equal(approval.data.approval.recordedBy,'Mehmet Kaya');
  assert.equal((await update({action:'status',status:'repair'})).status,200);
  const notes=await update({action:'notes',findings:'Pompa bağlantısı kontrol edildi.',work:'Bağlantı yenilendi.',tests:'Çalışıyor.',warranty:'warranty'});assert.equal(notes.data.technician,'Mehmet Kaya');assert.equal(notes.data.tests,'Çalışıyor.');
  const changed=await update({action:'quote',amount:250,note:'Ek parça'});assert.equal(changed.data.approval,null);assert.equal(changed.data.status,'waiting');
  assert.equal((await update({action:'approve',approvedBy:'Müşteri Adı',method:'E-posta'})).status,200);
  for(const status of ['repair','repaired','tested','shipped']) assert.equal((await update({action:'status',status})).status,200);
});
test('eşzamanlı düzenleme eski sürümü sessizce ezmez',async()=>{
  const stale=await request('/api/records/'+id,'PATCH',{version:1,staff:'Ayşe Yılmaz',action:'status',status:'review'});assert.equal(stale.status,409);
  const r=(await request('/api/records')).data.find(r=>r.id===id);assert.equal(r.status,'shipped');assert.equal(r.version,version);
});
test('belgeler gerçek alanları, görselleri içerir; zararlı HTML çalıştırılmaz',async()=>{
  const created=await request('/api/records','POST',{...valid(),customer:'<script>alert(1)</script>',issue:'<img src=x onerror=alert(1)>'});
  for(const type of ['accept','inspect','finish']) {
    const print=await request(`/print?id=${created.data.id}&type=${type}`);assert.equal(print.status,200);assert.ok(print.data.includes('&lt;script&gt;'));assert.ok(!print.data.includes('<script>alert(1)</script>'));assert.ok(print.data.includes('iGarden M1-80'));assert.ok(!/DEMO|PREVIEW|QR/.test(print.data));
  }
  assert.ok((await request(`/print?id=${id}&type=accept`)).data.includes('/api/photos/'+photoId));
  assert.equal((await request(`/print?id=${id}&type=unknown`)).status,404);
});
test('yedek tüm kayıtları ve fotoğrafları içerir; özel dosyalar sunulmaz',async()=>{
  const backup=await request('/api/backup');assert.equal(backup.status,200);assert.equal(backup.body.subarray(0,15).toString(),'SQLite format 3');
  const file=join(temp,'restore-test.sqlite');writeFileSync(file,backup.body);const restored=new DatabaseSync(file);assert.equal(restored.prepare('SELECT count(*) AS n FROM records').get().n,3);assert.equal(restored.prepare('SELECT count(*) AS n FROM photos').get().n,1);restored.close();
  for(const path of ['/data/servicehub.sqlite','/server.mjs','/package.json','/../server.mjs']) assert.equal((await request(path)).status,404);
});
test('çıkış, tekrar giriş, oturum ve yetkisiz fotoğraf erişimi',async()=>{
  assert.equal((await request('/api/logout','POST',{})).status,200);assert.equal((await request('/api/photos/'+photoId)).status,401);
  const login=await request('/api/login','POST',{password:'Test-Strong-Password-123'});assert.equal(login.status,200);cookie=login.headers['set-cookie'].split(';')[0];csrf=login.data.csrf;
  assert.equal((await request('/api/records')).data.length,3);
});
test('HTML, CSS ve JS bağlantıları ayrıdır; sayfa hedefleri ve katalog adları doğrulanır',()=>{
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),html=readFileSync(join(root,'index.html'),'utf8');
  assert.equal(/<style>|<script>/.test(html),false);
  assert.ok(!/demo|prototype|örnek veri/i.test(html));
  for(const match of html.matchAll(/(?:src|href)="(\/(?:css|js|images)\/[^"]+)"/g)) assert.ok(readFileSync(join(root,match[1])).length);
  const ids=[...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]);assert.equal(new Set(ids).size,ids.length);
  for(const match of html.matchAll(/data-(?:page|goto)="([^"]+)"/g)) assert.ok(ids.includes(match[1]));
  assert.ok(readdirSync(join(root,'images')).includes('logo.svg'));
});
test('katalog kaynakları, ürün grupları ve istenen modeller eksiksiz eşleştirilir',async()=>{
  const {catalog,brands,categories}= (await request('/api/settings')).data;
  assert.equal(catalog.length,495);assert.equal(new Set(catalog.map(p=>p.product)).size,495);
  for(const p of catalog){assert.ok(brands.includes(p.brand));assert.ok(categories[p.category]);assert.ok(p.model.trim());assert.ok(p.source.page>0);assert.match(p.source.url,/^https:\/\/(?:www\.)?(?:powerpool\.com\.tr|bspool\.eu|enelsa\.com)\//);}
  assert.deepEqual(catalog.filter(p=>p.brand==='İ-Garden').map(p=>p.model),['M1-50','M1-80','M1-100','M1 Pro 125','M1 Pro 125 AI']);
  assert.deepEqual(catalog.filter(p=>p.brand==='Aquax').map(p=>p.model),['W30','W45','W80']);
  for(const model of ['N-BsSalt 10','N-BsSalt 15','N-BsSalt 20','N-BsSalt 25','N-BsSalt 35','PRO 1000','EVO RX-P5'])assert.ok(catalog.some(p=>p.brand==='Bs Pool'&&p.model===model));
  for(const model of ['SALT IONIC A 24GR/H','DP NOVA A 10L/10B VACFAT','SYSTEM 03 E'])assert.ok(catalog.some(p=>p.brand==='Antech'&&p.model===model));
});
test('marka ve grup filtreleri birbirine karışmaz; Türkçe model araması çalışır',async()=>{
  const {catalog}= (await request('/api/settings')).data;
  const ig=filterProducts(catalog,'İ-Garden','','m1');assert.equal(ig.length,5);
  assert.equal(filterProducts(catalog,'Aquax','robot','w45')[0].product,'AQUAX W45');
  const salt=filterProducts(catalog,'Antech','salt','SALT IONİC A 24');assert.equal(salt.length,1);assert.equal(salt[0].model,'SALT IONIC A 24GR/H');
  assert.equal(filterProducts(catalog,'Antech','sensor','SALT IONIC').length,0);
  assert.equal(filterProducts(catalog,'İ-Garden','','olmayan-model').length,0);
});
test('yeni modeller servis kabulünden belgeye doğru taşınır ve yanlış marka reddedilir',async()=>{
  const products=['iGarden M1 Pro 125 AI','AQUAX W80','BS Pool PRO 1000','Antech SALT IONIC A 24GR/H','Antech DP NOVA A 10L/10B VACFAT','Antech SYSTEM 03 E'];
  const {catalog}= (await request('/api/settings')).data;
  const before=(await request('/api/records')).data.length;
  assert.equal((await request('/api/records','POST',{...valid(),product:products[3],brand:'Aquax'})).status,400);
  assert.equal((await request('/api/records')).data.length,before);
  for(const product of products) {
    const expected=catalog.find(p=>p.product===product);
    const created=await request('/api/records','POST',{...valid(),brand:expected.brand,product});assert.equal(created.status,201,product);
    assert.equal(created.data.brand,expected.brand);assert.equal(created.data.model,expected.model);assert.equal(created.data.category,expected.category);assert.deepEqual(created.data.catalogSource,expected.source);
    const document=await request(`/print?id=${created.data.id}&type=accept`);assert.equal(document.status,200);assert.ok(document.data.includes(product));
  }
  assert.equal((await request('/api/records')).data.length,before+products.length);
});
test('TL ve Euro teklifler, eski TL kayıtları ve yeniden onay',async()=>{
  const created=(await request('/api/records','POST',valid())).data;
  const legacy=new DatabaseSync(join(temp,'servicehub.sqlite'));
  const old={...created,quoteAmount:125.50,quoteNote:'Eski TL teklifi'};
  delete old.quoteCurrency;
  legacy.prepare('UPDATE records SET value=? WHERE id=?').run(JSON.stringify(old),old.id);legacy.close();
  assert.ok((await request(`/print?id=${old.id}&type=inspect`)).data.includes('₺125,50'));
  let current=old;
  for(const currency of ['EUR','TRY']) {
    const quoted=await request('/api/records/'+old.id,'PATCH',{version:current.version,staff:'Ayşe Yılmaz',action:'quote',amount:275.25,currency,note:'İşçilik'});
    assert.equal(quoted.status,200);current=quoted.data;
    assert.equal(current.quoteCurrency,currency);assert.equal(current.quoteAmount,275.25);assert.equal(current.approval,null);
    for(const type of ['accept','inspect','finish']) assert.ok((await request(`/print?id=${old.id}&type=${type}`)).data.includes(currency==='EUR'?'€275,25':'₺275,25'));
    const approved=await request('/api/records/'+old.id,'PATCH',{version:current.version,staff:'Ayşe Yılmaz',action:'approve',approvedBy:'Müşteri',method:'Telefon'});
    assert.equal(approved.status,200);current=approved.data;
  }
  assert.equal((await request('/api/records/'+old.id,'PATCH',{version:current.version,staff:'Ayşe Yılmaz',action:'quote',amount:10,currency:'USD',note:'Geçersiz'})).status,400);
  assert.equal((await request('/api/records')).data.find(r=>r.id===old.id).quoteCurrency,'TRY');
});

test('silme yetki, CSRF, sürüm ve onay kontrolü; fotoğraf temizliği ve numara korunması',async()=>{
  const payload={...valid(),photos:[{name:'test.png',type:'image/png',data:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')}]};
  const created=(await request('/api/records','POST',payload)).data;
  const path='/api/records/'+created.id;
  const data={version:created.version,staff:'Ayşe Yılmaz',confirmId:created.id};
  assert.equal((await request(path,'DELETE',data,{cookie:''})).status,401);
  assert.equal((await request(path,'DELETE',data,{'x-csrf-token':'wrong'})).status,403);
  assert.equal((await request(path,'DELETE',{...data,version:0})).status,409);
  assert.equal((await request(path,'DELETE',{...data,staff:'Bilinmeyen'})).status,400);
  assert.equal((await request(path,'DELETE',{...data,confirmId:'yanlış'})).status,400);
  assert.ok((await request('/api/records')).data.some(r=>r.id===created.id));
  assert.equal((await request(path,'DELETE',data)).status,200);
  assert.ok(!(await request('/api/records')).data.some(r=>r.id===created.id));
  assert.equal((await request('/api/photos/'+created.photos[0].id)).status,404);
  assert.equal((await request(`/print?id=${created.id}&type=accept`)).status,404);
  assert.equal((await request(path,'DELETE',data)).status,404);
  const db=new DatabaseSync(join(temp,'servicehub.sqlite'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM intake_requests WHERE record_id=?').get(created.id).n,0);db.close();
  const next=(await request('/api/records','POST',valid())).data;
  assert.ok(Number(next.id.split('-').at(-1))>Number(created.id.split('-').at(-1)));
});

test('8 karakter yeni şifre; eski şifre, CSRF ve diğer oturumlar denetlenir',async()=>{
  const other=await request('/api/login','POST',{password:'Test-Strong-Password-123'});
  assert.equal(other.status,200);const otherCookie=other.headers['set-cookie'].split(';')[0];
  const change={currentPassword:'Test-Strong-Password-123',newPassword:'Eight!26',confirmPassword:'Eight!26'};
  assert.equal((await request('/api/password','PATCH',change,{'x-csrf-token':'wrong'})).status,403);
  assert.equal((await request('/api/password','PATCH',{...change,newPassword:'1234567',confirmPassword:'1234567'})).status,400);
  assert.equal((await request('/api/password','PATCH',{...change,confirmPassword:'mismatch'})).status,400);
  assert.equal((await request('/api/password','PATCH',{...change,currentPassword:'incorrect'})).status,400);
  assert.equal((await request('/api/password','PATCH',change)).status,200);
  assert.equal((await request('/api/session')).data.authenticated,true);
  assert.equal((await request('/api/session','GET',undefined,{cookie:otherCookie})).data.authenticated,false);
  assert.equal((await request('/api/login','POST',{password:change.currentPassword})).status,401);
  assert.equal((await request('/api/login','POST',{password:change.newPassword})).status,200);
});

test('personel silme ve boş liste kaydetme geçmiş kayıtlara dokunmaz',async()=>{
  const before=(await request('/api/records')).data;
  assert.equal((await request('/api/settings','PATCH',{removeStaff:'Olmayan'})).status,409);
  const first=await request('/api/settings','PATCH',{removeStaff:'Ayşe Yılmaz'});assert.equal(first.status,200);assert.deepEqual(first.data.staff,['Mehmet Kaya']);
  const last=await request('/api/settings','PATCH',{removeStaff:'Mehmet Kaya'});assert.equal(last.status,200);assert.deepEqual(last.data.staff,[]);
  assert.equal((await request('/api/settings','PATCH',{staff:[]})).status,200);
  assert.deepEqual((await request('/api/records')).data,before);
  assert.equal((await request('/api/records','POST',valid())).status,400);
});

test('tek isimle personel ekleme ve isteğe bağlı e-posta',async()=>{
  const added=await request('/api/settings','PATCH',{addStaff:'Ayşe Yılmaz'});assert.equal(added.status,200);assert.deepEqual(added.data.staff,['Ayşe Yılmaz']);
  assert.equal((await request('/api/settings','PATCH',{addStaff:'AYŞE YILMAZ'})).status,400);
  const data=valid();delete data.email;
  const created=await request('/api/records','POST',data);assert.equal(created.status,201);assert.equal(created.data.email,'');
});

const userCookie=r=>r.headers['set-cookie'].split(';')[0];

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
  const data={...valid(),handledBy:'Sahte Personel',photos:[]};
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
  process.env.BREVO_API_KEY='test-only-key';process.env.MAIL_FROM='sender@example.com';const sentMails=[];setMailTransportForTest({async fetch(url,options){assert.equal(url,'https://api.brevo.com/v3/smtp/email');sentMails.push(JSON.parse(options.body));return Response.json({messageId:'test-message'});}});
  const reg=(data,ip='203.0.113.20')=>request('/api/register','POST',data,{cookie:'','x-test-ip':ip});
  const applicant={name:'Başvuran Kişi',email:'Basvuran.1@example.com',password:'Basvuru!2026',confirmPassword:'Basvuru!2026',active:true,role:'admin',pending:false};
  assert.equal((await request('/api/register','POST',applicant,{cookie:'',origin:'https://attacker.example','x-test-ip':'203.0.113.21'})).status,403);
  for(const [i,change] of [{email:'invalid'},{name:''},{password:'short',confirmPassword:'short'},{confirmPassword:'different'}].entries())assert.equal((await reg({...applicant,...change},'203.0.113.'+(30+i))).status,400);
  const started=await reg(applicant);assert.equal(started.status,202);assert.equal(started.data.verificationRequired,true);assert.equal(started.data.code,undefined);assert.equal(started.headers['set-cookie']??null,null);
  assert.ok(!JSON.stringify((await request('/api/users')).data).includes('basvuran.1@example.com'));
  const verify=(challenge,code)=>request('/api/register/verify','POST',{challenge,code},{cookie:'','x-test-ip':'203.0.113.23'});
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

after(()=>{closeDatabase();rmSync(temp,{recursive:true,force:true});});
