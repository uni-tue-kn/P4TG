import DE from "./languages/DE.json";
import EN from "./languages/EN.json";
import { userLangToTranslateCode } from "./LanguageSelector";

type LanguageTranslations = {
  [key: string]: string | LanguageTranslations;
};

const languages: { [key: string]: LanguageTranslations } = {
  DE,
  EN,
};

const userLang = navigator.language;

const translate = (
  key: string,
  language: string = userLangToTranslateCode(
    localStorage.getItem("language") ?? userLang
  )
): string => {
  const langCode = userLangToTranslateCode(language);

  // Überprüfen, ob die Sprache unterstützt wird
  if (!languages[langCode]) {
    return key; // Rückgabe des Schlüssels, wenn die Sprache nicht unterstützt wird
  }

  const keys = key.split(".");
  let translation: any = languages[langCode];

  for (const k of keys) {
    const foundKey = Object.keys(translation).find(
      (t) => t.toLowerCase() === k.toLowerCase()
    );

    if (foundKey !== undefined) {
      translation = translation[foundKey];
    } else {
      return key; // Rückgabe des Schlüssels, wenn der entsprechende Schlüssel nicht gefunden wird
    }
  }

  return typeof translation === "string" ? translation : key;
};

export default translate;
