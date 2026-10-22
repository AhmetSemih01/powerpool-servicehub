# POWERPOOL — ücretsiz çevrim içi sürüm

Bu klasör yerel `powerpool-servicehub` uygulamasından ayrıdır. Yerel SQLite dosyanız bu pakete alınmaz. Mevcut müşteri kayıtları henüz Cloudflare'a taşınmamıştır.

## Kalıcı depolama

- Servis kayıtları, personel, müşteri onayları, teklifler ve oturumlar: Cloudflare D1.
- Fotoğraflar: Cloudflare Workers KV. Fotoğraflar yalnızca giriş yapılmış `/api/photos/…` isteğiyle okunur; herkese açık dosya adresi oluşturulmaz.
- Web arayüzü ve sunucu: Cloudflare Workers. Bilgisayarınızın açık kalması gerekmez.
- R2 ve ücretli Workers planı kullanılmaz. Hesaptaki Free plan korunmalıdır. Ücretli plana geçirilirse sağlayıcının farklı ücret koşulları uygulanır.

KV Free kotası: hesap genelinde 1 GB, günlük 100.000 okuma, 1.000 yazma, 1.000 silme ve 1.000 listeleme. Fotoğraf başına bir yazma yapılır. Ücretsiz sınır aşılırsa ilgili işlem hata verir. Kotalar Cloudflare tarafından değiştirilebilir: https://developers.cloudflare.com/kv/platform/pricing/

KV dağıtımı anlık değildir; yeni fotoğrafların başka bir konumda görünmesi gecikebilir. Yeni bir yükleme tamamlanmadan servis kaydı başarılı sayılmaz. Depolama hatasında servis kaydı oluşturulmaz. KV temizliği başarısız olursa silinen kaydın fotoğraflarına erişim hemen kesilir; fiziksel temizleme kuyruğu sonraki kayıt işlemlerinde tekrar denenir.

## Hazırlık ve yayın

Node.js 24 veya üzeri gerekir. `npm install` ile `package.json` içindeki sabit Wrangler sürümünü kurun. `wrangler.jsonc` mevcut hesaptaki D1 ve KV kimliklerini içerir; yeni kaynak oluşturmak yerine bunları kullanın.

1. `npx wrangler login --scopes account:read user:read workers:write workers_kv:write workers_scripts:write d1:write` ile yayınlama yetkisi verin. Yalnızca Workers, D1, KV ve gerekli hesap okuma izinleri istenir; R2 veya faturalandırma yetkisi gerekmez.
2. `npx wrangler d1 migrations apply DB --remote` ile şemayı boş çevrim içi veritabanına uygulayın. Yerel veritabanı ve çevrim içi veritabanı ayrıdır.
3. `npx wrangler secret put SETUP_TOKEN` komutuyla uzun, rastgele, tek kullanımlık kurulum anahtarı tanımlayın. Anahtarı kaynak koda veya Git deposuna yazmayın. Anahtar tanımlı değilse ilk hesap oluşturulamaz.
4. `npm test` ve `npx wrangler deploy --dry-run` başarılı olduktan sonra `npx wrangler deploy` ile yayınlayın.
5. Gerçek yayın adresinde kurulum anahtarını ve en az 8 karakterli yönetici şifresini kendiniz girin. Rastgele ziyaretçiler kurulum anahtarı olmadan uygulamayı sahiplenemez. Uygulama hesabı oluşturulduktan sonra `SETUP_TOKEN` sırrını kaldırın.

Uygulama personel yönetim panelidir. Tek yönetici hesabı kullanır; personel isimleri ayrı giriş hesapları değildir. Müşterilerin anonim başvuru yapacağı bir ekran içermez.

## Yerel doğrulama

`npx wrangler d1 migrations apply DB --local` ve `npx wrangler dev --local` komutları geliştirme depolarını kullanır. Test kurulum anahtarını yalnızca yerel ortam değişkeni olarak verin. `.wrangler/` içeriğini yayın paketine koymayın.

`npm test`, D1 SQL davranışını SQLite üzerinde ve KV davranışını bellek deposuyla doğrular. Gerçek Cloudflare çalışma ortamı ayrıca yerel Wrangler önizlemesinde kontrol edilmiştir; bu kontrol gerçek yayın doğrulamasının yerine geçmez.

## Yedekleme ve geri yükleme

Ayarlar → Yedeği İndir işlemi, kayıtları, personeli ve fotoğrafları içeren `powerpool-cloud-backup-v1` JSON dosyası üretir. Fotoğraflar belleği doldurmamak için sırayla aktarılır. İndirme yarıda kalırsa dosya geçerli JSON olmayacaktır; dosyanın açılabildiğini doğrulayın. Büyük yedekler fotoğraf başına KV okuma kotasını kullanır. Yedek müşteri verileri içerir; çevrim dışı güvenli bir yerde saklayın. Şifre özeti ve aktif oturumlar dışa aktarılmaz.

Otomatik haricî yedekleme henüz yapılandırılmamıştır. Veri kaybından korunmak için düzenli olarak kendi bilgisayarınıza yedek indirin.

Uygulama içinden tek tıklama geri yükleme henüz yoktur. Geri yükleme, bakım sırasında doğrulanmış bir JSON yedeğinden D1 kayıtlarının/personelin ve KV fotoğraflarının birlikte yeniden alınmasını gerektirir. Kayıt kimlikleri, sürümler, fotoğraf ilişkileri ve yıllık numara sayacı birlikte korunmalıdır. Yönetici hesabı/oturumlar yedekle üzerine yazılmamalıdır. Yeni/boş kurulumda yeni yönetici şifresi belirlenir. Geri yükleme işlemini ayrıca test etmeden mevcut veritabanının üzerine dosya aktarmayın.

## Doğrulanmış yayın durumu

Yayın adresi: https://powerpool-servicehub.powerpool.workers.dev

- D1 şeması çevrim içi veritabanına uygulandı. `/health` isteği HTTPS üzerinden başarılı.
- KV alanında geçici bir nesneyle uzaktan yazma / okuma / silme doğrulandı; doğrulama nesnesi temizlendi.
- Yönetici hesabını kullanıcı kendi şifresini belirleyerek oluşturdu. Tek kullanımlık `SETUP_TOKEN` sırrı ardından kaldırıldı.
- Girişsiz servis/fotoğraf erişimi 401, özel yapılandırma erişimi 404; geçersiz kurulum anahtarı 403 ile reddedildi.
- Yerel uygulamadaki mevcut müşteri kayıtları bu yayına otomatik aktarılmadı.
- Ayrı depolarda 10 bulut ve 18 yerel uygulama testi geçti. Cloudflare'ın yerel çalışma ortamında fotoğraflı kabul, teklif, belge ve fotoğraflı yedek ayrıca doğrulandı. Gerçek yayındaki müşteri kayıtlarına sentetik servis kaydı eklenmedi.
- Yayını kullanmaya başlamak için Ayarlar bölümünde gerçek personel isimlerini kaydedin. Düzenli olarak JSON yedeğini kendi bilgisayarınıza indirin.

Yeni dağıtım yaparken mevcut D1/KV kimliklerini koruyun. Yeni veya boş veritabanı oluşturarak kayıtları kaybetmeyin. Yeniden yayınlama mevcut şifreyi sıfırlamaz; kullanıcı tekrar ilk kurulum yapmaz.

Adres değişikliği: Hesap alt alan adı `powerpool.workers.dev` olarak güncellendi. Eski `ahmetsemihozdemir.workers.dev` adresi kullanılmaz. Aynı Worker, D1 ve KV kaynakları korunmuştur; yeni adreste mevcut yönetici şifresiyle tekrar giriş yapılır.

Yeni `powerpool` adresinde HTTPS, veritabanı sağlık kontrolü, mevcut yönetici hesabının korunması ve girişsiz kayıt erişiminin engellenmesi doğrulandı.

Şifre değiştirme: Ayarlar → Yönetici Şifresi bölümünde mevcut şifrenizi ve en az 8 karakterli yeni şifrenizi iki kez girin. İşlem diğer cihazlardaki oturumları kapatır; mevcut kayıtlar korunur.

Şifre uzunluğu güncellemesi: Hem ilk kurulumda hem Ayarlar üzerinden şifre değişiminde en az 8 karakter desteklenir. Mevcut yönetici şifresi kendiliğinden değişmez. Şifre değişiminde mevcut şifre ve iki eşleşen yeni şifre gerekir; CSRF ve deneme sınırı uygulanır. Diğer oturumlar kapatılır; şifre değişimiyle aynı anda başlayan eski şifreli girişler hesap sürümü denetimiyle reddedilir.

Personel silme: Ayarlar → Servis Personeli bölümünde her kayıtlı personelin yanında Sil düğmesi bulunur. Onay sonrası yalnızca personel seçim listesinden kaldırılır; geçmiş servis kayıtlarındaki isimler korunur. Son personel de silinebilir. Kaydedilmemiş liste değişiklikleri varsa önce kaydedilmelidir.

## 21 Ekim 2026 — sadeleştirilmiş kullanım
- Ana menü: Ana Sayfa, Servisler, Müşteriler, Ayarlar. Onay bekleyenler Servisler filtresinde; bayiler Müşteriler tür filtresinde; raporlar Ana Sayfa üzerindeki açılır bölümde bulunur.
- Yeni kayıtta temel alanlar öndedir; e-posta isteğe bağlıdır. Adres, fotoğraf ve diğer bilgiler Ek Bilgiler bölümündedir.
- Servis dosyası Genel Bilgiler, İşlemler ve Teklif, Belgeler ve Geçmiş sekmelerine ayrılmıştır. Sıradaki işlem düğmesi servis durumuna göre değişir; müşteri onayı ayrıca kaydedilir.
- Personel eklemek için tek ismi yazıp Ekle düğmesine basın. Birden fazla kişiyi ayrı ayrı ekleyebilirsiniz. Her kişinin Sil düğmesi vardır; geçmiş kayıtlardaki isimler korunur.
- TL/EUR teklif, servis silme, belgeler ve yedekleme özellikleri korunmuştur.
- Doğrulama: 14 bulut ve 19 yerel uygulama testi geçti. Yerel tarayıcıda e-postasız kayıt, teklif, onay, onarım, test ve teslim akışı tamamlandı. 320/390/768/1280 piksel genişliklerinde ana sayfalar ve servis sekmeleri kontrol edildi; dar ekrandaki durum etiketi taşması düzeltildi. Canlı sisteme test müşterisi eklenmedi.


## Kişisel kullanıcı hesapları — 21 Ekim 2026
- Mevcut yönetici hesabının kullanıcı adı `admin` oldu. Şifre değiştirilmedi; eski yönetici oturumları yönetici olarak korunur.
- Ayarlar → Servis Personeli bölümüne kişiyi ekleyin. Ardından Kullanıcı Hesapları → Yeni Kullanıcı Ekle bölümünde personeli seçin, benzersiz kullanıcı adını ve en az 8 karakterli şifreyi iki kez girin.
- Kullanıcı adları büyük/küçük harfe duyarsızdır; 3–40 karakter, a-z/rakam/nokta/tire/alt çizgi desteklenir. `admin` adı ayrılmıştır. En fazla 40 personel hesabı açılabilir.
- Personel servisleri, müşterileri, teklifleri ve belgeleri kullanır; işlem geçmişine giriş yapan kişinin adı sunucu tarafından yazılır. Kullanıcı/personel yönetimi, servis silme ve yedek indirme yöneticiye ayrılmıştır.
- Yönetici personel şifresini belirleyebilir ve hesabı pasife/aktife alabilir. Şifre sıfırlama ve hesap durumunu değiştirme o hesabın oturumlarını kapatır. Personel listeden silinince giriş hesabı otomatik kapanmaz; giriş yetkisini ayrıca pasife alın.
- Her kullanıcı Ayarlar → Şifremi Değiştir bölümünden mevcut şifresiyle kendi şifresini değiştirebilir. Bu yalnızca o hesabın diğer oturumlarını kapatır.
- Şifreler açık metin tutulmaz. Kullanıcı listeleri/API yanıtları şifre özetlerini veya tuzlarını içermez. JSON servis yedeği giriş hesaplarını içermez; hesaplar uygulama veritabanında kalıcı saklanır.
- Bulut güncellemesinde `0002_user_sessions.sql` geçişi mevcut sessions tablosuna user_id sütunu ekler. Önce mevcut veritabanına bekleyen geçişleri uygulayın, sonra Worker'ı yayınlayın. 0001 geçişini değiştirmeyin veya veritabanını yeniden oluşturmayın.
- Doğrulama: 15 bulut + 20 yerel test geçti. Ayrı hesapla giriş, rol yükseltme girişimi, yetkisiz yönetim, işlem yapan kişi kimliği, kişisel şifre değişiminde hesapların ayrılması, yönetici sıfırlaması, pasife alma ve oturum iptali denetlendi. Yerel tarayıcıda yönetici ve personel görünümleri ile 320/390 piksel düzenleri kontrol edildi. Canlı ortama test hesabı eklenmedi.


## Kayıt Ol ve başvuru onayı — 21 Ekim 2026
- Giriş ekranındaki Kayıt Ol bağlantısından ad soyad, kullanıcı adı ve en az 8 karakterli şifre iki kez girilerek başvuru yapılabilir.
- Başvuru otomatik giriş veya servis erişimi vermez. Başvuranın seçtiği rol/aktiflik alanları dikkate alınmaz; hesap onay bekleyen personel olarak saklanır.
- Yönetici Ayarlar → Kullanıcı Hesapları bölümündeki Onay Bekliyor başvurusunda Onayla düğmesine basar, kişiyi mevcut servis personeliyle eşleştirir ve Onayla ve Hesabı Aç düğmesini kullanır. Personel listede yoksa önce Servis Personeli bölümünden eklenir.
- Reddet işlemi başvuruyu erişimsiz tutar. Reddedilen başvuru sonradan yine personelle eşleştirilerek onaylanabilir. Normal Aktifleştir işlemi onay sürecini atlayamaz.
- IP başına saatte 3 kayıt isteği sınırı ve toplam 100 bekleyen/reddedilen başvuru sınırı vardır. Bu başvurular onaylı 40 kullanıcı kontenjanından ayrı tutulur. Yeni veritabanı geçişi gerekmemiştir; mevcut hesaplar ve servisler korunur.
- Doğrulama: 16 bulut + 21 yerel test geçti. Başvuruda rol yükseltme/aktifleşme girişimi, onaysız erişim, yinelenen kullanıcı adı, şifre doğrulaması, kaynak denetimi, kayıt istek sınırı, yönetici/CSRF denetimi, personel eşleştirme ve ret/yeniden onay kontrol edildi. Yerel tarayıcıda form ve onay ekranı; 320/390/768 piksel genişlikleri doğrulandı. Canlı sisteme test başvurusu gönderilmedi.


## Ad soyad ve e-posta ile kayıt / kod doğrulaması — 21 Ekim 2026
- Herkese açık Kayıt Ol formunda kullanıcı adı alanı kaldırıldı. Ad soyad, e-posta, en az 8 karakterli şifre ve şifre tekrarı istenir.
- İlk adım yalnızca 6 haneli e-posta kodunu gönderir. Kod doğrulanmadan kullanıcı hesabı veya yönetici başvurusu oluşmaz. Doğrulamadan sonra personel başvurusu yönetici onayına gelir; yeni kullanıcı e-posta adresi ve şifresiyle giriş yapar. Eski kullanıcı adları ve admin girişi korunur.
- Kod 10 dakika geçerlidir; tek kullanımlıdır ve en fazla 5 yanlış deneme destekler. Aynı e-posta için yeni kod isteme aralığı 60 saniyedir. Yeni kod önceki bağlantıyı/kodu geçersiz kılar. Sayfa yenilenirse veya Yeni Kod İste seçilirse form yeniden gönderilir.
- IP başına saatte 20, e-posta başına saatte 3 gönderim isteği; uygulama genelinde günde 200 gönderim isteği sınırı vardır. Kod doğrulamada IP başına 15 dakikada 20 deneme sınırı bulunur. Kullanılmayan doğrulama kayıtları süre dolunca temizlenir.
- Kod ve şifre açık metin saklanmaz. E-posta benzersizliği veritabanında korunur; eşzamanlı doğrulamalar tek hesap oluşturur. Gönderim hatasında kullanılabilir doğrulama kaydı bırakılmaz.
- Bulutta 0003_email_verification.sql geçişi yeni doğrulama, sınır ve e-posta eşleştirme tablolarını ekler; mevcut servis ve hesap tablolarını silmez/değiştirmez. Yerel uygulama aynı tabloları lib/registration.sql ile oluşturur.
- Brevo API anahtarı BREVO_API_KEY ve doğrulanmış gönderici MAIL_FROM olarak Cloudflare Secrets içinde tutulur. Kaynak koduna/ZIP'e anahtar yazılmaz. Yerel çalıştırmada aynı değişkenler ortamdan sağlanır. Bu ayarlar yoksa Kod Gönder düğmesi kapalıdır; hiçbir gönderim yapılmış gibi gösterilmez.
- Gerçek kullanım adresi https://powerpool-servicehub.powerpool.workers.dev/ adresidir. 127.0.0.1:4194 geliştirme ortamıdır ve ayrı veritabanı/e-posta ayarları kullanır.
- Sağlayıcı API'sinin mesajı kabul etmesi posta kutusuna teslim edildiği anlamına gelmez. Gerçek teslimat ayrıca Brevo Transactional Email Logs ve alıcının gelen/spam kutusundan doğrulanmalıdır.
- Otomatik kontrol: 22 bulut (6 özel e-posta testi dahil) + 21 yerel test geçti. Yanlış/eskimiş/tekrar kullanılan kod, yeniden gönderim, sağlayıcı hatası, şifre ve kod gizliliği, eşzamanlı doğrulama ve yönetici onayı test edildi. Gerçek posta kutusu doğrulama sonucu dağıtım kaydında ayrıca tutulur.
- Gönderici ve API ayarları için resmi kaynaklar: https://developers.brevo.com/docs/send-a-transactional-email ve https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email

Kod ekranına devam etme: Doğrulama bağlantısı ve e-posta adresi yalnızca aynı sekmenin sessionStorage alanında en fazla 10 dakika tutulur. Şifre veya 6 haneli kod buraya kaydedilmez. Sayfa yenilenince geçerli kod ekranı geri açılır; Gönderilen Kodu Gir düğmesiyle de dönülebilir. Başarılı doğrulama veya süre dolumu bu geçici durumu temizler.

Gerçek uçtan uca doğrulama tamamlandı: Brevo günlüğünde mesajın Delivered ve First opening olayları görüldü. Kullanıcı kodu sitede doğruladı; D1 üzerinde 1 doğrulanmış e-posta hesabı ve doğrulanmış başvuru kaydı salt okunur sorguyla teyit edildi. Doğru şifreyle bekleyen hesaba girişte artık yönetici onayı bekleniyor mesajı gösterilir; hesap durumu yalnızca şifre doğrulandıktan sonra açıklanır. 43 otomatik test geçti (22 bulut + 21 yerel).

## 21 Ekim 2026 — Teklif ve servis geliştirmeleri

Yeni teklifler EUR üzerinden düzenlenir. TL karşılığı TCMB EUR döviz satış kuruyla hesaplanır; kurun tarihi ve kaynağı gösterilir. Eski TL teklifleri otomatik çevrilmez. Onay bekleyen tekliflerin TL gösterimi güncel kuru kullanır. Onayı personel/yönetici kaydeder; onay anındaki kur sabitlenir. Onaydan sonra yeni teklif oluşturmak yeniden onay gerektirir. Aktif ödeme içeren teklif değiştirilemez.

TCMB kaynağı: https://www.tcmb.gov.tr/kurlar/today.xml. Worker zamanlayıcısı hafta içi Türkiye saatiyle 15:40 ve 16:40'ta günceller; isteklerde bir saatlik önbellek kontrol edilir. Tatillerde son yayımlanan kur tarihiyle gösterilir. Kaynak erişilemezse son kur uyarıyla gösterilir; doğrulanamayan veya yedi günden eski kurla yeni teklif/onay engellenir.

Ödemeler teklifin para biriminde kaydedilir; toplam/alınan/kalan gösterilir. Kalan tutarı aşan ödeme reddedilir. Yönetici hatalı ödemeyi nedeni ile iptal edebilir; kayıt ve geçmiş silinmez.

Belgeler ve Geçmiş sekmesinde Teklif Formu / PDF dahil dört belge bulunur. Açılan belgedeki Yazdır / PDF Kaydet ile PDF alınır. Teklif tutarı, TL karşılığı, kur tarihi, onay ve ödeme özeti belgelerde yer alır.

Müşteri takip bağlantıları kullanıcı isteğiyle oluşturulur, 30 gün geçerlidir. Yeni bağlantı eskisini geçersiz kılar; ayrıca kapatılabilir. D1'de yalnızca token hash'i tutulur. Müşteriye yalnızca ilgili servis numarası, ürün, durum, güncelleme tarihi, teklif ve onay durumu açılır. Ad, telefon, e-posta, iç notlar, personel ve fotoğraflar bu sayfada paylaşılmaz. Link otomatik gönderilmez; kullanıcı müşterisine kendisi iletir.

Şifremi Unuttum: doğrulanmış e-postalı, etkin ve onaylanmış hesaplara Brevo üzerinden altı haneli kod gönderilir. Kod on dakika ve beş denemeyle sınırlıdır, tek kullanımlıktır. Şifre yenilendiğinde tüm mevcut hesap oturumları kapatılır. E-postasız eski hesapların şifresini yönetici yeniler. API anahtarı ve kodlar istemciye/loglara açılmaz.

Servislerde marka ve personel filtreleri eklendi; arama telefon, marka/model ve personeli de kapsar. Dosyanın aşamaları adım şeridinde gösterilir. Ayarlar > Yönetici işlem günlüğü, servis oluşturma/değiştirme/silme ve takip bağlantısı işlemlerinin son 100 kaydını gösterir. Silinen servislerin silme günlüğü korunur. Günlük bu güncellemeden itibaren yeni işlemleri kaydeder.

0004_operations.sql yalnızca ek tablolar ve indeks içerir. Testler: 26 otomatik test geçti; mock e-posta ile şifre yenileme ve eski oturumların iptali kontrol edildi. TCMB gerçek XML bağlantısı ve EUR satış ayrıştırması doğrulandı. Tarayıcıda yerel geçici verilerle teklif, onay, ödeme ve takip ekranları denendi; üretimde deneme müşterisi veya ödeme kaydı oluşturulmadı. Yeni şifre yenileme e-postasının gerçek teslimi ayrıca kullanıcıyla denenmedi; mevcut doğrulanmış Brevo gönderim hattını kullanır.

Son canlı kontrol: 27 test geçti. 0004 uzak veritabanına uygulandı. Canlı Worker /api/rates TCMB EUR satış kurunu 2026-10-21 tarihiyle 55.6781 ve stale=false olarak döndürdü. /health, /api/session ve /track HTTP 200. Cloudflare HTML kanonik adres yönlendirmesiyle /track döngüsü giderildi. Sürüm: a4d9b51d-12b1-456b-8127-8ef000c0e294. /api/rates yalnızca kamuya açık TCMB kurunu sunar, müşteri verisi içermez. Kişisel servis verileri oturumla veya ilgili takip tokeniyle korunur.

21 Ekim 2026 kur türü güncellemesi: Yeni/güncel EUR hesaplamaları TCMB BanknoteSelling (EUR efektif satış) alanını kullanır. Ayrı exchange:EUR:banknote-selling önbelleği eski döviz satış verisinin tekrar kullanılmasını önler. Günlük zamanlama korunur. Önceden onaylanmış tekliflerin kur değeri ve kur türü kendi snapshot bilgisinden gösterilir. 27 test geçti; test XML'inde döviz ve efektif değerleri farklı tutularak doğru alanın seçildiği doğrulandı.

21 Ekim 2026 pompa kataloğu: POWERPOOL 2026 PDF sayfa 5–8 (basılı 2–5) görsel tablolarından 19 model doğrulandı. MineuerX ön filtreli: 0.5/0.75/1/1.5 HP monofaze; ön filtresiz: 1/1.5/2/3 HP monofaze. MajeuerX ön filtreli: 1/1.5/2/3 HP hem monofaze hem trifaze; ön filtresiz: 3/4/5.5 HP trifaze. MineuerX teknik tabloda görünen 380 V sütunu yeni trifaze ürün kodu olarak yorumlanmadı; açıkça listelenen monofaze sipariş kodları esas alındı. Model seçenekleri ürün kodu, HP, faz ve ön filtre durumunu içerir. Önceki MineuerX 1 HP ürün anahtarı korunarak PMPMN.100M modeline ait yeni seçim bilgisi katalogda tamamlandı; geçmiş servis kayıtlarına veri değişikliği yapılmadı. Toplam katalog 495 ürün, pompalar 19 seçenek. Pompa seçim bilgisi yeni servis model alanına ve belgelere taşınır. 29 cloud + 21 yerel test geçti. Ayrıntılı doğrulama: powerpool-pompa-dogrulama.csv.

21 Ekim 2026: Ayarlar > Yeni Kullanıcı Ekle formunda kullanıcı adı yerine e-posta kullanılır. Yönetici personel seçip e-posta ve başlangıç şifresi belirler. Hesap önceki yönetici oluşturma akışı gibi doğrudan etkinleşir; e-posta sahipliği doğrulanmış gibi işaretlenmez. Kendi kendine kayıt akışı kod doğrulaması ve yönetici onayı gerektirmeye devam eder. E-posta normalize edilir, benzersizliği veritabanı ile korunur; hesap ve e-posta eşlemesi atomik kaydedilir. Mevcut kullanıcı adlarıyla giriş ve eski hesaplar korunur. 30 cloud + 22 yerel test geçti; e-postayla yeni hesap/giriş, geçersiz ve yinelenen e-posta ve yönetici yetkisi kontrolleri test edildi. Tarayıcı önizlemesi bu çalıştırmada localhost bağlantı zaman aşımı nedeniyle açılamadı; canlı HTML ve sağlık kontrolü ayrıca doğrulandı. Sürüm: 2872c042-529a-4869-8cf6-ebcc1fa662e7.
