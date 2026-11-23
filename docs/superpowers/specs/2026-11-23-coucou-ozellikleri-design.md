# Coucou'dan alınan özellikler: kedi maskot ve çentikten AI sohbet

Tarih: 2026-11-23. Kaynak fikir: [Coucou](https://github.com/Louis-CFM/coucou) (MIT). Kod kopyalanırsa MIT telif notu korunur; CyexsDock GPL-3.0.

## Neden

CyexsDock ücretsiz ve açık kaynak. Hedef kullanıcı: günlük işini kolaylaştırmak isteyen sıradan Windows kullanıcısı (yalnızca yazılımcı değil). Coucou'nun bu kitleye uyan iki özelliği alınıyor. Kullanıcı ikisini seçti; posta, dikte ve çoklu kodlama ajanı desteği seçilmedi.

İki iş birbirinden bağımsız. Sıra: önce maskot (küçük), sonra AI sohbet (proje).

---

## 1. Kedi maskot (küçük iş)

Kedi zaten marka kimliği (`public/cyexsdock.png`: beyaz, yuvarlak kafalı, siyah gözlü, ":3" ağızlı kedi). Mevcut maskot beyaz piksel kedi (`public/mascot/*.svg`, durumlar: idle, working, needs-input, done, error, music, sleeping, her biri `-sit` çeşidiyle).

**Kullanıcı kararı: kedi pikselli olmayacak, 3 boyutlu ve güzel olacak.** Piksel SVG'ler yeni 3D kediyle değiştirilir. Kedi logodaki kediyle aynı karakter olmalı (aynı yüz, aynı renk).

### Yaklaşımlar (3D)
- **A) Hazır 3D animasyon — seçildi.** Kedi Blender'da modellenir; her durum, tepki ve kıyafet şeffaf animasyonlu resme (animasyonlu WebP) çevrilir. Pixar tarzı görünüm, çalışırken neredeyse sıfır yük. Eksi: kıyafet × animasyon sayısı kadar çıktı; kıyafet sayısı 4-6 ile sınırlı.
- B) Canlı 3D (three.js + glTF): kafa imleci gerçekten izler, kıyafet kolay; ama ekran kartı sürekli çalışır, pil yer, uygulama büyür. Kedi sürekli göründüğü için elendi.
- C) 3D görünümlü düz çizim (SVG gölgeli): en hafif ama yeterince etkileyici değil.

Bugün kedi yalnızca AI ajan modu açıkken ve bir ajan çalışırken görünüyor (`src/components/AgentStatus.tsx`, `App.tsx` `agentWings`).

### Hedefler
- Kedi ajan olmadan da görünür: çentiğin sol kanadında `idle`; müzik çalarken `music`; uzun süre hareketsizlikte `sleeping`. Ajan çalışınca bugünkü davranış aynen sürer. Ayar: Ayarlar > Çentik > "Kediyi göster" (varsayılan açık). *Benim kararım: sıradan kullanıcı ajan kullanmaz, kedi aksi halde hiç görünmez.*
- Boşta: kedi ara sıra (30-90 sn arası rastgele) arka ayağıyla kendini kaşır/tırmalar (kullanıcı isteği 2026-11-23).
- Tepkiler: tıklayınca sevilir (gözlerini mutlulukla kapatır, dokunuşa yaslanır, küçük kalp; kullanıcı isteği 2026-11-23); iki kez hızlıca tıklayınca kızar (fazla sevilmekten); üç kez hızlıca tıklayınca başı döner; imleç iki saniye üstünde kalınca kalp çıkar.
- Gardırop: kediye sağ tıkla açılır, kıyafetin üstünde durunca dener, tıklayınca giyer. "Otomatik" seçeneği tarihe göre giydirir: Ekim cadı şapkası, Aralık yılbaşı şapkası, Ramazan ve Kurban Bayramı'nda bayram kıyafeti (bayram tarihleri mevcut tatil tablosundan). Her kıyafet, kedinin o kıyafetle render edilmiş kendi animasyon setidir.
- Masaüstünde dolaşma: kedi çentikten masaüstüne sürüklenir, kıyafetiyle orada durur, imleci gözüyle izler. Tıkla dürt, sağ tıkla gardırop, çift tıkla çentiğe döner. Konum kalıcı.

### Hedef dışı
- Canlı 3D motoru, ses dosyası değiştirme, kediyle ilgili istatistik.

### Anti-hedef
- Kedi tam ekran oyun ve videoda üstte kalıp rahatsız etmemeli; tam ekran uygulamada masaüstü kedisi gizlenir.
- Kedi uygulamayı ağırlaştırmamalı: tüm animasyonlar toplamı makul boyutta (hedef < 15 MB), görünmezken animasyon durur.

### Builder'a kalan
- 3D modelin nasıl üretileceği (Blender'da elle/betikle, ya da logodan yapay zekâ ile 3D model üretip Blender'da düzeltme), animasyonlar ve 4-6 kıyafet.
- "İmleci gözüyle izleme": hazır animasyonda birkaç bakış yönü (sol, orta, sağ) render edilip imlece göre seçilir.
- Masaüstü kedisinin pencere tekniği (ayrı şeffaf, tıklama-geçirgen Tauri penceresi önerilir).
- İlk modelin bir önizlemesi kullanıcıya gösterilip onay alınır, sonra tüm animasyonlar render edilir.

---

### Karar değişikliği (2026-11-23 sabah)

Kullanıcı 3D (Blender) kediyi ve piksel kediyi beğenmedi. Yeni karar, kullanıcı onaylı deneme sayfasından (`.superpowers/spike-cat/`):
- Kedi **kodla çizilir** (Canvas 2D), Coucou'nun MIT lisanslı animasyon motoru üzerine. Mochi karakteri (görünüş, ifadeler) Coucou'nun lisansı dışında; bizim kedi kendi kafası, kulakları, logodaki yüzüyle çizilir. Coucou'nun görselleri, sesleri, kıyafet çizimleri kullanılmaz. MIT telif notu kodda kalır.
- **Yalnızca kafa** (gövde ve kuyruk yok). Yumuşak, sahte-3D gölgeli; kafa sağa sola döner ve eğilir.
- **Renkler:** beyaz, siyah, sarı, kırçıllı, gri. Gardıroptan seçilir.
- Kıyafetler (cadı şapkası, yılbaşı şapkası, bayramlık) kodla, bize özgü çizilir ve kafayla birlikte döner.
- 3D kedi, Blender işi ve WebP animasyon dosyaları iptal. Piksel SVG'ler artık kedi için kullanılmaz.
- Masaüstü kedisinde "imleci gözüyle izleme" motorun bakış yönüyle yapılır.

## 2. Çentikten AI sohbet (proje)

### Hedefler
- Her uygulamadan bir kısayolla (varsayılan `Ctrl+Alt+Space`, değiştirilebilir) çentik açılır ve sohbet görünür. Çentikteki bir sohbet düğmesiyle de açılır.
- Kullanıcı kendi API anahtarını girer. Sağlayıcılar: Google Gemini (ücretsiz anahtarı olduğu için varsayılan ve ilk önerilen), Anthropic Claude, OpenAI ChatGPT.
- Ayarlarda anahtar almayı adım adım anlatan rehber ve bağlantı; "Anahtarı dene" düğmesi.
- Anahtar Windows Credential Manager'da (`keyring` zaten bağımlılık). Diske, ayar dosyasına, loga ve arayüze yazılmaz; arayüz yalnızca "anahtar var mı" diye sorar.
- Yanıt akarak (stream) gelir; Markdown ve kod bloğu gösterilir; yanıt kopyalanabilir.
- Dosya bırakma: çentiğe bırakılan dosya (metin, PDF, resim) sohbete eklenir ve hakkında soru sorulur. Bugünkü raf (`NotchShelf`) davranışı bozulmaz: bırakırken "Rafa koy" / "Soru sor" seçilir.
- Sohbet geçmişi yerelde tutulur; "Yeni sohbet" ve geçmişi silme var.
- Arayüz dili uygulamanın dilini izler (i18n mevcut); model kullanıcıya hangi dilde yazdıysa o dilde cevap verir.

### Hedef dışı
- Abonelik/CLI üzerinden sohbet (Coucou'nun B yolu) şimdilik yok; ileride eklenebilir.
- Sesle konuşma, ajanın bilgisayarda işlem yapması, web araması.

### Anti-hedef
- Anahtarın sızması (log, hata mesajı, ayar dışa aktarma).
- Kullanıcının bilgisi olmadan dosya gönderilmesi: dosya yalnızca kullanıcı soru sorunca sağlayıcıya gider.
- Telemetri.

### Kısıtlar
- İstekler Rust tarafından (`reqwest` mevcut) yapılır; anahtar ön yüze hiç gelmez.
- Yalnızca kullanıcının seçtiği sağlayıcının resmi adresine istek gider.

### Yaklaşımlar
- **A) Kullanıcının kendi API anahtarı — seçildi.** Gemini'nin ücretsiz anahtarı sayesinde sıradan kullanıcı para ödemeden kullanabilir. Eksi: kullanıcının bir kez anahtar alması gerekir; rehberle çözülür.
- B) Abonelik/CLI yolu: sıradan kullanıcıda bu araçlar kurulu olmadığı için zayıf.
- C) İkisi birden: iş iki katı; B sonradan eklenebilir.

### Builder kontrolünden sonra verilen kararlar (Claude'un kararı, kullanıcı düzeltebilir)
- Kısayol: mevcut kısayol altyapısı (`ShortcutRecorder`, `setup_keyboard_hook`) kullanılır, yeni eklenti eklenmez. Kısayol alınamazsa ayarlarda uyarı gösterilir, sohbet düğmesi yine çalışır.
- Odak: sohbet kısayolla ya da düğmeyle açılınca klavye odağını alır. `Esc` ya da dışarı tıklama kapatır. Kapanınca sohbet kaybolmaz, tekrar açınca kaldığı yerden devam eder. Sohbet açıkken üzerine gelme/ayrılma ile kapanma devre dışı.
- Dosyalar: sağlayıcı destekliyorsa resim ve PDF doğrudan gönderilir (üçü de resim ve PDF kabul ediyor). Metin dosyaları (txt, md, csv, json, kod) metin olarak eklenir. Desteklenmeyen tür nazikçe reddedilir.
- Geçmiş: her sohbet hangi sağlayıcıyla başladığını saklar; sohbet ortasında sağlayıcı değişirse yeni mesajlar yeni sağlayıcıya gider. Geçmişte dosyanın yalnızca adı tutulur, içeriği tutulmaz.
- Bırakma: dosya bırakılırken varsayılan davranış bugünkü raf (`NotchShelf`); "Soru sor" ayrı bir bırakma alanıdır.
- Tam ekran: masaüstü kedisi mevcut tam ekran algılamasını kullanır.
- Maskot kodu 3D çizimler hazır olmadan yazılabilir; onaylanmış 3D kedi gelene kadar mevcut piksel SVG'ler yedek olarak kalır.

### Builder'a kalan
- Her sağlayıcının varsayılan modeli (o günün güncel ve ucuz modeli; Claude için güncel Haiku/Sonnet), sohbet panelinin yerleşimi ve boyutu, geçmişin saklama biçimi, büyük dosya sınırı.
