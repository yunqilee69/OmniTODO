import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Default zh-CN with an en fallback (design §3).
const resources = {
  "zh-CN": {
    translation: {
      inbox: "收件箱",
      today: "今天",
      upcoming: "即将到来",
      settings: "设置",
    },
  },
  en: {
    translation: {
      inbox: "Inbox",
      today: "Today",
      upcoming: "Upcoming",
      settings: "Settings",
    },
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: "zh-CN",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
