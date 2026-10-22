const enc=new TextEncoder();
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const random=bytes=>Array.from(crypto.getRandomValues(new Uint8Array(bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export function emailAddress(value){
  if(typeof value!=='string')fail('Geçerli bir e-posta adresi girin.');
  const email=value.trim().toLowerCase();
  if(email.length>254||! /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email)||email.includes('..'))fail('Geçerli bir e-posta adresi girin.');
  return email;
}
export const mailReady=env=>!!(env.BREVO_API_KEY&&env.MAIL_FROM);
function verificationCode(){
  let number;do{number=crypto.getRandomValues(new Uint32Array(1))[0];}while(number>=4294000000);
  return String(number%1000000).padStart(6,'0');
}
export async function limit(db,key,count,window,now,message){
  const row=await db.prepare('INSERT INTO registration_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until>? THEN count+1 ELSE 1 END, until=CASE WHEN until>? THEN until ELSE excluded.until END RETURNING count').bind(key,now+window,now,now).first();
  if(row.count>count)fail(message||'Çok fazla deneme. Daha sonra yeniden deneyin.',429);
}
export async function sendCode(env,email,name,code,purpose='kayıt doğrulama'){
  let sender;try{sender=emailAddress(env.MAIL_FROM);}catch{fail('E-posta gönderici ayarı tamamlanmamış. Yöneticiyle iletişime geçin.',503);}
  try{
    const transport=env.MAIL_TRANSPORT||{fetch:(...args)=>fetch(...args)};
    const response=await transport.fetch('https://api.brevo.com/v3/smtp/email',{
      method:'POST',signal:AbortSignal.timeout(10000),
      headers:{'api-key':env.BREVO_API_KEY,'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify({sender:{email:sender,name:'POWERPOOL'},to:[{email,name}],subject:`POWERPOOL ${purpose} kodunuz`,
        textContent:`POWERPOOL ${purpose} kodunuz: ${code}\nKod 10 dakika geçerlidir. Bu işlemi siz başlatmadıysanız mesajı yok sayın.`,
        htmlContent:`<h2>POWERPOOL</h2><p>${purpose} kodunuz:</p><p style="font-size:30px;letter-spacing:6px;font-weight:bold">${code}</p><p>Kod 10 dakika geçerlidir. Bu işlemi siz başlatmadıysanız mesajı yok sayın.</p>`})
    });
    const result=await response.json();
    if(!response.ok||typeof result.messageId!=='string'||!result.messageId)throw new Error('Mail rejected');
  }catch{fail('Doğrulama e-postası gönderilemedi. Biraz sonra yeniden deneyin veya yöneticiyle iletişime geçin.',503);}
}
export async function startRegistration({db,env,data,ip,passwordHash,text,now=Date.now()}){
  if(!mailReady(env))fail('E-posta doğrulama hizmeti henüz etkinleştirilmedi. Yöneticiyle iletişime geçin.',503);
  const name=text(data.name,'Ad soyad',100,true),email=emailAddress(data.email),password=text(data.password,'Şifre',200,true);
  if(password.length<8)fail('En az 8 karakterli bir şifre belirleyin.');
  if(password!==data.confirmPassword)fail('Şifreler aynı değil.');
  const addressHash=await hash(email);
  await limit(db,'send-ip:'+await hash(ip),20,3600000,now,'Bu internet bağlantısı için saatlik 20 kod isteği sınırına ulaşıldı. Biraz sonra yeniden deneyin.');
  await limit(db,'send-email:'+addressHash,3,3600000,now,'Bu e-posta adresi için saatlik 3 kod isteği sınırına ulaşıldı. Son gelen kodu kullanın veya daha sonra yeniden deneyin.');
  await limit(db,'send-day:'+new Date(now).toISOString().slice(0,10),200,86400000,now,'Günlük e-posta gönderim sınırına ulaşıldı. Daha sonra yeniden deneyin.');
  await db.prepare('DELETE FROM registration_limits WHERE until<?').bind(now).run();
  await db.prepare('DELETE FROM registration_challenges WHERE expires<?').bind(now).run();
  if(await db.prepare('SELECT user_key FROM account_emails WHERE email=?').bind(email).first())fail('Bu e-posta ile kayıtlı bir hesap var. Giriş yapın.',409);
  const token=random(24),id=await hash(token),code=verificationCode(),salt=random(24);
  const account={username:'e'+random(12),name,email,salt,hash:await passwordHash(password,salt),active:false,pending:true,rejected:false,createdAt:new Date(now).toISOString()};
  const row=await db.prepare('INSERT INTO registration_challenges(id,email,value,code_hash,expires,tries,sent,created) VALUES(?,?,?,?,?,0,0,?) ON CONFLICT(email) DO UPDATE SET id=excluded.id,value=excluded.value,code_hash=excluded.code_hash,expires=excluded.expires,tries=0,sent=0,created=excluded.created WHERE registration_challenges.created<=? RETURNING id').bind(id,email,JSON.stringify(account),await hash(token+':'+code),now+600000,now,now-60000).first();
  if(!row)fail('Yeni kod istemeden önce 60 saniye bekleyin.',429);
  try{
    await sendCode(env,email,name,code);
    const sent=await db.prepare('UPDATE registration_challenges SET sent=1 WHERE id=? AND expires>?').bind(id,Date.now()).run();
    if(!sent.meta.changes)fail('Kodun süresi doldu. Yeniden kod isteyin.');
  }catch(error){await db.prepare('DELETE FROM registration_challenges WHERE id=?').bind(id).run();throw error;}
  return {ok:true,verificationRequired:true,challenge:token,expiresIn:600,message:'Doğrulama kodu e-posta hizmetine iletildi. Gelen kutunuzu ve spam klasörünü kontrol edin.'};
}
export async function verifyRegistration({db,data,ip,now=Date.now()}){
  await limit(db,'verify-ip:'+await hash(ip),20,900000,now);
  if(typeof data.challenge!=='string'||!/^[a-f0-9]{48}$/.test(data.challenge)||typeof data.code!=='string'||!/^\d{6}$/.test(data.code))fail('E-postadaki 6 haneli kodu girin.');
  const id=await hash(data.challenge);
  const row=await db.prepare('UPDATE registration_challenges SET tries=tries+1 WHERE id=? AND sent=1 AND expires>? AND tries<5 RETURNING *').bind(id,now).first();
  if(!row||row.code_hash!==await hash(data.challenge+':'+data.code))fail('Kod yanlış, süresi dolmuş veya deneme sınırına ulaşılmış. Yeniden kod isteyebilirsiniz.');
  const account={...JSON.parse(row.value),emailVerifiedAt:new Date(now).toISOString()},key='user:'+account.username,value=JSON.stringify(account);
  const results=await db.batch([
    db.prepare("INSERT OR IGNORE INTO settings SELECT ?,? WHERE EXISTS(SELECT 1 FROM registration_challenges WHERE id=? AND code_hash=? AND sent=1 AND expires>? AND tries<=5) AND NOT EXISTS(SELECT 1 FROM account_emails WHERE email=?) AND (SELECT COUNT(*) FROM settings WHERE key LIKE 'user:%' AND (json_extract(value,'$.pending')=1 OR json_extract(value,'$.rejected')=1))<100").bind(key,value,id,row.code_hash,now,row.email),
    db.prepare('INSERT OR IGNORE INTO account_emails SELECT ?,? WHERE EXISTS(SELECT 1 FROM settings WHERE key=? AND value=?) AND EXISTS(SELECT 1 FROM registration_challenges WHERE id=?)').bind(row.email,key,key,value,id),
    db.prepare('DELETE FROM registration_challenges WHERE id=? AND EXISTS(SELECT 1 FROM account_emails WHERE email=? AND user_key=?)').bind(id,row.email,key)
  ]);
  if(!results[0].meta.changes||!results[1].meta.changes)fail('Başvuru zaten doğrulanmış veya başvuru sınırına ulaşılmış. Yöneticiyle iletişime geçin.',409);
  return {ok:true,pending:true,email:row.email,message:'E-posta adresiniz doğrulandı. Yönetici onayından sonra e-posta adresiniz ve şifrenizle giriş yapabilirsiniz.'};
}
