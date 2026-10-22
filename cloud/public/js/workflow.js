export function nextActionFor(record) {
  switch(record.status) {
    case 'received': return {label:'İncelemeye Al',status:'review',tab:'work'};
    case 'review': return {label:'Teklif Hazırla',target:'quoteAmount',tab:'work'};
    case 'waiting': return record.quoteAmount==null ? {label:'Teklif Hazırla',target:'quoteAmount',tab:'work'} : {label:'Müşteri Onayını Kaydet',target:'approvedBy',tab:'work'};
    case 'approved': return {label:'Onarıma Başla',status:'repair',tab:'work'};
    case 'repair': return {label:'Onarımı Tamamla',status:'repaired',tab:'work'};
    case 'repaired': return {label:'Testi Tamamla',status:'tested',tab:'work'};
    case 'tested': return {label:'Teslim Et',status:'shipped',tab:'documents'};
    default: return {label:'Belgeleri Gör',tab:'documents'};
  }
}

export function groupCustomers(records,type='') {
  const groups=new Map();
  for(const record of records) {
    if(type && record.customerType!==type)continue;
    const name=record.customer.toLocaleLowerCase('tr-TR');
    const contact=record.email?.trim().toLowerCase() || record.phone.replace(/\D/g,'');
    const key=JSON.stringify([record.customerType,name,contact]);
    const existing=groups.get(key);
    if(existing)existing.count++;
    else groups.set(key,{...record,count:1});
  }
  return [...groups.values()];
}
