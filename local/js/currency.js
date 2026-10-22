export function quoteCurrency(record) {
  // Currency-less quotations were saved in TRY by earlier releases.
  return record.quoteCurrency ?? (record.quoteAmount == null ? 'EUR' : 'TRY');
}

export function formatMoney(amount, currency = 'EUR') {
  return Number(amount).toLocaleString('tr-TR', { style: 'currency', currency });
}
