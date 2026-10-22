import {emailAddress,mailReady,sendCode,limit} from './registration.mjs';
import {token,fail} from './shared.mjs';
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export async function recover({db,env,data,ip,passwordHash,text,verify=false}) {
  const now=Date.now();
  await limit(db,'reset-ip:'+await hash(ip),verify?20:5,3600000,now);
  if(verify){
    if(!/^[a-f0-9]{48}$/.test(data.challenge||'')||!/^\d{6}$/.test(data.code||''))fail('Geçerli doğrulama kodunu girin.');
    const password=text(data.password,'Şifre',200,true);
    if(password.length<8||password!==data.confirmPassword)fail('Şifreler aynı ve en az 8 karakter olmalı.');
    const id=await hash(data.challenge),row=await db.prepare('UPDATE password_resets SET tries=tries+1 WHERE id=? AND expires>? AND tries<5 RETURNING *').bind(id,now).first();
    if(!row||row.code_hash!==await hash(data.challenge+':'+data.code))fail('Kod yanlış, süresi dolmuş veya deneme sınırı aşılmış.');
    const old=await db.prepare('SELECT value FROM settings WHERE key=?').bind(row.user_key).first();
    const account=old?JSON.parse(old.value):null;
    if(!account||account.active===false||account.pending||account.rejected)fail('Hesap için şifre yenilenemiyor.');
    const salt=token(24),next=JSON.stringify({...account,salt,hash:await passwordHash(password,salt)});
    const results=await db.batch([
      db.prepare('UPDATE settings SET value=? WHERE key=? AND value=? AND EXISTS(SELECT 1 FROM password_resets WHERE id=? AND expires>? AND tries<=5)').bind(next,row.user_key,old.value,id,now),
      db.prepare('DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM settings WHERE key=? AND value=?)').bind(row.user_key,row.user_key,next),
      db.prepare('DELETE FROM password_resets WHERE id=? AND EXISTS(SELECT 1 FROM settings WHERE key=? AND value=?)').bind(id,row.user_key,next)
    ]);
    if(!results[0].meta.changes)fail('Kod daha önce kullanıldı. Yeniden kod isteyin.',409);
    return {ok:true,message:'Şifreniz yenilendi. Yeni şifrenizle giriş yapın.'};
  }
  if(!mailReady(env))fail('E-posta hizmeti etkin değil.',503);
  const email=emailAddress(data.email);
  await limit(db,'reset-email:'+await hash(email),3,3600000,now);
  await limit(db,'reset-cooldown:'+await hash(email),1,60000,now,'Yeni kod için 60 saniye bekleyin.');
  await limit(db,'send-day:'+new Date(now).toISOString().slice(0,10),200,86400000,now);
  await db.prepare('DELETE FROM password_resets WHERE expires<?').bind(now).run();
  const challenge=token(24),id=await hash(challenge);
  const user=await db.prepare('SELECT user_key FROM account_emails WHERE email=?').bind(email).first();
  const row=user?await db.prepare('SELECT value FROM settings WHERE key=?').bind(user.user_key).first():null;
  const account=row?JSON.parse(row.value):null;
  if(account&&account.active!==false&&!account.pending&&!account.rejected){
    let random;do{random=crypto.getRandomValues(new Uint32Array(1))[0];}while(random>=4294000000);
    const code=String(random%1000000).padStart(6,'0');
    const inserted=await db.prepare('INSERT INTO password_resets VALUES(?,?,?,?,0) ON CONFLICT(user_key) DO UPDATE SET id=excluded.id,code_hash=excluded.code_hash,expires=excluded.expires,tries=0 WHERE password_resets.expires<=? RETURNING id').bind(id,user.user_key,await hash(challenge+':'+code),now+600000,now+540000).first();
    if(!inserted)fail('Yeni kod için 60 saniye bekleyin.',429);
    try{await sendCode(env,email,account.name,code,'şifre yenileme');}catch(error){await db.prepare('DELETE FROM password_resets WHERE id=?').bind(id).run();throw error;}
  }
  return {ok:true,challenge,message:'Adresiniz onaylı ve etkin bir hesaba aitse şifre yenileme kodu gönderildi. Kod 10 dakika geçerlidir.'};
}
