import {fail,text,STATUS_LABEL} from './shared.mjs';
import {quoteCurrency} from '../public/js/currency.js';
const STATUSES=Object.keys(STATUS_LABEL);
export function update(r,data,staff){const now=new Date().toISOString();let action;
        if(data.action==='status') {
          if(!STATUSES.includes(data.status)) fail('Geçersiz servis durumu.');
          if(data.status==='approved') fail('Müşteri onayını teklif bölümünden kaydedin.');
          if(data.status==='waiting' && r.quoteAmount==null) fail('Önce bir teklif oluşturun.');
          if(['repair','repaired','tested','shipped'].includes(data.status) && r.quoteAmount!=null && !r.approval) fail('Ücretli onarıma başlamadan önce müşteri onayı kaydedilmeli.');
          r.status=data.status; action='Durum güncellendi';
        } else if(data.action==='quote') {
          if(typeof data.amount!=='number'||!Number.isFinite(data.amount)||data.amount<0||data.amount>1e9||Math.abs(data.amount*100-Math.round(data.amount*100))>0.00001) fail('En fazla iki ondalıklı geçerli bir tutar girin.');
          const currency=data.currency ?? quoteCurrency(r);
          if(!['TRY','EUR'].includes(currency)) fail('Para birimi TL (TRY) veya Euro (EUR) olmalıdır.');
          r.quoteRate=data.exchange||null; r.quoteCreatedAt=now; r.quoteAmount=data.amount; r.quoteCurrency=currency; r.quoteNote=text(data.note,'Teklif açıklaması',1000,true); r.status='waiting'; r.approval=null; action=`${currency==='TRY'?'TL':'Euro'} onarım teklifi oluşturuldu`;
        } else if(data.action==='approve') {
          if(r.status!=='waiting'||r.quoteAmount==null) fail('Onay bekleyen bir teklif bulunmuyor.');
          if(data.exchange)r.quoteRate=data.exchange; r.approval={by:text(data.approvedBy,'Onay veren kişi',100,true),method:text(data.method,'Onay yöntemi',100,true),at:now,recordedBy:staff}; r.status='approved'; action=`Müşteri onayı kaydedildi: ${r.approval.by} (${r.approval.method})`;
        } else if(data.action==='payment') {
          if(r.quoteAmount==null||!r.approval)fail('Ödeme için önce onaylı bir teklif olmalı.');
          if(typeof data.amount!=='number'||!Number.isFinite(data.amount)||data.amount<=0||Math.abs(data.amount*100-Math.round(data.amount*100))>0.00001)fail('Geçerli ödeme tutarı girin.');
          r.payments=r.payments||[];
          const paid=r.payments.reduce((sum,p)=>sum+(p.voidedAt?0:p.amount),0);
          if(Math.round((paid+data.amount)*100)>Math.round(r.quoteAmount*100))fail('Ödeme kalan bakiyeyi aşamaz.');
          const note=text(data.note,'Ödeme notu',300,true);
          r.payments.push({id:crypto.randomUUID(),amount:data.amount,currency:quoteCurrency(r),at:now,staff,note});
          action='Ödeme kaydedildi: '+data.amount+' '+quoteCurrency(r);
        } else if(data.action==='paymentVoid') {
          const payment=(r.payments||[]).find(p=>p.id===data.paymentId&&!p.voidedAt);if(!payment)fail('Ödeme bulunamadı veya iptal edilmiş.');
          payment.voidedAt=now;payment.voidedBy=staff;payment.voidReason=text(data.note,'İptal nedeni',300,true);action='Ödeme iptal edildi: '+payment.amount+' '+payment.currency+' · '+payment.voidReason;
        } else if(data.action==='notes') {
          r.technician=staff; r.findings=text(data.findings,'Teknik tespit',3000); r.work=text(data.work,'Yapılan işlemler',3000); r.tests=text(data.tests,'Test sonucu',2000);
          if(!['pending','warranty','outside'].includes(data.warranty)) fail('Garanti değerlendirmesi geçersiz.');
          r.warranty=data.warranty; action='Teknik inceleme ve onarım notları kaydedildi';
        } else fail('Geçersiz işlem.');

r.history.push({at:now,staff,action,status:r.status});r.version++;r.updatedAt=now;return r;}
