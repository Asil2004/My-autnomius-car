import '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

// COCO-SSD loyiha ichidan (public/models/coco-ssd) yuklanadi: internetsiz ham ishlaydi, APK ichida ham.
// Promise keshlanadi, shunda qayta chaqirilsa (StrictMode, HUD qayta ochilishi) model ikki marta yuklanmaydi.
//
// ESLATMA: modellarni login oynasida OLDINDAN yuklab bo'lmaydi: WebGL shaderlarini birinchi kompilyatsiya qilish
// asosiy oqimni 10+ soniya bloklaydi (sinovda 14 s + 9 s + 4 s), sahifa qotib qoladi. Haqiqiy yechim: AI'ni Web Worker'ga ko'chirish.
let cocoModelPromise: Promise<cocoSsd.ObjectDetection> | null = null;

export const loadCocoModel = (): Promise<cocoSsd.ObjectDetection> => {
  if (!cocoModelPromise) {
    cocoModelPromise = cocoSsd
      .load({ base: 'lite_mobilenet_v2', modelUrl: `${import.meta.env.BASE_URL}models/coco-ssd/model.json` })
      .catch((err) => {
        cocoModelPromise = null;
        throw err;
      });
  }
  return cocoModelPromise;
};
