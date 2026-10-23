# Changelog

Each release on GitHub uses the matching section below as its notes (see `scripts/release-notes.mjs`).

## [1.1.3] - 2026-10-23

### Improved
- Faster start: the PDF reader and the Office/EPUB converters load when you first import a file, which halves the code the app loads at launch (853 KB to 430 KB).
- Smoother streaming: summaries and answers redraw at most once per screen frame while the model writes, instead of re-laying out the whole text on every token.
- Smoother scrolling on phones: the blurred, see-through header and dialog backdrops are now solid on small screens, where the blur had to be redrawn on every scroll frame.

### تحسينات
- تشغيل أسرع: يُحمَّل قارئ PDF ومحوّلات Office وEPUB عند أول استيراد لملف، فينخفض الكود المحمَّل عند الإقلاع إلى النصف (من 853 KB إلى 430 KB).
- بثّ أسلس: تُعاد رسم الملخصات والإجابات مرة واحدة على الأكثر في كل إطار أثناء كتابة النموذج، بدل إعادة تنسيق النص كاملًا مع كل رمز.
- تمرير أسلس على الهواتف: صار الشريط العلوي وخلفية النوافذ الحوارية بلون مُصمت على الشاشات الصغيرة، بعد أن كان التمويه يُعاد رسمه مع كل إطار تمرير.

### Fixed
- Local models on phones no longer answer with garbled text such as "une-m-m-m-m…". Phone GPUs lose precision in 16-bit shaders, and the DeltaNet layers of Qwen3.5 then break down. Phones now use the 32-bit build of each model (about 15% more GPU memory, one new download). A new setting, Settings → Local engine → GPU precision, lets you choose 16-bit or 32-bit on any device.
- If a local model still produces garbled text, the app stops with an explanation and the fix, instead of returning the garbage as a summary or quiz.

### إصلاحات
- لم تعد النماذج المحلية على الهواتف تُخرج نصًا مشوّهًا مثل "une-m-m-m-m…". تفقد معالجات رسوميات الهواتف الدقة في حسابات 16-بت فتنهار طبقات DeltaNet في Qwen3.5. صارت الهواتف تستخدم نسخة 32-بت من كل نموذج (ذاكرة رسوميات أكثر بنحو 15% وتنزيل جديد مرة واحدة). وإعداد جديد في الإعدادات ← المحرّك المحلي ← دقة حساب معالج الرسوميات يتيح اختيار 16-بت أو 32-بت على أي جهاز.
- إن أخرج النموذج المحلي نصًا مشوّهًا رغم ذلك، يتوقف التطبيق برسالة تشرح السبب والحل، بدل عرض النص المشوّه كملخص أو اختبار.

## [1.1.2] - 2026-10-23

### Security
- The local server (`npm run serve`, the desktop app) no longer lets a web page reach other services on this computer through its cloud proxy. A page that pointed its own domain at 127.0.0.1 (DNS rebinding) could send requests to services such as Ollama on localhost and read the replies, bypassing their own Host/Origin checks. Requests from this computer must now use a local host name.

### أمان
- لم يعد الخادم المحلي (`npm run serve` وتطبيق سطح المكتب) يسمح لصفحة ويب بالوصول إلى خدمات أخرى على هذا الجهاز عبر وسيط السحابة. كانت صفحة تُوجّه نطاقها إلى 127.0.0.1 (DNS rebinding) قادرة على إرسال طلبات إلى خدمات مثل Ollama على localhost وقراءة ردودها متجاوزةً فحوص Host/Origin الخاصة بها. صار على الطلبات القادمة من هذا الجهاز استخدام اسم مضيف محلي.

### Fixed
- Summarizing with a local model no longer freezes the app and the phone. WebLLM 0.2.86 sent a whole model step to the GPU as one command buffer, which kept the system compositor from drawing the screen. The app now submits GPU work every 8 dispatches, following the pending upstream fix apache/tvm#19418.
- Local models no longer fail with "Failed to execute 'mapAsync' on 'GPUBuffer': Buffer was unmapped before mapping was resolved". When the GPU device is lost during a token readback, the app reloads the model and retries the request. Unloading or switching models while a request runs now stops that request first, so the device is no longer destroyed during a readback.

### إصلاحات
- لم يعد التلخيص بنموذج محلي يجمّد التطبيق والهاتف. كان WebLLM 0.2.86 يرسل خطوة النموذج كاملةً إلى معالج الرسوميات في دفعة واحدة، فيمنع مُركِّب الشاشة في النظام من الرسم. صار التطبيق يرسل العمل كل 8 عمليات، كما في الإصلاح المقترح apache/tvm#19418 الذي لم يُدمج بعد.
- لم تعد النماذج المحلية تفشل بالخطأ "Failed to execute 'mapAsync' on 'GPUBuffer': Buffer was unmapped before mapping was resolved". عند فقدان معالج الرسوميات أثناء قراءة رمز يعيد التطبيق تحميل النموذج ويكرر الطلب. وتفريغ النموذج أو تبديله أثناء طلب جارٍ يوقف ذلك الطلب أولًا، فلا يُدمَّر معالج الرسوميات أثناء القراءة.

## [1.1.1] - 2026-10-23

### Fixed
- Local models no longer fail with "Model not loaded before trying to complete ChatCompletionRequest". When the GPU device is lost (Android sending the app to the background, GPU memory pressure), WebLLM drops the model on its own. The app now reloads it from storage, with no new download, and retries the request once. If that also fails, the engine shows a clear error with one-click fallbacks instead of staying "Ready".
- The download stall watchdog no longer interrupts loading the model onto the GPU or compiling its shaders, which can take minutes on a phone.
- Android keeps its background service running until the last job ends, so a model reload no longer cancels the screen-off protection of a summary in progress.

### إصلاحات
- لم تعد النماذج المحلية تفشل بالخطأ "Model not loaded before trying to complete ChatCompletionRequest". عند فقدان معالج الرسوميات (حين يُرسل Android التطبيق إلى الخلفية أو عند ضغط الذاكرة) يُسقط WebLLM النموذج من تلقاء نفسه؛ والآن يعيد التطبيق تحميله من الذاكرة دون تنزيل جديد ويعيد الطلب مرة واحدة. وإن فشل مجددًا تظهر رسالة واضحة مع حلول بنقرة واحدة بدل البقاء على "جاهز".
- مؤقّت كشف تعثّر التنزيل لم يعد يقطع تحميل النموذج إلى معالج الرسوميات أو تجميع الـ shaders، وقد يستغرق ذلك دقائق على الهاتف.
- تبقى خدمة الخلفية في Android تعمل حتى تنتهي آخر مهمة، فلا تُلغي إعادة تحميل النموذج حماية التلخيص الجاري عند إطفاء الشاشة.

## [1.1.0] - 2026-10-23

### Added
- **Import more formats:** Word (`.docx`), PowerPoint (`.pptx`), Excel (`.xlsx`), EPUB, HTML, CSV/TSV, Jupyter notebooks and JSON, alongside PDF, TXT and Markdown. Files are converted to structured Markdown on the device, following the approach of [microsoft/markitdown](https://github.com/microsoft/markitdown).
- **Save results as PDF, Word or Markdown:** summaries, study sets, Q&A sessions and history entries. The layout has a cover block, metadata, highlighted correct answers, citation badges and page numbers, and it is right-to-left for Arabic.
- **Model downloads you can pause and resume:** progress with size, speed and time left; automatic retries when the connection drops; resume after closing the app; a storage check before downloading; one-click switch to a lighter model or the CPU engine on GPU errors.
- **Accuracy checks:** every number in a summary is checked against the document, and key-term coverage is measured. In *Maximum* quality the refine pass is told exactly what to fix.
- **Fewer tokens:** a persistent notes cache (re-opening a book re-reads nothing), repeated sections skipped, and the refine call skipped when the draft already checks out. Each summary shows how many tokens it saved.

### Security
- The local server refuses cross-origin `/api` requests, which blocks other websites (CSRF) and DNS rebinding from toggling LAN sharing.
- The Android app opens only `http`, `https` and `mailto` links externally.

### Fixed
- The cited source is highlighted again in "Ask the document".

### الجديد
- **صيغ استيراد إضافية:** Word وPowerPoint وExcel وEPUB وHTML وCSV/TSV ودفاتر Jupyter وJSON، إلى جانب PDF وTXT وMarkdown. تُحوَّل الملفات على الجهاز إلى Markdown منظّم على نهج [microsoft/markitdown](https://github.com/microsoft/markitdown).
- **حفظ النتائج بصيغة PDF أو Word أو Markdown:** للملخّصات ومجموعات المذاكرة وجلسات الأسئلة والسجل، بتصميم احترافي: غلاف وبيانات وإبراز للإجابة الصحيحة وشارات للاستشهادات وترقيم للصفحات، مع اتجاه من اليمين إلى اليسار للعربية.
- **تنزيل النماذج مع الإيقاف المؤقت والاستئناف:** عرض الحجم والسرعة والوقت المتبقي، وإعادة المحاولة تلقائيًا عند انقطاع الاتصال، والاستئناف بعد إغلاق التطبيق، وفحص المساحة قبل التنزيل، والتحويل بنقرة إلى نموذج أخف أو إلى محرّك المعالج عند أخطاء معالج الرسوميات.
- **فحوص الدقة:** مطابقة كل رقم في الملخّص مع المستند وقياس تغطية المصطلحات الرئيسية، وفي الجودة القصوى تُعطى جولة التحسين تعليمات دقيقة بما يجب إصلاحه.
- **توكنز أقل:** ذاكرة مؤقتة دائمة للملاحظات (إعادة فتح الكتاب لا تعيد قراءته)، وتخطّي الأقسام المكررة، وتخطّي جولة التحسين حين تكون المسودة سليمة. ويعرض كل ملخّص ما وفّره من توكنز.

### الأمان
- يرفض الخادم المحلي طلبات `/api` القادمة من مصادر أخرى، فلا تستطيع مواقع أخرى (CSRF) ولا هجمات DNS rebinding تشغيل المشاركة عبر الشبكة المحلية.
- لا يفتح تطبيق Android خارجيًا إلا روابط `http` و`https` و`mailto`.

### إصلاحات
- عاد إبراز المصدر المستشهد به في "اسأل المستند".

## [1.0.0] - 2026-10-22

### Added
- Private PDF, TXT and Markdown summarizer running a local model on the GPU (WebLLM) with a CPU fallback (transformers.js).
- Deep summaries in three formats, a smart test maker (multiple choice and flashcards), and "Ask the document" with cited answers.
- Execution modes: Local, Cloud, Together and Smart, with 17 cloud providers and your own API keys.
- History with ratings, and export of liked runs as fine-tuning data.
- Arabic and English interface with full right-to-left support.
- Packages for web, Docker, Windows (MSI), Linux (AppImage, deb, tar.gz) and Android, with LAN sharing and signed automatic updates.

### الإصدار الأول
- ملخّص خاص لملفات PDF وTXT وMarkdown يشغّل نموذجًا محليًا على معالج الرسوميات (WebLLM) مع بديل يعمل على المعالج (transformers.js).
- تلخيص معمّق بثلاث صيغ، وصانع اختبارات ذكي (اختيار من متعدد وبطاقات مراجعة)، و"اسأل المستند" بإجابات موثّقة بالمصادر.
- أوضاع تشغيل: محلي وسحابي ومشترك وذكي، مع 17 مزوّدًا سحابيًا بمفاتيحك الخاصة.
- سجلّ مع تقييم النتائج، وتصدير النتائج المفضّلة بيانات تدريب.
- واجهة عربية وإنجليزية بدعم كامل للاتجاه من اليمين إلى اليسار.
- حزم للويب وDocker وWindows (MSI) وLinux (AppImage وdeb وtar.gz) وAndroid، مع مشاركة عبر الشبكة المحلية وتحديثات تلقائية موقّعة.
