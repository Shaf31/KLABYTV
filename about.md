<p align="center">
  <img src="build/icon.png" width="180" alt="KLABYTV" />
</p>

<h1 align="center">KLABYTV</h1>

<p align="center">
  مشغل IPTV بواجهة شبه Netflix — للماك والويندوز وأندرويد وأندرويد TV<br/>
  An IPTV player with a Netflix-style interface — for Mac, Windows, Android and Android TV
</p>

<p align="center">
  <a href="https://github.com/Shaf31/KLABYTV/releases/latest"><b>⬇ التحميل · Download</b></a>
</p>

---

## البرنامج ده إيه؟

KLABYTV برنامج تتفرج بيه على اشتراك الـ IPTV بتاعك (قنوات مباشرة، أفلام، مسلسلات) بواجهة سهلة شبه Netflix، وبيوريك بالظبط استهلكت إنترنت قد إيه في كل حاجة اتفرجت عليها.

- بيشتغل مع اشتراكات **Xtream Codes** وقوايم **M3U** (رابط أو ملف من الجهاز).
- **عربي وإنجليزي**: بيمشي على لغة الجهاز، وتقدر تغيّرها من الإعدادات.
- **مشغل داخلي لكل الصيغ**: مش محتاج VLC ولا أي برنامج تاني. الصيغ الصعبة (MKV، صوت AC3/DTS، HEVC) بتتحول وهي شغالة جوه البرنامج.
- **عداد استهلاك** لكل جهاز لوحده، ووضع **توفير الاستهلاك**.
- بيتحكم فيه **بالكيبورد والماوس** على الكمبيوتر، **باللمس** على الموبايل، و**بالريموت** على التلفزيون.

## التحميل

من صفحة [Releases](https://github.com/Shaf31/KLABYTV/releases/latest):

| الجهاز | الملف |
|---|---|
| ماك (Apple Silicon و Intel) | `KLABYTV-…-mac-universal.zip` |
| ويندوز (64-bit) | `KLABYTV-…-win.zip` |
| موبايل أندرويد | `KLABYTV-…-android-phone.apk` |
| أندرويد TV / تي في بوكس / تابلت | `KLABYTV-…-android-tv-tablet.apk` |
| ملف M3U للتجربة | `KLABYTV-sample.m3u` |

## التسطيب

### ماك
1. فك ضغط الملف وانقل `KLABYTV.app` لفولدر **Applications**.
2. البرنامج مش متوقّع من Apple، فنفّذ الأمر ده مرة واحدة في **Terminal** (من غيره الماك هيقول إن البرنامج "damaged"):
   ```bash
   xattr -cr "/Applications/KLABYTV.app" && codesign --force -s - "/Applications/KLABYTV.app/Contents/Resources/ffmpeg/ffmpeg" && codesign --force --deep -s - "/Applications/KLABYTV.app"
   ```
3. افتح البرنامج عادي.

### ويندوز
1. فك الضغط في أي فولدر وشغّل `KLABYTV.exe`.
2. لو ظهرت رسالة **Windows protected your PC**: دوس **More info** وبعدين **Run anyway** (البرنامج مش متوقّع).

### أندرويد
- **الموبايل**: `android-phone.apk` (اسمه KLABYTV)، بواجهة لمس.
- **التلفزيون والتابلت**: `android-tv-tablet.apk` (اسمه KLABYTV TV). على التلفزيون بيظهر في قايمة التطبيقات وبيشتغل بالريموت، وعلى التابلت نفس الواجهة الكبيرة باللمس.
- تقدر تسطّب الاتنين على نفس الجهاز.
- انقل الملف للجهاز وافتحه، ووافق على **التثبيت من مصادر غير معروفة**. على التي في بوكس استخدم تطبيق **Downloader** أو فلاشة.

## الاستخدام

### 1. إضافة حساب
أول ما تفتح البرنامج هتلاقي شاشة **تسجيل الدخول** وفيها اختيارين:

- **Xtream Codes**: اكتب عنوان السيرفر مع البورت (مثلًا `http://example.com:8080`) واسم المستخدم وكلمة المرور. ولو معاك رابط `get.php` الصقه وهو هيطلّع البيانات لوحده.
- **قائمة M3U**: الصق رابط القائمة، أو دوس **«اختار ملف من الجهاز»** واختار ملف `.m3u`.
  - البرنامج بيقسّم القائمة لوحده لقنوات وأفلام ومسلسلات، والحلقات بتتجمع بالمواسم من أسماء زي `S01E02`.
  - لو القائمة فيها رابط دليل برامج (XMLTV)، هيظهرلك البرنامج الحالي والجاي على كل قناة.
  - مش معاك قائمة؟ جرّب بملف `KLABYTV-sample.m3u` اللي في صفحة التحميل.

تقدر تضيف أكتر من حساب، وتختار بينهم من شاشة **«مين بيتفرج؟»**.

### 2. التصفح
- **الرئيسية**: كمّل مشاهدة، القنوات اللي شفتها مؤخرًا، قائمتي، أحدث الأفلام والمسلسلات، وصف لكل قسم.
- **البث المباشر / الأفلام / المسلسلات**: بالأقسام.
- **قائمتي**: اضغط **F** (أو زرار **+**) على أي فيلم أو مسلسل أو قناة علشان تضيفه.
- **البحث**: اضغط **/** أو أيقونة البحث.

### 3. المشغل
| الأمر | الكيبورد والماوس | اللمس |
|---|---|---|
| تشغيل / إيقاف | Space أو كليك | الزرار الكبير في النص |
| تقديم / تأخير | ← → أو دبل كليك على يمين/شمال الشاشة | دبل تاب على يمين/شمال الشاشة |
| القناة اللي بعدها / قبلها | ↑ ↓ | — |
| ملء الشاشة | F أو دبل كليك في النص | — |
| الصوت | + / − أو عجلة الماوس | — |
| اختيار الجودة | Q | زرار الجودة |
| عداد الاستهلاك | I | زرار العداد |
| وضع التوافق | C | زرار التوافق |
| رجوع | Esc / Backspace / زرار الماوس الخلفي | زرار الرجوع |

- الأفلام والحلقات بتكمّل من مكان ما وقفت.
- مدة التقديم والتأخير بتتغير من الإعدادات (5 ثواني لحد 5 دقايق).
- لو الصيغة مش مدعومة، البرنامج بيحوّلها لوحده (**وضع التوافق**) أو بيفتحها في مشغل أندرويد الأصلي.

### 4. استهلاك الإنترنت
- أثناء المشاهدة: السرعة، الاستهلاك، والمدة فوق الفيديو (تقدر تخفيه من الإعدادات أو بزرار **I**).
- صفحة **«الاستهلاك»**: النهارده، امبارح، آخر 7 أيام، آخر 30 يوم، الشهر الحالي أو فترة تختارها. فيها رسم بياني يومي وجدول بكل مرة اتفرجت فيها: المدة، الاستهلاك، ومتوسط السرعة.
- الاستهلاك بيتحسب **لكل جهاز لوحده**، واسم الجهاز بيتغير من الإعدادات.

### 5. توفير الاستهلاك (من الإعدادات)
- **اختيار الجودة**: لو القناة أو الفيلم موجودين بأكتر من جودة، تختار الأقل، وجنب كل جودة استهلاكها في الساعة.
- **مدة البافر**: البرنامج بيحمّل قدامك المدة دي بس (30 ثانية لحد 5 دقايق)، مش الفيلم كله.
- **لسه بتتفرج؟**: لو مفيش أي حركة لمدة ساعة أو اتنين أو أكتر، التشغيل بيقف وبيسألك.
- **وقف التشغيل لما البرنامج يتصغّر**، وبيكمّل لوحده لما ترجعله.

### 6. اللغة
من **الإعدادات ← اللغة**: تلقائي (زي لغة الجهاز) أو العربية أو English. التغيير بيحصل على طول.

## أسئلة

**القناة مش شغالة؟**
جرّب صيغة البث التانية (TS / HLS) من زرار **TS/HLS** في المشغل أو من الإعدادات، أو غيّر الـ User-Agent من **الإعدادات ← متقدم**. وتأكد إن اشتراكك فعال وإنك مش فاتح على أجهزة أكتر من المسموح.

**بياناتي محفوظة فين؟**
على جهازك بس. الحسابات والمفضلة وسجل الاستهلاك مش بتتبعت لأي حد، وكلمات المرور متشفرة بخزنة النظام (Keychain / DPAPI / Android Keystore).

**البرنامج بيوفّر قنوات أو اشتراكات؟**
لأ. KLABYTV مشغل بس، ومش جواه أي محتوى. محتاج يكون عندك اشتراك من مزود خدمة.

---

## English

**KLABYTV** is an IPTV player with a Netflix-style interface for **macOS (universal), Windows, Android phones and Android TV / tablets**.

- **Sources:** Xtream Codes accounts, and M3U playlists from a link or a file. Playlists are split into channels, movies and series, and episodes are grouped by season. The XMLTV guide loads when the playlist links one.
- **Built-in player for every format:** MPEG-TS, HLS and MP4 play directly. MKV, AC3/DTS audio and HEVC are converted on the fly by the bundled ffmpeg, or opened in the native Android player.
- **Data usage:** every byte is counted per device, with live speed in the player and daily charts and a session history on the usage page.
- **Data saver:** quality picker with data per hour, a fixed buffer for movies, "Still watching?" and pausing while minimized.
- **Controls:** keyboard and mouse, including mouse back/forward buttons; touch, with double tap to seek; TV remote.
- **Arabic and English:** follows the device language and can be changed in the settings.

Downloads are on the [Releases](https://github.com/Shaf31/KLABYTV/releases/latest) page. See [README.md](README.md) to build from source.

KLABYTV is a player only. It doesn't include any channels or content.
