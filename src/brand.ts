// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Developer identity and donation channels. Payment methods are the ones zeidexsoft.com lists
// (Telegram Stars and Al-Kuraimi); no account numbers are embedded here, links lead to official pages.

export const BRAND = {
  app: "Zeidex Lexi Local",
  developer: "ZeidexSoft",
  developerUrl: "https://zeidexlink.zeidexsoft.com/zeidex",
  website: "https://zeidexsoft.com",
  repo: "https://github.com/zeiad6/zeidex-lexi-local",
  email: "info@zeidexsoft.com",
  license: "PolyForm Noncommercial 1.0.0",
  donate: [
    {
      id: "stars",
      icon: "⭐",
      label: { ar: "نجوم تيليجرام", en: "Telegram Stars" },
      desc: { ar: "ادعم المشروع بالنجوم عبر متجر ZeidexSoft", en: "Support the project with Stars via the ZeidexSoft store" },
      url: "https://zeidexsoft.com/store/",
    },
    {
      id: "kuraimi",
      icon: "🏦",
      label: { ar: "الكريمي", en: "Al-Kuraimi transfer" },
      desc: { ar: "تواصل عبر واتساب لاستلام بيانات التحويل", en: "Message on WhatsApp to receive the transfer details" },
      url: "https://wa.me/qr/2EZCWPVVO3DUE1?s=v",
    },
    {
      id: "email",
      icon: "✉️",
      label: { ar: "البريد الإلكتروني", en: "Email" },
      desc: { ar: "للرعاية أو الترخيص التجاري", en: "Sponsorship or a commercial license" },
      url: "mailto:info@zeidexsoft.com?subject=Zeidex%20Lexi%20Local",
    },
  ],
} as const;
