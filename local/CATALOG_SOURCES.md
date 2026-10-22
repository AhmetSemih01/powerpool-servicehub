# Marka ve model kaynakları

Kontrol tarihi: **16 Ekim 2026**. Liste `catalog/products.json` içinde yer alır. Her seçenekte marka, model, ürün grubu, kaynak URL'si, PDF sayfası ve doğrulama tarihi bulunur. Sayfalar PDF dosyasının 1'den başlayan sayfa numaralarıdır; basılı sayfa numarası farklı olabilir.

| Marka | Seçenek | Kaynak |
|---|---:|---|
| İ-Garden | 5 | Powerpool'un resmî ürün broşürleri |
| Aquax | 3 | Powerpool 2026, PDF sayfa 57 / basılı sayfa 54 |
| Bs Pool | 182 | BS Pool 2026 |
| Antech | 286 | Antech 2026, revizyon KT_26 R02 |
| MineuerX | 1 | Önceki seçeneğin korunması; Powerpool 2026 PDF sayfa 5 |
| Toplam | 477 | |

## Powerpool — İ-Garden ve Aquax

[Powerpool 2026 ana kataloğu](https://www.powerpool.com.tr/wp-content/uploads/2026/03/2026-POWERPOOL-KATALOG.pdf), Aquax **W30, W45 ve W80** modellerini içerir.

Ana katalogdaki iGarden model tablosu bulunmadığı için, yine Powerpool'un resmî ürün sayfalarında bağlantısı verilen Ağustos 2026 broşürleri kullanılmıştır:

- [M1-50 broşürü](https://www.powerpool.com.tr/wp-content/uploads/2026/08/M1-50-_compressed.pdf)
- [M1-80 broşürü](https://www.powerpool.com.tr/wp-content/uploads/2026/08/M1-80-_compressed.pdf)
- [M1-100 broşürü](https://www.powerpool.com.tr/wp-content/uploads/2026/08/M1-100-_compressed.pdf)
- [M1 Pro 125 broşürü](https://www.powerpool.com.tr/wp-content/uploads/2026/08/M1-PRO-125-_compressed.pdf)
- [M1 Pro 125 AI broşürü](https://www.powerpool.com.tr/wp-content/uploads/2026/08/M1-PRO-125-AI-_compressed.pdf)

Broşürler [M1](https://www.powerpool.com.tr/yeni-urun/igarden-m1-serisi/), [M1 Pro](https://www.powerpool.com.tr/yeni-urun/igarden-m1-pro-serisi/) ve [M1 Pro AI](https://www.powerpool.com.tr/yeni-urun/igarden-m1-pro-ai-serisi/) sayfalarından bulunmuştur. iGarden'ın başka ülke kataloglarındaki farklı modeller Powerpool listesine eklenmemiştir.

## Bs Pool

[Üreticinin BS Pool 2026 kataloğu](https://www.bspool.eu/wp-content/uploads/2026/01/BSV_Catalogo2026.pdf) kullanılmıştır.

Eklenen gruplar: QuickSalt, N-BsSalt, EVO Basic, Touch EVO / LS / EVO+ / BSLINK, Touch PRO, PRO, TECH SALT; elektroliz hücreleri; dozajlama ve ölçüm cihazları; BSLINK; kontrol panoları ve adlandırılmış yardımcı ekipmanlar.

Örnekler: N-BsSalt 10/15/20/25/35; PRO 400/500/600/750/1000; TECH SALT OSC-200/400. Katalogdaki Touch LS 100, “yakında” notuyla işaretlenmiştir; bu not model seçiminde gösterilir. Katalogda yer almak, güncel stok veya servis/parça temin garantisi anlamına gelmez.

## Antech

[Antech / Enelsa resmî katalog sayfasında](https://www.enelsa.com/tr/online-catalog/82/enelsa-online-katalog) yayımlanan [2026 KT_26 R02 kataloğu](https://www.enelsa.com/upload/2026061210541058_antech-2026-r2.pdf) kullanılmıştır. Daha eski Türkçe 2025 katalog yerine güncel 2026 model tabloları esas alınmıştır; model adları bu kaynaktaki biçimleriyle tutulmuştur.

Eklenen gruplar: Nova / Lara / Optima / Nano / Likya ve Aspendose dozaj pompaları; EMD pompalar; Omnicon, Poolsaver Tetra ve Aquameter; Salt Ionic / Inline; System kontrol sistemleri; Hera aydınlatmalar; sensörler, elektrot tutucular, yardımcı ekipmanlar, karıştırıcılar, sayaçlar ve blowerlar.

Ölçüm cihazı, litre/bar kapasitesi veya gerilim farkıyla ayrı model satırı olan varyantlar ayrı seçenek olarak eklenmiştir. Model adında geçen “DP”, “YP”, voltaj ve bağlantı kodları kaynakta bulunur. Kaynakta bulunan HOUISNG / TEMPARATURE gibi yazımlar, model adlarını keyfî olarak değiştirmemek için korunmuştur.

## Kapsam ve uyumluluk

- Liste servis kaydı açılabilecek adlandırılmış cihaz, hücre ve yardımcı ekipmanları kapsar. Tüm yedek parça çizimlerindeki her vida, kablo, conta veya kimyasal sarf maddesi model listesine dönüştürülmemiştir.
- Antech kataloğunda satılan PoolLab, Eutech, Water-i.d. gibi diğer markalar Antech modeli olarak yeniden etiketlenmemiştir.
- Listede aile başlıkları ve somut model satırları aynı ürünü tekrar oluşturacak şekilde çoğaltılmamıştır.
- Eski kayıtlar veritabanında değiştirilmez. Önceki dört ürünün `product` anahtarları korunmuştur: iGarden M1-80, AQUAX W30, BS Pool N-BsSalt 25 ve MineuerX 1 HP.
- Marka seçicide kullanıcı tarafından istenen İ-Garden, Aquax, Bs Pool ve Antech yazımları kullanılır. Eski ürün anahtarlarındaki yazımlar uyumluluk amacıyla korunur.
- Kayıt oluştururken marka ve modelin birbirine ait olduğu sunucuda doğrulanır. Yeni kayıtlara kaynak bilgisi de eklenir.

PDF'ler kaynak tablolarını okumak ve seçili sayfaları görsel olarak doğrulamak için incelendi. Uygulama paketine üçüncü taraf katalogların tamamı veya fiyat listeleri kopyalanmadı; model tanımlayıcıları ve kaynak bağlantıları eklendi.
