import {emailAddress} from './registration.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const random=n=>Array.from(crypto.getRandomValues(new Uint8Array(n)),b=>b.toString(16).padStart(2,'0')).join('');
export async function createEmailAccount({db,data,name,passwordHash,text}){
  const email=emailAddress(data.email),password=text(data.password,'Şifre',200,true);
  if(password.length<8)fail('En az 8 karakterli bir şifre belirleyin.');
  if(password!==data.confirmPassword)fail('Şifreler aynı değil.');
  const username='e'+random(12),key='user:'+username,salt=random(24);
  const account={username,name,email,active:true,pending:false,rejected:false,createdByAdmin:true,createdAt:new Date().toISOString(),salt,hash:await passwordHash(password,salt)};
  const value=JSON.stringify(account);
  const result=await db.batch([
    db.prepare("INSERT INTO settings SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM account_emails WHERE email=?) AND (SELECT COUNT(*) FROM settings WHERE key LIKE 'user:%' AND COALESCE(json_extract(value,'$.pending'),0)=0 AND COALESCE(json_extract(value,'$.rejected'),0)=0)<40").bind(key,value,email),
    db.prepare('INSERT INTO account_emails SELECT ?,? WHERE EXISTS(SELECT 1 FROM settings WHERE key=? AND value=?)').bind(email,key,key,value)
  ]);
  if(!result[0].meta.changes)fail('Bu e-posta zaten kayıtlı veya 40 kullanıcı sınırına ulaşıldı.',409);
  return {key,account};
}
