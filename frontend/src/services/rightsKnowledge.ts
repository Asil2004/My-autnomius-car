/**
 * Fuqarolar va ichki ishlar xodimlarining huquq va burchlari (oflayn bilim bazasi) hamda
 * robotning "politsiya xodimi" sifatidagi xulq-atvor qoidalari.
 *
 * Manbalar (lex.uz da 2026-yil noyabrda tekshirilgan, faqat shu moddalarga tayanadi):
 *  - "Ichki ishlar organlari to'g'risida"gi Qonun (O'RQ-407), https://lex.uz/uz/docs/3027843
 *      6-m. qonuniylik; 8-m. fuqarolar huquqlarini hurmat qilish (xodim o'zini tanishtiradi, guvohnoma ko'rsatadi,
 *      murojaat sababini aytadi, qiynoq va kamsitish taqiqlanadi); 9-m. ochiqlik; 10-m. qonuniy talablarning majburiyligi;
 *      16-m. IIO majburiyatlari; 17-m. IIO huquqlari; 18-m. ushlab turish; 21–24-m. jismoniy kuch, maxsus vositalar,
 *      o'qotar qurol; 34-m. xodimlarni huquqiy himoya qilish kafolatlari.
 *  - Konstitutsiya (2023), https://lex.uz/docs/6445145
 *      19, 25, 26, 27, 28, 29, 31, 32, 33, 40, 55-moddalar (huquqlar), 59–64-moddalar (fuqarolarning burchlari).
 *  - Jinoyat kodeksi 219-modda (hokimiyat vakiliga qarshilik), https://lex.uz/uz/docs/111453
 *
 * Javoblar qisqa (ovoz bilan o'qiladi), "siz" shaklida, xotirjam va hurmatli ohangda.
 */

import type { QaEntry } from './localKnowledge';

/** Xodim xulq-atvori: Gemini uchun ko'rsatma (IIO qonuni 6, 8, 10-moddalari va Konstitutsiya 19, 26-moddalari asosida) */
export const OFFICER_CONDUCT =
  "Xulq-atvoring ichki ishlar xodimi odobiga mos bo'lsin:\n" +
  "- Fuqaroga doim \"siz\" deb, hurmat bilan murojaat qil (\"Hurmatli fuqaro\", ismini bilsang \"Hurmatli Aziz aka\" kabi). Qo'pol, kinoyali yoki kamsituvchi so'z ishlatma.\n" +
  "- Kimligingni so'rashsa, o'zingni tanishtir: QALQON patrul robotiman, ichki ishlar organlari navbatchi qismi nazoratida ishlayman; murojaat sababini ayt (IIO qonuni 8-moddasi).\n" +
  "- Fuqaroning huquqlarini tushuntir, uni qo'rqitma, tahdid qilma, aybdor deb atama: aybni faqat sud belgilaydi (Konstitutsiya 28-modda).\n" +
  "- Hamma fuqaroga jinsi, millati, tili, dini va mavqeidan qat'i nazar teng munosabatda bo'l (Konstitutsiya 19-modda).\n" +
  "- Haqorat qilishsa ham xotirjam qol, javoban haqorat qilma, suhbatni yordam berishga qaytar.\n" +
  "- Masala sening vakolatingda bo'lmasa, qaysi organga murojaat qilish kerakligini tushuntir (IIO qonuni 8-moddasi).\n" +
  "- Fuqaroning shaxsiy ma'lumotlari va shaxsiy hayoti haqida gapirma, ularni oshkor qilma.\n" +
  "- Sen robotsan: hech kimni ushlamaysan, tintuv qilmaysan, kuch ishlatmaysan; bunday holatda navbatchi xodimlarni chaqirasan.";

/** Huquq va burchlar bo'yicha savol-javoblar (lokal miya, internetsiz) */
export const RIGHTS_QA: QaEntry[] = [
  // ---------------- Xodim fuqaroga murojaat qilganda ----------------
  {
    id: 'xodim-toxtatdi',
    q: [
      'politsiya meni toxtatdi', 'politsiya toxtatsa nima qilishim kerak', 'militsiya toxtatdi', 'xodim meni toxtatdi',
      'patrul toxtatdi huquqlarim qanday', 'kochada politsiya toxtatsa', 'ichki ishlar xodimi toxtatsa', 'gai toxtatdi'
    ],
    a: "\"Ichki ishlar organlari to'g'risida\"gi qonunning 8-moddasiga ko'ra, xodim sizga murojaat qilganda lavozimi, unvoni va familiyasi, ismi, otasining ismini aytishi, so'rasangiz xizmat guvohnomasini ko'rsatishi va murojaat sababini tushuntirishi shart. Siz esa xotirjam bo'ling va uning qonuniy talablarini bajaring."
  },
  {
    id: 'guvohnoma',
    q: [
      'xodimdan guvohnoma sorasam boladimi', 'guvohnomasini korsatishi shartmi', 'xodim ozini tanishtirmadi',
      'politsiyachi ozini tanishtirishi kerakmi', 'xizmat guvohnomasini korsat', 'xodim kimligini aytmadi'
    ],
    a: "Ha, so'rashingiz mumkin. Qonunning 8-moddasiga ko'ra, xodim o'zini tanishtirishi va fuqaro talab qilsa xizmat guvohnomasini ko'rsatishi shart. Guvohnomani xotirjam, hurmat bilan so'rang."
  },
  {
    id: 'hujjat-tekshirish',
    q: [
      'politsiya hujjatimni tekshira oladimi', 'pasportimni sorashga haqqi bormi', 'hujjat korsatishim shartmi',
      'xodim hujjatimni sorayapti', 'shaxsimni tasdiqlovchi hujjat', 'id kartamni korsatishim kerakmi'
    ],
    a: "Qonunning 17-moddasiga ko'ra, ichki ishlar organlari fuqarolarning shaxsini tasdiqlovchi hujjatlarni tekshirish huquqiga ega. 10-moddaga ko'ra, xodimning qonuniy talabi hamma uchun majburiy. Shuning uchun hujjatingizni ko'rsating, so'rasangiz xodim sababini tushuntiradi."
  },
  {
    id: 'shaxsiy-korik',
    q: [
      'chontagimni tekshirishga haqqi bormi', 'sumkamni tekshira oladimi', 'meni tintuv qilishdi', 'shaxsiy korik',
      'narsalarimni tekshirishdi', 'politsiya meni kora oladimi'
    ],
    a: "Qonunning 17-moddasiga ko'ra, odamda qurol, o'q-dori, portlovchi yoki giyohvandlik vositasi kabi taqiqlangan narsalar bor deb hisoblash uchun asos bo'lsa, xodim shaxsiy ko'rik o'tkazib, ularni olib qo'yishi mumkin. Ko'rik sababini so'rashga haqlisiz."
  },
  {
    id: 'qonuniy-talab',
    q: [
      'politsiya talabini bajarishim shartmi', 'xodimga boysunmasam nima boladi', 'xodim talabiga qarshi chiqsam',
      'politsiyaga qarshilik qilsam', 'xodimning talabiga rozi bolmasam', 'xodim aytganini qilmasam'
    ],
    a: "Qonunning 10-moddasiga ko'ra, xodimning qonuniy talablari hamma uchun majburiy, unga shikoyat qilish talabni bajarishni to'xtatmaydi. Rozi bo'lmasangiz, avval talabni bajaring, keyin qonuniy yo'l bilan shikoyat qiling. Hokimiyat vakiliga qarshilik ko'rsatish Jinoyat kodeksining 219-moddasiga ko'ra jinoyat."
  },
  {
    id: 'xodimga-murojaat',
    q: [
      'politsiyachiga qanday murojaat qilish kerak', 'xodim bilan qanday gaplashish kerak', 'politsiya toxtatsa ozimni qanday tutay',
      'militsiyaga qanday murojaat qilaman', 'inspektorga qanday murojaat qilinadi'
    ],
    a: "Xodimga xotirjam va hurmat bilan, \"Hurmatli inspektor\" yoki \"Hurmatli xodim\" deb murojaat qiling. Qo'llaringiz ko'rinib tursin, keskin harakat qilmang, savolingizni aniq ayting. Uning ham o'zini tanishtirishi va sizga sababini tushuntirishi shart."
  },

  // ---------------- Ushlab turish va tergov ----------------
  {
    id: 'ushlanganda-huquq',
    q: [
      'meni ushlashsa qanday huquqlarim bor', 'ushlab turilganda nima qilishim kerak', 'qolga olinganda huquqlar',
      'meni bolimga olib ketishdi', 'ushlangan odamning huquqlari', 'meni ushlab olishdi', 'ushlab turish muddati'
    ],
    a: "Konstitutsiyaning 27-moddasiga ko'ra, ushlangan shaxsga uning huquqlari va ushlash asoslari tushunarli tilda tushuntiriladi, sud qarorisiz 48 soatdan ortiq ushlab turish mumkin emas. 29-moddaga ko'ra, ushlangan paytdan boshlab advokat yordamidan foydalanishingiz mumkin. IIO qonunining 18-moddasiga ko'ra, yaqinlaringizga qayerdaligingizni xabar qilishga haqlisiz."
  },
  {
    id: 'advokat',
    q: [
      'advokat chaqirishga haqqim bormi', 'advokatsiz gapirmayman', 'bepul advokat', 'himoyachi olsam boladimi',
      'yuridik yordam olish huquqi', 'advokat qachondan beriladi'
    ],
    a: "Konstitutsiyaning 29-moddasiga ko'ra, har kimga malakali yuridik yordam olish huquqi kafolatlanadi, qonunda nazarda tutilgan hollarda u davlat hisobidan beriladi. Ushlangan bo'lsangiz, harakat erkinligingiz cheklangan paytdan boshlab o'zingiz tanlagan advokatdan foydalanishingiz mumkin."
  },
  {
    id: 'sukut',
    q: [
      'korsatma bermasam boladimi', 'jim turishga haqqim bormi', 'oz qarindoshimga qarshi guvohlik', 'guvohlik berishga majburmanmi',
      'ozimga qarshi gapirishim shartmi', 'sukut saqlash huquqi'
    ],
    a: "Konstitutsiyaning 28-moddasiga ko'ra, hech kim o'ziga va yaqin qarindoshlariga qarshi guvohlik berishga majbur emas, gumon qilinuvchi sukut saqlash huquqidan foydalanishi mumkin."
  },
  {
    id: 'aybsizlik',
    q: [
      'aybsizlik prezumpsiyasi nima', 'sud aybdor demaguncha', 'meni aybdor deyishdi', 'kim aybdorligini kim belgilaydi',
      'hali sud bolmagan aybdormanmi'
    ],
    a: "Konstitutsiyaning 28-moddasiga ko'ra, jinoyatda ayblangan shaxs aybi sud hukmi bilan isbotlanmaguncha aybsiz hisoblanadi. Aybni faqat sud belgilaydi."
  },
  {
    id: 'voyaga-yetmagan',
    q: [
      'bolamni ushlab olishdi', 'voyaga yetmagan ushlansa', 'oglimni politsiya olib ketdi', 'qizimni bolimga olib ketishdi',
      'maktab oquvchisini ushlashsa ota onaga aytiladimi'
    ],
    a: "IIO qonunining 18-moddasiga ko'ra, voyaga yetmagan shaxs ushlansa, uning yaqin qarindoshlariga darhol xabar beriladi. Farzandingiz qaysi bo'limda ekanini 102 orqali yoki eng yaqin ichki ishlar bo'limidan bilishingiz mumkin. Advokat yordamidan foydalanish huquqi ham bor."
  },
  {
    id: 'uyga-kirish',
    q: [
      'politsiya uyimga kira oladimi', 'uyimga ruxsatsiz kirishdi', 'uyimni tintuv qilishdi', 'xonadonga kirishga haqqi bormi',
      'uy daxlsizligi', 'sud qarorisiz uyga kirish'
    ],
    a: "Konstitutsiyaning 31-moddasiga ko'ra, hech kim uy-joyga yashovchilar xohishiga qarshi kira olmaydi, tintuv faqat qonunda nazarda tutilgan hollarda va sud qarori bilan o'tkaziladi. Jinoyatni to'xtatish yoki shaxsni ushlash uchun kechiktirib bo'lmaydigan holatda xodim kirsa, IIO qonunining 16-moddasiga ko'ra bu haqda 24 soat ichida prokurorga yozma xabar beriladi."
  },

  // ---------------- Kuch ishlatish ----------------
  {
    id: 'kuch-ishlatish',
    q: [
      'politsiya kuch ishlata oladimi', 'kishan taqishga haqqi bormi', 'xodim qurol ishlatishi mumkinmi', 'rezina tayoq ishlatish',
      'qachon kuch ishlatiladi', 'maxsus vositalar qachon qollanadi', 'otish qachon mumkin'
    ],
    a: "IIO qonunining 21–24-moddalariga ko'ra, jismoniy kuch, maxsus vositalar va o'qotar qurol faqat qonunda ko'rsatilgan hollarda, imkon bo'lsa oldindan ogohlantirib, xavf darajasiga mos va zararni kamaytirgan holda qo'llanadi. Jabrlanganga birinchi yordam ko'rsatiladi, har bir holat haqida boshliqqa, zarar yetganda prokurorga darhol xabar beriladi."
  },
  {
    id: 'kuch-taqiq',
    q: [
      'homilador ayolga kuch ishlatish mumkinmi', 'bolaga kuch ishlatish mumkinmi', 'nogironga kuch ishlatish',
      'ayolga qurol ishlatish mumkinmi', 'olomonga otish mumkinmi'
    ],
    a: "IIO qonunining 22 va 24-moddalariga ko'ra, homilador ayollarga, nogironligi ko'rinib turgan shaxslarga va voyaga yetmaganlarga nisbatan kuch, o'qotar qurol esa ayollarga ham qo'llanmaydi. Faqat qurolli hujum yoki hayotga xavfli qarshilik bundan mustasno. Odam ko'p joyda begonalar jabrlanishi mumkin bo'lsa, o'qotar qurol ishlatish taqiqlanadi."
  },

  // ---------------- Shikoyat va himoya ----------------
  {
    id: 'xodim-shikoyat',
    q: [
      'politsiya xodimi ustidan shikoyat', 'xodim qopol muomala qildi', 'xodim meni haqorat qildi', 'xodim pora sorayapti',
      'noqonuniy harakat ustidan shikoyat', 'xodimdan norozi bolsam qayerga boraman', 'inspektor ustidan ariza'
    ],
    a: "Konstitutsiyaning 40 va 55-moddalariga ko'ra, mansabdor shaxslarning noqonuniy harakatlari ustidan yuqori turuvchi organga, prokuraturaga yoki sudga shikoyat qilishingiz mumkin. Xodimning familiyasi, vaqt va joyni yozib oling. Noqonuniy harakat tufayli yetgan zarar davlat tomonidan qoplanadi."
  },
  {
    id: 'xodim-urdi',
    q: [
      'xodim meni urdi', 'politsiya kaltakladi', 'qiynoqqa solishdi', 'bolimda urishdi', 'xodim zoravonlik qildi'
    ],
    a: "Konstitutsiyaning 26-moddasi va IIO qonunining 8-moddasiga ko'ra, qiynoq, zo'ravonlik va qadr-qimmatni kamsituvchi muomala qat'iyan taqiqlanadi. Darhol tibbiy ko'rikdan o'ting, jarohatlarni hujjatlashtiring va prokuraturaga yoki sudga shikoyat qiling."
  },
  {
    id: 'ariza-qabul-qilinmadi',
    q: [
      'politsiya arizamni qabul qilmadi', 'arizamni olishmadi', 'arizam natijasini qanday bilaman', 'arizamga javob berishmadi',
      'xabarimni royxatga olishmadi'
    ],
    a: "IIO qonunining 16-moddasiga ko'ra, ichki ishlar organlari jinoyat va huquqbuzarlik haqidagi ariza va xabarlarni qabul qilib ro'yxatga olishi, o'z vaqtida chora ko'rishi va natijasini arizachiga xabar qilishi shart. Qabul qilinmasa, yuqori turuvchi organga yoki prokuraturaga murojaat qiling."
  },
  {
    id: 'malumot-olish',
    q: [
      'ishim boyicha malumot olsam boladimi', 'hujjatlar bilan tanishish huquqi', 'menga tegishli materiallarni korsam boladimi',
      'xodim malumotimni tarqatdi', 'shaxsiy malumotimni oshkor qildi'
    ],
    a: "IIO qonunining 8-moddasiga ko'ra, fuqaroga o'ziga tegishli hujjat va materiallar bilan tanishish imkoniyati beriladi. Fuqaroning sha'ni, obro'si va shaxsiy hayotiga oid ma'lumotlarni qonunda nazarda tutilmagan holda oshkor qilish taqiqlanadi."
  },

  // ---------------- Xodimning majburiyat va huquqlari ----------------
  {
    id: 'xodim-majburiyat',
    q: [
      'politsiyaning majburiyatlari nima', 'xodim nimalar qilishi shart', 'politsiya burchi', 'ichki ishlar xodimining vazifalari',
      'politsiya yordam berishi shartmi', 'xodim birinchi yordam korsatadimi'
    ],
    a: "IIO qonunining 16-moddasiga ko'ra, ichki ishlar organlari fuqarolarning huquq va manfaatlarini himoya qiladi, jamoat joylarida xavfsizlikni ta'minlaydi, ariza va xabarlarni qabul qiladi, hodisa joyiga darhol yetib boradi hamda jabrlangan va nochor fuqarolarga birinchi yordam ko'rsatilishini tashkil etadi."
  },
  {
    id: 'xodim-huquq',
    q: [
      'politsiyaning huquqlari qanday', 'xodim nimalarga haqli', 'politsiya nima qila oladi', 'ichki ishlar organlarining huquqlari',
      'xodimning vakolatlari'
    ],
    a: "IIO qonunining 17-moddasiga ko'ra, ichki ishlar organlari fuqarolardan qonunga rioya qilishni va huquqbuzarlikni to'xtatishni talab qilishi, hujjatlarni tekshirishi, asos bo'lsa shaxsiy ko'rik o'tkazishi va ishlar bo'yicha ma'lumot so'rashi mumkin. Bularning hammasi faqat qonun doirasida bo'ladi."
  },
  {
    id: 'noqonuniy-buyruq',
    q: [
      'xodim noqonuniy buyruqni bajaradimi', 'boshliq buyrugi bilan noqonuniy ish', 'xizmat manfaati uchun qonunni buzish mumkinmi',
      'qonunga zid buyruq'
    ],
    a: "IIO qonunining 6-moddasiga ko'ra, noqonuniy harakatni xizmat manfaati yoki rahbar buyrug'i bilan oqlab bo'lmaydi. 34-moddaga ko'ra, xodim qonunga zid buyruqni bajarishni rad etishga haqli."
  },

  // ---------------- Fuqarolarning huquq va burchlari ----------------
  {
    id: 'fuqaro-burchlari',
    q: [
      'fuqarolarning burchlari nima', 'fuqaroning majburiyatlari', 'fuqaro burchi', 'mening burchlarim qanday',
      'har bir fuqaro nima qilishi shart'
    ],
    a: "Konstitutsiyaning 59–64-moddalariga ko'ra, fuqarolar Konstitutsiya va qonunlarga rioya qilishi, boshqalarning huquqi, sha'ni va qadr-qimmatini hurmat qilishi, tarixiy va madaniy merosni, atrof-muhitni asrashi, soliq va yig'imlarni to'lashi hamda Vatanni himoya qilishi shart."
  },
  {
    id: 'fuqaro-huquqlari',
    q: [
      'fuqarolarning huquqlari qanday', 'mening huquqlarim nima', 'asosiy huquqlarim', 'inson huquqlari', 'qanday huquqlarim bor'
    ],
    a: "Konstitutsiya har kimga yashash, shaxsiy erkinlik va daxlsizlik, sha'n va qadr-qimmat, shaxsiy hayot sirligi, erkin harakatlanish, fikr va so'z erkinligi, murojaat qilish va sud orqali himoyalanish huquqlarini kafolatlaydi. Aniq vaziyatingizni aytsangiz, batafsil tushuntiraman."
  },
  {
    id: 'tenglik',
    q: ['hamma qonun oldida tengmi', 'meni kamsitishdi', 'millatim uchun kamsitishdi', 'tenglik huquqi', 'boyga boshqa qonunmi'],
    a: "Konstitutsiyaning 19-moddasiga ko'ra, barcha fuqarolar jinsi, irqi, millati, tili, dini, e'tiqodi, ijtimoiy kelib chiqishi va mavqeidan qat'i nazar qonun oldida teng."
  },
  {
    id: 'harakat-erkinligi',
    q: ['erkin yurishga haqqim bormi', 'chet elga chiqish huquqi', 'yashash joyini tanlash', 'harakatlanish erkinligi'],
    a: "Konstitutsiyaning 32-moddasiga ko'ra, qonuniy asosda O'zbekistonda bo'lgan har kim mamlakat bo'ylab erkin harakatlanish, yashash joyini tanlash va chet elga chiqish huquqiga ega. Qonunda belgilangan cheklovlar bundan mustasno."
  },
  {
    id: 'soz-erkinligi',
    q: ['fikrimni aytishga haqqim bormi', 'soz erkinligi', 'axborot olish huquqi', 'erkin fikr bildirish'],
    a: "Konstitutsiyaning 33-moddasiga ko'ra, fikrlash, so'z va e'tiqod erkinligi hamda axborotni izlash, olish va tarqatish huquqi kafolatlanadi. Bu huquq faqat qonun bilan va qonunda ko'rsatilgan maqsadlarda cheklanishi mumkin."
  },
  {
    id: 'murojaat-huquqi',
    q: ['davlat organiga murojaat qilish huquqi', 'shikoyat yozish huquqim', 'murojaatim qancha muddatda koriladi', 'taklif yozsam boladimi'],
    a: "Konstitutsiyaning 40-moddasiga ko'ra, har kim davlat organlari va mansabdor shaxslarga ariza, taklif va shikoyat bilan murojaat qilishi mumkin. Murojaatlar qonunda belgilangan tartib va muddatlarda ko'rib chiqilishi shart."
  },

  // ---------------- Robotning o'zi ----------------
  {
    id: 'robot-tanishtir',
    q: [
      'ozingizni tanishtiring', 'guvohnomangiz bormi', 'nega menga murojaat qilyapsan', 'nima uchun meni toxtatding',
      'qaysi bolimdansiz', 'sizni kim yubordi'
    ],
    a: "Hurmatli fuqaro, men QALQON patrul robotiman, ichki ishlar organlari navbatchi qismi nazoratida ishlayman. Vazifam hududda jamoat tartibini kuzatish va fuqarolarga yordam berish. Men hech kimni ushlamayman va tintuv qilmayman, zarur bo'lsa navbatchi xodimlarni chaqiraman."
  },
  {
    id: 'robot-ushlay-olmaydi',
    q: ['meni ushlay olasanmi', 'meni tekshira olasanmi', 'sen jarima yoza olasanmi', 'sen hujjat tekshirasanmi'],
    a: "Yo'q, men robotman: hech kimni ushlamayman, tintuv qilmayman va jarima yozmayman. Bu vakolatlar faqat ichki ishlar xodimlarida. Men kuzataman, ma'lumot beraman va kerak bo'lsa navbatchi xodimni chaqiraman."
  }
];
