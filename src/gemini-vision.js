/**
 * Moon OCR Reader — Gemini Vision Service
 * Dual-path complementary OCR: Tesseract (precision) + Gemini Vision (context)
 */
import { GoogleGenAI } from '@google/genai';

const ENV_API_KEY = process.env.GEMINI_API_KEY;
const STORAGE_KEY = 'moon-ocr-gemini-api-key';
let ai = null;
let cachedKey = null;

/**
 * Get the active API key (localStorage first, then .env.local fallback)
 */
export function getApiKey() {
  const localKey = localStorage.getItem(STORAGE_KEY);
  if (localKey && localKey.trim().length > 0) return localKey.trim();
  if (ENV_API_KEY && ENV_API_KEY !== 'YOUR_API_KEY_HERE') return ENV_API_KEY;
  return null;
}

/**
 * Save a user-provided API key to localStorage
 */
export function setApiKey(key) {
  localStorage.setItem(STORAGE_KEY, key.trim());
  ai = null; // reset client so it picks up the new key
  cachedKey = null;
}

/**
 * Delete the stored API key
 */
export function clearApiKey() {
  localStorage.removeItem(STORAGE_KEY);
  ai = null;
  cachedKey = null;
}

function getAI() {
  const key = getApiKey();
  if (!key) return null;
  if (key !== cachedKey) {
    ai = new GoogleGenAI({ apiKey: key });
    cachedKey = key;
  }
  return ai;
}

/**
 * Check if Gemini API is available
 */
export function isGeminiAvailable() {
  return !!getApiKey();
}

/**
 * Convert a File to base64 inlineData for Gemini
 */
async function fileToInlineData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
      if (match) {
        let mimeType = match[1];
        if (mimeType === 'application/octet-stream') mimeType = 'image/jpeg';
        resolve({ mimeType, data: match[2] });
      } else {
        reject(new Error('Failed to convert file to base64'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Path B: Gemini Vision — directly read text from image using multimodal
 * @param {File} imageFile - Original image file
 * @param {string} lang - Language hint (e.g. 'kor', 'eng', 'eng+kor')
 * @returns {Promise<string>} - Vision-extracted text
 */
export async function geminiVisionRead(imageFile, lang = 'kor') {
  const client = getAI();
  if (!client) throw new Error('Gemini API not configured');

  const inlineData = await fileToInlineData(imageFile);
  
  const langHint = lang.includes('kor') ? '한국어' : 
                   lang.includes('jpn') ? '日本語' :
                   lang.includes('chi') ? '中文' : 'English';

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{
      role: 'user',
      parts: [
        {
          text: `이 이미지에서 텍스트를 정확하게 읽어주세요.

규칙:
- 이미지에 보이는 텍스트만 추출하세요
- 원본의 줄바꿈과 단락 구조를 최대한 유지하세요
- 표, 목록 등의 구조가 있으면 보존하세요
- 텍스트가 아닌 설명이나 해석은 추가하지 마세요
- 주 언어: ${langHint}

이미지의 텍스트를 그대로 출력하세요:`
        },
        {
          inlineData: {
            mimeType: inlineData.mimeType,
            data: inlineData.data,
          }
        }
      ]
    }]
  });

  return response.text?.trim() || '';
}

/**
 * Merge Step: Reconcile OCR + Vision results using Gemini
 * @param {string} ocrText - Tesseract.js OCR result
 * @param {string} visionText - Gemini Vision result
 * @param {string} lang - Language hint
 * @returns {Promise<string>} - Merged, refined text
 */
export async function geminiMergeResults(ocrText, visionText, lang = 'kor') {
  const client = getAI();
  if (!client) throw new Error('Gemini API not configured');

  const langHint = lang.includes('kor') ? '한국어' : 
                   lang.includes('jpn') ? '日本語' :
                   lang.includes('chi') ? '中文' : 'English';

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{
      role: 'user',
      parts: [{
        text: `당신은 OCR 텍스트 교정 전문가입니다. 같은 이미지를 두 가지 방법으로 인식한 결과가 있습니다.

## OCR 엔진 결과 (Tesseract — 글자 단위 정밀 인식):
\`\`\`
${ocrText}
\`\`\`

## AI Vision 결과 (Gemini — 문맥 기반 멀티모달 인식):
\`\`\`
${visionText}
\`\`\`

## 병합 규칙:
1. 두 결과를 교차 검증하여 가장 정확한 최종 텍스트를 만드세요
2. OCR이 글자를 놓치거나 오인식한 부분은 Vision 결과로 보완하세요
3. Vision이 문맥상 추측한 부분은 OCR의 정확한 글자 인식으로 검증하세요
4. 원본의 줄바꿈, 단락, 구조를 유지하세요
5. 주 언어: ${langHint}
6. 병합된 텍스트만 출력하세요 — 설명, 주석, 마크다운 코드블록 래핑 없이 순수 텍스트만

병합된 최종 텍스트:`
      }]
    }]
  });

  return response.text?.trim() || ocrText;
}
