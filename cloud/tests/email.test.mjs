import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {startRegistration,verifyRegistration} from '../src/registration.mjs';

function fixture(){
  const sql=new DatabaseSync(':memory:');
  sql.exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);");
  sql.exec(readFileSync(new URL('../migrations/0003_email_verification.sql',import.meta.url),'utf8'));
  const db={prepare(query){let args=[];const statement={bind(...values){args=values;return statement;},first(){return sql.prepare(query).get(...args)||null;},run(){return {meta:{changes:sql.prepare(query).run(...args).changes}};}};return statement;},batch(statements){sql.exec('BEGIN');try{const result=statements.map(s=>s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  const sent=[];let rejectMail=false;
  const env={BREVO_API_KEY:'isolated-test-key',MAIL_FROM:'sender@example.com',MAIL_TRANSPORT:{async fetch(url,options){sent.push(JSON.parse(options.body));return rejectMail?Response.json({message:'denied'}, {status:403}):Response.json({messageId:'test-message'});}}};
  const data={name:'E-posta Testi',email:'Mail.Test@Example.com',password:'Test!Password2026',confirmPassword:'Test!Password2026'};
  const context={db,env,data,ip:'192.0.2.20',passwordHash:async()=> 'test-password-hash',text(value,label,max,required){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw Object.assign(new Error(label),{status:400});return value.trim();}};
  return {sql,db,env,data,context,sent,code:()=>sent.at(-1).textContent.match(/\b\d{6}\b/)[0],rejectMail(){rejectMail=true;}};
}
const rejects=(promise,status)=>assert.rejects(promise,error=>error.status===status);

test('e-posta gönderimi ayarsızken veya sağlayıcı reddettiğinde doğrulanabilir başvuru oluşmaz',async()=>{
  const f=fixture();try{
    await rejects(startRegistration({...f.context,env:{}}),503);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM registration_challenges').get().n,0);
    f.rejectMail();await rejects(startRegistration(f.context),503);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM registration_challenges').get().n,0);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM settings').get().n,0);
  }finally{f.sql.close();}
});

test('kod ve şifre açık metin saklanmaz; doğru kod tek kez kullanılır ve e-posta benzersizdir',async()=>{
  const f=fixture();try{
    const begin=await startRegistration(f.context),code=f.code();
    assert.equal(begin.code,undefined);assert.equal(begin.csrf,undefined);
    const row=f.sql.prepare('SELECT * FROM registration_challenges').get();
    assert.notEqual(row.id,begin.challenge);assert.notEqual(row.code_hash,code);
    assert.ok(!row.value.includes(f.data.password));assert.ok(!row.value.includes(code));
    const verified=await verifyRegistration({db:f.db,ip:f.context.ip,data:{challenge:begin.challenge,code}});
    assert.equal(verified.email,'mail.test@example.com');assert.equal(verified.pending,true);
    await rejects(verifyRegistration({db:f.db,ip:f.context.ip,data:{challenge:begin.challenge,code}}),400);
    await rejects(startRegistration(f.context),409);
    const account=JSON.parse(f.sql.prepare('SELECT value FROM settings').get().value);
    assert.equal(account.active,false);assert.ok(account.emailVerifiedAt);
  }finally{f.sql.close();}
});

test('beş yanlış kod sonrası doğru kod da reddedilir; kod 10 dakika sonra geçersizdir',async()=>{
  for(const expired of [false,true]){
    const f=fixture();try{
      const begin=await startRegistration(f.context),code=f.code(),now=Date.now();
      const verify=(value,time=now)=>verifyRegistration({db:f.db,ip:f.context.ip,now:time,data:{challenge:begin.challenge,code:value}});
      if(expired)await rejects(verify(code,now+600001),400);
      else{for(let i=0;i<5;i++)await rejects(verify(code==='000000'?'000001':'000000'),400);await rejects(verify(code),400);}
      assert.equal(f.sql.prepare('SELECT count(*) n FROM settings').get().n,0);
    }finally{f.sql.close();}
  }
});

test('yeniden gönderim eski kodu ve bağlantıyı iptal eder; 60 saniye bekleme uygulanır',async()=>{
  const f=fixture();try{
    const now=Date.now(),first=await startRegistration({...f.context,now}),old=f.code();
    await rejects(startRegistration({...f.context,now:now+1000}),429);
    const second=await startRegistration({...f.context,now:now+61000}),code=f.code();
    await rejects(verifyRegistration({db:f.db,ip:f.context.ip,now:now+62000,data:{challenge:first.challenge,code:old}}),400);
    assert.equal((await verifyRegistration({db:f.db,ip:f.context.ip,now:now+62000,data:{challenge:second.challenge,code}})).pending,true);
    await rejects(startRegistration({...f.context,now:now+63000}),429);
  }finally{f.sql.close();}
});

test('aynı doğrulamanın eşzamanlı gönderilmesi tek bir hesap oluşturur',async()=>{
  const f=fixture();try{
    const begin=await startRegistration(f.context),data={challenge:begin.challenge,code:f.code()};
    const attempts=await Promise.allSettled([verifyRegistration({db:f.db,ip:f.context.ip,data}),verifyRegistration({db:f.db,ip:f.context.ip,data})]);
    assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM settings').get().n,1);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM account_emails').get().n,1);
  }finally{f.sql.close();}
});


test('aynı internet bağlantısında farklı personeller kayıt olabilir; 21. istekte IP sınırı uygulanır',async()=>{
  const f=fixture();try{
    for(let i=0;i<20;i++)assert.equal((await startRegistration({...f.context,data:{...f.data,email:'staff'+i+'@example.com'}})).verificationRequired,true);
    await rejects(startRegistration({...f.context,data:{...f.data,email:'over-limit@example.com'}}),429);
    assert.equal(f.sent.length,20);
  }finally{f.sql.close();}
});
