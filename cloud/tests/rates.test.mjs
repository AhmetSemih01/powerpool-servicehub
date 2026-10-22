import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseRate,getRate} from '../src/rates.mjs';
const xml='<Tarih_Date Tarih="20.10.2026"><Currency Kod="USD"><Unit>1</Unit><BanknoteSelling>35.0000</BanknoteSelling></Currency><Currency Kod="EUR"><Unit>1</Unit><ForexSelling>39.9999</ForexSelling><BanknoteSelling>40.1234</BanknoteSelling></Currency></Tarih_Date>';
test('yalnızca TCMB EUR efektif satış alınır; eksik ve geçersiz veriler reddedilir',()=>{
  assert.equal(parseRate(xml,Date.parse('2026-10-21')).rate,40.1234);
  assert.throws(()=>parseRate(xml.replace('<BanknoteSelling>40.1234','<BanknoteSelling>0'),Date.parse('2026-10-21')));
  assert.throws(()=>parseRate(xml.replace('20.10.2026','22.10.2026'),Date.parse('2026-10-21')));
  assert.throws(()=>parseRate('<html>Hata</html>'));
});
test('TCMB erişilemezse son kayıtlı kur tarihli ve stale olarak döner; kur yoksa hata verir',async()=>{
  let cached=null;
  const env={DB:{prepare(){return {bind(){return this;},async first(){return cached?{value:JSON.stringify(cached)}:null;}};}},RATE_TRANSPORT:{async fetch(){throw new Error('network');}}};
  await assert.rejects(getRate(env),e=>e.status===503);
  cached={rate:40,date:'2026-10-20',checkedAt:Date.now()-7200000};
  assert.equal((await getRate(env)).stale,true);
  cached.checkedAt=Date.now();assert.equal((await getRate(env)).stale,false);
});
