export function parseRate(xml, now=Date.now()) {
  const date=/Tarih="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
  const euro=/<Currency\b[^>]*(?:Kod|CurrencyCode)="EUR"[^>]*>([\s\S]*?)<\/Currency>/.exec(xml)?.[1];
  const rate=Number(/<BanknoteSelling>([\d.]+)<\/BanknoteSelling>/.exec(euro||'')?.[1]);
  const unit=Number(/<Unit>(\d+)<\/Unit>/.exec(euro||'')?.[1]);
  if(!date||!Number.isFinite(rate)||rate<=0||rate>100000||unit!==1)throw new Error('TCMB kur verisi geçersiz.');
  const day=`${date[3]}-${date[2]}-${date[1]}`;
  if(!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day||day>new Date(now).toISOString().slice(0,10))throw new Error('TCMB tarihi geçersiz.');
  return {rate,date:day,source:'TCMB',type:'EUR efektif satış',checkedAt:now};
}
export async function getRate(env, force=false) {
  const row=await env.DB.prepare("SELECT value FROM settings WHERE key='exchange:EUR:banknote-selling'").first();
  const previous=row?JSON.parse(row.value):null;
  if(!force&&previous&&Date.now()-previous.checkedAt<3600000)return {...previous,stale:false};
  try {
    const response=await (env.RATE_TRANSPORT||{fetch:(...args)=>fetch(...args)}).fetch('https://www.tcmb.gov.tr/kurlar/today.xml',{signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Kur alınamadı.');
    const rate=parseRate(await response.text());
    await env.DB.prepare("INSERT INTO settings(key,value) VALUES('exchange:EUR:banknote-selling',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(rate)).run();
    return {...rate,stale:false};
  } catch {
    if(previous)return {...previous,stale:true};
    throw Object.assign(new Error('TCMB kuru şu anda alınamıyor. Biraz sonra yeniden deneyin.'),{status:503});
  }
}
