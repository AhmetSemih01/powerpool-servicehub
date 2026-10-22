# POWERPOOL ServiceHub

Havuz teknik servis kayıt ve operasyon yönetimi.

## Proje dizinleri

- `cloud/`: Canlı Cloudflare Workers sürümü. HTML, CSS, JavaScript ve görseller `public/` altında ayrı klasörlerdedir. D1 veritabanı şemaları `migrations/` içindedir.
- `local/`: Bilgisayarda çalışan Node.js/SQLite sürümü. HTML, CSS, JavaScript ve görseller ayrı dosya/klasörlerdedir. Canlı sürümdeki son operasyon geliştirmeleri için `cloud/` esas alınır.
- `docs/`: Katalog ve pompa modeli doğrulama listeleri.

## Gereksinimler ve testler

Node.js 24 veya üstü kullanın.

```sh
npm --prefix cloud test
npm --prefix local test
```

Yerel sürümü başlatmak için:

```sh
npm --prefix local start
```

Canlı sürümün kurulumu ve yayınlanması: [Cloudflare kurulum belgesi](cloud/CLOUD_KURULUM.md).
Yerel sürümün kullanımı: [Yerel kurulum belgesi](local/README.md).

## Canlı sistem

https://powerpool-servicehub.powerpool.workers.dev/

Cloudflare yapılandırması mevcut projeye aittir. Yeni hesapta kurulum yaparken hesap, D1 ve KV kimliklerini kendi kaynaklarınızla değiştirin. Mevcut kaynakları yeniden oluşturmadan mevcut verileri koruyun.

## Gizli bilgiler ve çalışma verileri

API anahtarları, şifreler, oturum bilgileri, müşteri veritabanı, fotoğraf yüklemeleri ve yedekler bu depoya dahil edilmez. Brevo anahtarı ve gönderici adresi sunucu ortamında/Cloudflare Secrets içinde tanımlanır. Depoyu klonlamak canlı müşteri verilerini kopyalamaz. Testlerde kullanılan hesaplar ve parolalar yalnızca geçici test verileridir.

Bu kaynak deposu 22 Ekim 2026 tarihinde çalışan proje dosyalarından hazırlanmıştır.
