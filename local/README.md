# POWERPOOL ServiceHub

Havuz teknik servisleri için bilgisayarda çalışan kayıt sistemi. Referanstaki POWERPOOL kimliği ve lacivert–turkuaz panel düzeni korunmuştur. Marka / model kataloğu, 16 Ekim 2026 tarihinde resmî kataloglardan doğrulanan seçeneklerle genişletilmiştir:

- İ-Garden: 5 model; Powerpool'un resmî ürün broşürlerinden.
- Aquax: 3 model; Powerpool 2026 kataloğundan.
- Bs Pool: 182 cihaz, hücre ve yardımcı ekipman seçeneği; BS Pool 2026 kataloğundan.
- Antech: 286 cihaz ve yardımcı ekipman seçeneği; Antech 2026 KT_26 R02 kataloğundan.
- Önceki MineuerX 1 HP seçeneği de korunmuştur.

Toplam 477 seçenek. Yeni kayıt ekranında marka → ürün grubu → model sırasıyla seçim yapın; Modelde Ara alanıyla seçenekleri daraltın. Seçilen modelin altında kaynak PDF ve sayfa bağlantısı görünür. Katalog her açılışta internetten çekilmez; doğrulanan liste uygulamayla birlikte gelir ve çevrimdışı kullanılabilir. Kaynaklar ve kapsam `CATALOG_SOURCES.md` dosyasındadır.

## Çalıştırma

1. ZIP dosyasını bir klasöre tamamen çıkartın. ZIP içinden çalıştırmayın.
2. `BASLAT.cmd` dosyasına çift tıklayın. Node.js 24 veya üzeri gerekir. Başlatıcı, varsa Codex'in bu bilgisayardaki Node çalışma ortamını da bulur. Paket kurulumu / `npm install` gerekmez.
3. Sunucunun hazır mesajını gördükten sonra tarayıcınızda **http://127.0.0.1:4174** adresini açın.
4. İlk açılışta en az 8 karakterli yönetici şifrenizi belirleyin. Şifrenizi güvenli bir yerde saklayın; e-posta ile şifre sıfırlama hizmeti yoktur.
5. Ayarlar bölümüne gerçek servis personellerinin adlarını her satıra bir kişi olacak şekilde girip kaydedin.
6. Yeni Servis Kaydı bölümünden müşteri ve ürün bilgilerini doldurun. İsterseniz en fazla beş kabul fotoğrafı ekleyin.

`index.html` dosyasına doğrudan çift tıklamak yeterli değildir. Gerçek kayıt ve fotoğraf saklama işlemleri için Node sunucusu çalışıyor olmalıdır. Sunucuyu durdurmak için komut penceresinde Ctrl+C kullanın. Başka bir uygulama 4174 portunu kullanıyorsa onu kapatın veya PowerShell'de `$env:PORT='4175'; node server.mjs` çalıştırıp yazdırılan adrese gidin.

## Klasör düzeni

```text
powerpool-servicehub/
  index.html          HTML arayüz
  css/                Panel ve yazdırma stilleri
  js/                 Arayüz ve yazdırma JavaScript dosyaları
  images/             Logo
  catalog/            products.json: kaynak bilgili marka / model kataloğu
  server.mjs          Yerel HTTP sunucusu, doğrulama ve veritabanı işlemleri
  tests/              Otomatik kontroller
  BASLAT.cmd          Windows başlatıcısı
  package.json
  data/               İlk çalıştırmada oluşur: SQLite veritabanı
```

## İşlevler

- Gerçek veritabanından hesaplanan kontrol paneli; başlangıçta boş kayıt listesi ve sıfır sayaçlar.
- Markaya bağlı ürün grubu ve model seçimi; Türkçe karakterleri destekleyen model araması.
- Müşteri, bayi, telefon, e-posta, adres, seri numarası, kabul personeli ve fiziksel durum kaydı.
- Kabul fotoğraflarının kayıtla aynı veritabanı işlemi içinde kalıcı saklanması.
- Sıralı `PWR-SRV-YIL-0001` formatında servis numarası.
- Arama, durum filtresi, müşteri / bayi listeleri ve dağılım raporları.
- Teklif kaydı; müşteriyle alınan onayın kişi ve yöntem bilgisiyle işlenmesi.
- Teklif düzenlerken TL (TRY) veya Euro (EUR) seçilir. Kayıt ve belgeler seçilen para birimini gösterir. Eski TL teklifleri korunur. Para birimi değişince tutar elle yeniden girilir; kur dönüşümü yapılmaz ve müşteri onayı yeniden alınır.
- Kayıt detayındaki “Servis Kaydını Sil” düğmesi onay ister. Kayıt, fotoğrafları ve geçmişi kalıcı silinir; servis numarası yeniden kullanılmaz. Geri alma için işlem öncesi yedek alınmalıdır.
- Teknik tespit, garanti değerlendirmesi, onarım ve test notları.
- İşlem tarihi ve personeliyle servis geçmişi.
- Servis kabul, teknik inceleme ve onarım / teslim belgeleri. Belgeyi açıp Yazdır / PDF Kaydet düğmesini kullanın. Fotoğraflar da belgeye eklenir.
- Ayarlar bölümünden fotoğraflar dahil veritabanı yedeği.
- Şifre özetiyle giriş koruması, HTTP-only oturum çerezi, CSRF kontrolü ve güncelleme çakışması koruması.

Müşteri onayı, personelin müşteriyle iletişime geçerek aldığı onayı kaydetmesidir. Otomatik e-posta / SMS veya müşterinin uzaktan onayladığı bir bağlantı bulunmaz. Belgeler sistemdeki kayıt bilgilerinden üretilir; imza alanları kullanıcılar tarafından doldurulur.

## Veriler ve yedekleme

Tüm kayıtlar, fotoğraflar, personel listesi ve yönetici şifre özeti `data/servicehub.sqlite` içinde saklanır. Sunucu çalışırken `-wal` ve `-shm` dosyaları da oluşabilir. Çalışan veritabanını elle kopyalamak yerine Ayarlar → Yedeği İndir seçeneğini kullanın; bu seçenek tutarlı bir SQLite anlık görüntüsü oluşturur.

Geri yükleme için:

1. Sunucuyu Ctrl+C ile durdurun; kapanmasını bekleyin.
2. Mevcut `data` klasörünü başka bir güvenli konuma kopyalayarak saklayın.
3. Yeni, boş bir `data` klasörü oluşturup indirilen yedeği bunun içine `servicehub.sqlite` adıyla koyun. Eski `-wal` / `-shm` dosyalarını yeni klasöre taşımayın.
4. Sunucuyu yeniden başlatın. Girişte, yedeğin alındığı tarihte kullanılan şifre geçerlidir.

Bu sürüm sizin isteğiniz doğrultusunda yalnızca `127.0.0.1` üzerinde, kendi bilgisayarınızda çalışır. Aynı bilgisayardaki oturum açılmış tarayıcılar kayıtları paylaşır. Personel adları işlem geçmişi içindir; ayrı personel hesapları veya rol yetkileri değildir. Yönetici oturumu sunucu belleğindedir; sunucu yeniden başlatılınca tekrar giriş gerekir. Uygulama klasörünü güncellerken kendi `data` klasörünüzü koruyun.

## Kontroller

`npm test` veya `node --test tests/servicehub.test.mjs` komutunu çalıştırın. Testler ayrı bir geçici veritabanında çalışır, sizin kayıtlarınıza dokunmaz. İnceleme bulguları `REVIEW.md` içindedir.

Şifre değiştirme: Ayarlar → Yönetici Şifresi bölümünde mevcut şifrenizi ve en az 8 karakterli yeni şifrenizi iki kez girin. İşlem diğer cihazlardaki oturumları kapatır; mevcut kayıtlar korunur.

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
