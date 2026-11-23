# Notlar

## 2026-11-23 oturumu (dal: `kedi-maskot`, main'e birleştirilmedi, push yok)

### Yapılanlar
- Coucou (github.com/Louis-CFM/coucou, kod MIT, Mochi karakteri/görselleri lisans dışı) araştırıldı; kedi maskot + çentikten AI sohbet seçildi. Tasarım: `docs/superpowers/specs/2026-11-23-coucou-ozellikleri-design.md`, plan: `docs/superpowers/plans/2026-11-23-kedi-maskot.md`, ajan defteri: `.superpowers/sdd/2026-11-23-kedi-maskot/progress.md`.
- Tam ekran: dock/çentik her modda gizleniyor (139047c); asıl neden Chrome video tam ekranının maximized+caption stili, client alanı ekranı kaplıyorsa tam ekran sayılıyor (fb90b13). Kullanıcı doğruladı: YouTube tam ekran oluyor.
- Kedi: çentikte, tepkiler (1 tık sev, 2 hızlı kız, 3 hızlı baş dönmesi, 2 sn üstünde kalp, boşta kaşınma), gardırop, masaüstü kedisi, "Kediyi göster" ayarı.
- Kedi görünüşü: 3D (Blender) ve piksel reddedildi; Coucou motoru üzerine kodla çizilen kafa (`src/mascot/catEngine.ts`, MIT başlığı korunuyor), 5 renk (`nectar-cat-color`), kendi kıyafetlerimiz: cadı şapkası, yılbaşı şapkası, altın kordonlu fes.
- Test exe: `src-tauri/target/release/cyexs.exe` (12:55 derlemesi, son kod).

### Kararlar
- Kedi yalnızca kafa; Mochi'ye benzememeli; Coucou görsel/ses/kıyafeti kopyalanmaz.
- Bayramlık yalnızca Ramazan/Kurban Bayramı; uyuma = çentiğe 10 dk dokunulmaması.
- Kaspersky her Rust derlemesinde yeniden duraklatılmalı (geri açılınca build script exe'lerini siliyor).

### Sıradaki işler
1. Masaüstü kedisi: sürükleyince kayboluyor; pencere oluşuyor ama gizli kalıyor ve yerine taşınmıyor (`CyexsDock Cat` vis=False, sol üstte). Masaüstündeki `nectar.log`'a bak.
2. Kaspersky penceresi -25600,-25600'de kalıyor, ekrana gelmiyor; CyexsDock ekran dışı pencere kurtarma bunu yakalamıyor olabilir, aynı logda kontrol et.
3. Siyah ekran (bugün ~12:45, test sürümü açıkken; dock kapatınca düzeldi): logda büyük pencere kaydı yok; tahmin: saydam çentik+dock pencereleri siyaha döndü. Kullanıcıdan o anki işlemi öğren.
4. Kedinin çentikte, gardırobun ve masaüstü kedisinin gerçek uygulamada denenmesi (renkler, kıyafetler, tepkiler).
5. Masaüstü gardırobu küçük kediyi kapatıyor (ertelendi).
6. AI sohbet (spec bölüm 2) için plan yazılmadı.
7. Bitince dalı main'e birleştirme ve sürüm yayını kullanıcı onayıyla.

## 2026-11-21 oturumu

### Yapılanlar
- Kendi exe filtresi düzeltildi: "cyexs.exe" artık tam dosya adıyla eşleşiyor (`services.rs` `ends_with("\\cyexs.exe")`, `Dock.tsx` regex). tikcyexs.exe gibi uygulamalar Dock'ta görünüyor; kullanıcı doğruladı.
- `tsc --noEmit` temiz geçti.
- v1.10.9 GitHub'a yayınlandı (setup 7,2 MB, portable zip 10,1 MB).
- Kaspersky, cargo build script exe'lerini `HEUR:Exploit.Win32.Convagent.gen` diye engelledi. Çözüm: korumayı ~30 dk duraklat, `src-tauri/target/release/build/<crate>` klasörlerini sil, yeniden derle.

### Kararlar
- Kaspersky klasör istisnası davranış izlemeyi kapsamıyor; derlemede duraklatma kullanılacak.

### Sıradaki işler
1. "Cyexs Dev." oturumuna 1.10.9 bildirildi; sitede güncellendiğini kontrol et.
2. Kaspersky arayüzü küçültülmüş halde takılıp açılmadı; tekrarlarsa nedenine bak (Dock'tan bağımsız çıktı).
3. 2026-11-20 listesindeki işler sürüyor.

## 2026-11-20 oturumu

### Yapılanlar
- Windows 10 uyumu: pencere önizlemesi sarı çerçeve çıkarsa `PrintWindow`'a düşüyor (`src-tauri/src/capture.rs`).
- Özel kurucu (`installer-app`): Mica yoksa bulanık arka plan; WebView2 yoksa uyarı ve indirme teklifi. Not: yayınlanan NSIS kurulumu bu kurucuyu kullanmıyor.
- Klasik müzik çalar yenilendi: düğmeler başlığın yanında, ses çubuğu yerine tutamaçlı ilerleme çubuğu + şarkı süresi, ses fare tekerleğinde, çentik 340 → 460px.
- Albüm kapağına ⇄ rozeti ve "Oynatıcı görünümünü değiştir" ipucu (6 dil).
- v1.10.8 yayınlandı; "Cyexs Dev." oturumuna indirme bilgisi gönderildi.
- Site görselleri `../site-gorselleri/` altında (dock şeridi + kullanıcının verdiği 8 ekran).
- Siyah pencere olayı (2026-11-19 22:17) logda Claude'un ekran görüntüsü aracıyla aynı ana denk geldi; uygulama hatası bulunmadı.

### Kararlar
- Her gerçek yayından sonra "Cyexs Dev." oturumuna sürüm, dosya adı ve boyut gönderilecek.
- Ekran görüntüsünde şehir adı (Yalova) bulanıklaştırılacak; görseller sitede reklam tasarımı gibi kullanılacak.

### Sıradaki işler
1. Win10 makinede gerçek test (hiç denenmedi).
2. Dock tıklamasının logda 2-3 kez aynı milisaniyede görünmesi: tek tıklamada çift işlem mi, kontrol et.
3. Klasör yığınından dosya sürükleme hatası (askıda).
4. Müzik denetimi için site görseli (yeni klasik görünümle).
5. Acrylic pencerelerin Win10'da sürüklerken takılması.
