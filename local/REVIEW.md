# Kod incelemesi ve doğrulama

Bu oturumda `/review` adlı çalıştırılabilir bir yerel inceleme komutu bulunmadı. Bunun yerine kaynak kodu gözden geçirildi ve uygulamanın gerçek istek işleyicisine karşı otomatik entegrasyon testleri çalıştırıldı. Başka bir inceleme aracı çalıştırılmış gibi gösterilmemiştir.

## Referans dosyada tespit edilip giderilen sorunlar

- Demo kayıtları ve sabit sayaçlar kaldırıldı. Sayaçlar kayıtlar ve işlem geçmişinden hesaplanıyor.
- Formu sıfırlayan ilk olay dinleyicisi ile sonradan alanları tamamlayan ikinci dinleyici yerine tek kayıt akışı kuruldu. Müşteri, e-posta, telefon, seri numarası ve tüm kabul alanları birlikte kaydediliyor.
- Fotoğrafların yalnızca geçici önizlenmesi yerine veritabanında saklanması sağlandı. Kayıt ve fotoğraflar tek işlemde yazılıyor.
- Zaman damgasının kısa bir bölümünden oluşan çakışabilir numara yerine veritabanı sayacı kullanılıyor.
- Sunucu tarafında alan uzunluğu, e-posta, telefon, tarih, katalog, fotoğraf türü / boyutu ve teklif tutarı doğrulaması eklendi.
- Örnek müşteri / ürün satırlarıyla gerçek kayıtların karışması önlendi; başlangıç veritabanında sahte kayıt yok.
- Boş modül ekranları yerine gerçek kayıtlardan müşteri / bayi listeleri, onay listesi ve raporlar üretildi.
- Gerçek olmayan QR ve belge rozetleri kaldırıldı. Belgeler gerçek kayıt alanlarını ve saklanan fotoğrafları içeriyor.
- Teklif / onay işlemlerinin tarihi ve yapan personel geçmişe kaydediliyor. Yeni teklif eski onayı kaldırıyor. Ücretli işlerde onay atlanamıyor; 0 TL teklif geçerli.
- Kullanıcı girdileri HTML'e yazılmadan önce kaçırılıyor; şifre, oturum ve CSRF kontrolleri eklendi.

## Yeni uygulamanın ikinci incelemesinde düzeltilenler

- Geçersiz belge türünün HTTP başlıkları yazıldıktan sonra kontrol edilmesi 200 durum kodu üretiyordu. Doğrulama başlıklardan önceye taşındı; artık 404 dönüyor.
- Aynı kayıt isteğinin bağlantı hatası sonrası tekrar gönderilmesi kayıt çoğaltabilirdi. İçerik parmak iziyle birlikte kalıcı istek anahtarı eklendi.
- İki pencereden düzenlemede son güncelleme önceki değişikliği ezebilirdi. Sürüm kontrolü ve 409 çakışma yanıtı eklendi.
- Onaylanmış durum listeden çıkarıldığında açılan form yanlışlıkla ilk durumu seçiyordu. Mevcut onay durumu görünür tutuldu; aynı durumun tekrar kaydı engellendi.

## Otomatik testler

İlk sürümdeki 11 test grubuna katalog güncellemesiyle 3 grup eklenmiştir; toplam 14 test grubu geçer:

1. İlk kurulum, parola, oturum ve CSRF / kaynak kontrolü.
2. Katalog adlarının birebir korunması, başlangıç verilerinin boş olması ve personel zorunluluğu.
3. Fotoğraflı kaydın tüm alanlarıyla bağımsız SQLite bağlantısından okunabilmesi.
4. Tekrar istekte kayıt çoğalmasının engellenmesi.
5. Hatalı veri / fotoğraf reddi ve sıra sayacının korunması.
6. Teklif, müşteri onayı, notlar ve işlem geçmişi.
7. Eski sürümle güncellemenin engellenmesi.
8. Belgeler, fotoğraflar, geçersiz belge türü ve zararlı HTML girdisi.
9. Tüm verileri içeren geri açılabilir yedek ve özel sunucu dosyalarının dışarıya sunulmaması.
10. Çıkış, yeniden giriş ve yetkisiz fotoğraf erişiminin engellenmesi.
11. Ayrı HTML / CSS / JavaScript dosyaları, yerel varlık yolları ve sayfa hedefleri.
12. Resmî katalog kaynakları, benzersiz ürün anahtarları, ürün grupları ve istenen modellerin varlığı.
13. Marka / grup filtresi, Türkçe karakterlerle arama ve sonuç bulunmayan arama.
14. Yeni iGarden, Aquax, BS Pool ve Antech modellerinin servis kabulünden belgeye taşınması; yanlış marka / model eşleşmesinin reddedilmesi.

Sunucu ve arayüz JavaScript dosyalarının sözdizimi de Node ile kontrol edildi. Testler ağ bağlantısı gerektirmeden gerçek HTTP istek işleyicisini çağırır; SQLite, fotoğraf BLOB'ları ve belge üretimi gerçek kod üzerinden sınanır.

## Doğrulama sınırı

İlk sürümde tarayıcı aracı yerel sunucuya bağlanırken `ERR_CONNECTION_TIMED_OUT` vermişti. Katalog güncellemesinde gerekli ağ erişimi sağlanınca, ayrı test veritabanıyla 4175 portunda tarayıcı kontrolü yapılabildi. Giriş, yeni servis ekranı, marka listesi, Antech ürün grubu, model araması, model seçimi ve kaynak bağlantısı kontrol edildi; masaüstü ekran görüntüsü alındı. Mobil görünüm ve tüm iş akışlarının tarayıcı üzerinden uçtan uca testi yapılmadı. Kod incelemesi ve testlerin geçmesi tüm olası hataların giderildiği anlamına gelmez.

## Katalog incelemesinde yapılan düzeltmeler

- Sabit dört satırlık ürün dizisi, kaynak PDF sayfalarıyla birlikte `catalog/products.json` dosyasına taşındı.
- Ürün grubu ve arama alanları eklendi. Marka değişince önceki markanın modeli temizleniyor; model seçimi zorunlu kalıyor.
- Model seçildiğinde ürün grubu ve resmî katalog bağlantısı gösteriliyor. Sunucu yanlış marka / model eşleşmesini reddediyor.
- Yüzlerce sıfır satırı oluşturmamak için raporda yalnızca servis kaydı bulunan ürünler gösteriliyor; Ayarlar kataloğu marka bazında açılıp kapanıyor.
- PDF görsel kontrolünde Touch LS 100'ün “yakında” notu, 50/70 varyantlarının normal listelenmesi ve N-BsSalt hücrelerinin 10/3-5 vb. kodları doğrulandı; aktarım düzeltildi.
- Mevcut kayıtların dört ürün anahtarı korunuyor. Veri tabanı geçişi veya mevcut kayıtlara toplu değişiklik yapılmıyor.

## Servis silme ve çift para birimi kontrolü — 16 Ekim 2026

- Kayıt detayına kalıcı silme onayı eklendi; sunucu oturum, CSRF, kayıt sürümü, personel ve servis numarası doğruluyor. Fotoğraflar ve ilişkili kabul isteği aynı veritabanı işlemi içinde siliniyor; numara sayacı korunuyor.
- TL / Euro teklif seçimi, mevcut teklifin düzenlenmesi, eski TL kayıtlarının korunması ve üç servis belgesinde para birimi gösterimi kontrol edildi. Teklif değişince önceki müşteri onayı kaldırılıyor.
- Ayrı geçici veritabanında 16 test geçti. Müşteri veritabanı değiştirilmedi. Bu değişikliklerin kod incelemesinde ek bir bulgu saptanmadı; yeni arayüz davranışları bu turda tarayıcıda denenmedi.

## Sekiz karakter şifre desteği

Ayarlar bölümüne mevcut şifreyi doğrulayarak yeni şifre belirleme eklendi; alt sınır 8 karakterdir. Test ortamında kısa şifre, yanlış mevcut şifre, eşleşmeyen tekrar, CSRF reddi, eski şifreyle giriş reddi ve diğer oturumların kapatılması kontrol edildi. 17 yerel uygulama testi ve 9 bulut testi geçti. Gerçek yönetici şifresi ajan tarafından değiştirilmedi.

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
