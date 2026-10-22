import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextActionFor,groupCustomers} from '../public/js/workflow.js';

test('sıradaki işlem servis aşamalarını korur ve müşteri onayını atlamaz',()=>{
  const sequence={received:'review',approved:'repair',repair:'repaired',repaired:'tested',tested:'shipped'};
  for(const [status,next] of Object.entries(sequence))assert.equal(nextActionFor({status}).status,next);
  assert.deepEqual(nextActionFor({status:'waiting',quoteAmount:100}),{label:'Müşteri Onayını Kaydet',target:'approvedBy',tab:'work'});
  assert.equal(nextActionFor({status:'review'}).target,'quoteAmount');
  assert.equal(nextActionFor({status:'waiting',quoteAmount:null}).target,'quoteAmount');
  assert.equal(nextActionFor({status:'shipped'}).tab,'documents');
  assert.equal(nextActionFor({status:'shipped'}).status,undefined);
});
test('e-postasız aynı adlı farklı müşteriler telefonlarıyla ayrılır',()=>{
  const records=[
    {id:'1',customer:'Ali',customerType:'individual',email:'',phone:'0555 111 22 33'},
    {id:'2',customer:'Ali',customerType:'individual',email:'',phone:'05551112233'},
    {id:'3',customer:'Ali',customerType:'individual',email:'',phone:'05559998877'}
  ];
  const groups=groupCustomers(records);assert.equal(groups.length,2);assert.equal(groups[0].count,2);
});
test('bayiler ve bireysel müşteriler aynı listede türleri korunarak filtrelenir',()=>{
  const base={customer:'Firma',email:'contact@example.com',phone:'05551234567'};
  const records=[{...base,customerType:'dealer'},{...base,customerType:'individual'}];
  assert.equal(groupCustomers(records).length,2);
  assert.equal(groupCustomers(records,'dealer').length,1);
  assert.equal(groupCustomers(records,'dealer')[0].customerType,'dealer');
});
