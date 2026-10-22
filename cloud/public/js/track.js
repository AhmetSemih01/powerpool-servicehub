import {formatMoney} from './currency.js';
let token=location.hash.slice(1);
try{if(token)sessionStorage.setItem('powerpool.tracking',token);else token=sessionStorage.getItem('powerpool.tracking')||'';}catch{}
history.replaceState(null,'',location.pathname);
async function load(){
  const message=document.querySelector('#trackingStatus'),details=document.querySelector('#trackingDetails'),button=document.querySelector('#trackingRefresh');
  button.disabled=true;
  try{
    const response=await fetch('/api/tracking',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
    const r=await response.json();if(!response.ok)throw new Error(r.error);
    message.textContent=r.status;
    const rows=[['Servis',r.id],['Ürün',r.product],['Son güncelleme',new Date(r.updatedAt).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'})]];
    if(r.quoteAmount!=null){rows.push(['Teklif',formatMoney(r.quoteAmount,r.quoteCurrency)]);if(r.quoteRate&&r.quoteCurrency==='EUR')rows.push(['TL karşılığı',formatMoney(Math.round(r.quoteAmount*r.quoteRate.rate*100)/100,'TRY')],['Kur',`TCMB ${r.quoteRate.type||'EUR döviz satış'} · ${r.quoteRate.date} · ${r.quoteRate.rate} TL`]);rows.push(['Teklif onayı',r.approved?'Kaydedildi':'Bekleniyor']);}
    details.replaceChildren(...rows.map(([label,value])=>{const p=document.createElement('p'),strong=document.createElement('strong');strong.textContent=label+': ';p.append(strong,document.createTextNode(value));return p;}));
  }catch(error){message.textContent=error.message;details.replaceChildren();}finally{button.disabled=false;}
}
document.querySelector('#trackingRefresh').addEventListener('click',load);load();
