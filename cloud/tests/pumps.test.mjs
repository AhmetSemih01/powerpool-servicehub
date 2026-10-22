import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filterProducts} from '../public/js/catalog-utils.js';
const catalog=JSON.parse(readFileSync(new URL('../catalog/products.json',import.meta.url),'utf8'));
const pumps=catalog.items.filter(p=>p.category==='pump');
test('POWERPOOL PDF 5–8 sayfalarındaki 19 ürün kodu, HP, faz ve ön filtre eşleşir',()=>{
  const expected=[
    ['PMPMN.050M',.5,'Monofaze',true,5],['PMPMN.075M',.75,'Monofaze',true,5],['PMPMN.100M',1,'Monofaze',true,5],['PMPMN.150M',1.5,'Monofaze',true,5],
    ['PMP.BTB120GA',1,'Monofaze',false,6],['PMP.BTP200GA',1.5,'Monofaze',false,6],['PMP.BTP250GC',2,'Monofaze',false,6],['PMP.BTP400GC',3,'Monofaze',false,6],
    ['PMPMJ.100M',1,'Monofaze',true,7],['PMPMJ.150M',1.5,'Monofaze',true,7],['PMPMJ.200M',2,'Monofaze',true,7],['PMPMJ.300M',3,'Monofaze',true,7],
    ['PMPMJ.100T',1,'Trifaze',true,7],['PMPMJ.150T',1.5,'Trifaze',true,7],['PMPMJ.200T',2,'Trifaze',true,7],['PMPMJ.300T',3,'Trifaze',true,7],
    ['PMP.BTP-2200',3,'Trifaze',false,8],['PMP.BTP-3000',4,'Trifaze',false,8],['PMP.BTP-4000',5.5,'Trifaze',false,8]
  ];
  assert.equal(pumps.length,19);
  for(const [code,hp,phase,prefilter,page] of expected){const p=pumps.find(p=>p.productCode===code);assert.ok(p,code);assert.equal(p.hp,hp);assert.equal(p.phase,phase);assert.equal(p.prefilter,prefilter);assert.equal(p.source.page,page);assert.ok(p.model.includes(`${hp} HP`));assert.ok(p.model.includes(phase));assert.ok(p.model.includes(code));}
  assert.equal(pumps.filter(p=>p.phase==='Monofaze').length,12);assert.equal(pumps.filter(p=>p.phase==='Trifaze').length,7);
});
test('pompa kodu ve faz ile arama yapılır; eski ürün anahtarı korunur',()=>{
  assert.equal(filterProducts(catalog.items,'MajeuerX','pump','trifaze').length,7);
  assert.equal(filterProducts(catalog.items,'MineuerX','pump','PMPMN.075M')[0].hp,.75);
  assert.equal(catalog.items.find(p=>p.product==='MineuerX 1 HP').productCode,'PMPMN.100M');
  assert.equal(new Set(catalog.items.map(p=>p.product)).size,495);
});
