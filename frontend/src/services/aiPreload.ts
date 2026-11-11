import type * as cocoSsd from '@tensorflow-models/coco-ssd';

// COCO-SSD loyiha ichidan (public/models/coco-ssd) yuklanadi: internetsiz ham ishlaydi.
// TensorFlow va COCO kodi faqat shu funksiya birinchi chaqirilganda yuklanadi (asosiy JS fayl yengil).
// Promise keshlanadi, shunda qayta chaqirilsa (StrictMode, HUD qayta ochilishi) model ikki marta yuklanmaydi.
//
// ESLATMA: modellarni login oynasida OLDINDAN yuklab bo'lmaydi: WebGL shaderlarini birinchi kompilyatsiya qilish
// asosiy oqimni 10+ soniya bloklaydi (sinovda 14 s + 9 s + 4 s), sahifa qotib qoladi. Haqiqiy yechim: AI'ni Web Worker'ga ko'chirish.
let cocoModelPromise: Promise<cocoSsd.ObjectDetection> | null = null;

export const loadCocoModel = (): Promise<cocoSsd.ObjectDetection> => {
  if (!cocoModelPromise) {
    cocoModelPromise = Promise.all([import('@tensorflow/tfjs'), import('@tensorflow-models/coco-ssd')])
      .then(([, coco]) =>
        coco
          .load({ base: 'lite_mobilenet_v2', modelUrl: `${import.meta.env.BASE_URL}models/coco-ssd/model.json` })
          .catch((localErr) => {
            // Lokal fayl topilmasa, standart manzildan (internet orqali) yuklashga urinamiz
            console.warn('[AI] Lokal COCO-SSD topilmadi, tarmoq orqali yuklanadi:', localErr);
            return coco.load({ base: 'lite_mobilenet_v2' });
          })
      )
      .catch((err) => {
        cocoModelPromise = null;
        throw err;
      });
  }
  return cocoModelPromise;
};
