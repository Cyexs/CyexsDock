# Notlar

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
