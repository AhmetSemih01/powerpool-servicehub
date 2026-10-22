export function filterProducts(catalog,brand,category='',query='') {
  const normalize=value=>String(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/ı/g,'i');
  const needle=normalize(query).trim();
  return catalog.filter(p=>p.brand===brand&&(!category||p.category===category)&&(!needle||normalize(p.model+' '+p.product).includes(needle)));
}
