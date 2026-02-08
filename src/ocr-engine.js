/**
 * Moon OCR Engine
 * Wraps Tesseract.js for multi-language OCR with progress callbacks
 */
import Tesseract from 'tesseract.js';

class OcrEngine {
  constructor() {
    this.scheduler = null;
    this.isReady = false;
    this.currentLang = 'kor';
    this.workerCount = navigator.hardwareConcurrency ? Math.min(navigator.hardwareConcurrency, 4) : 2;
  }

  /**
   * Initialize the OCR engine with the specified language
   * @param {string} lang - Language code (e.g., 'eng', 'kor', 'eng+kor')
   * @param {Function} onProgress - Progress callback (0-1)
   */
  async initialize(lang = 'kor', onProgress = () => {}) {
    // If already initialized with the same language, reuse
    if (this.isReady && this.currentLang === lang) {
      return;
    }

    // Terminate any existing scheduler
    await this.terminate();

    this.currentLang = lang;
    
    onProgress(0, '엔진 초기화 중...');
    
    this.scheduler = Tesseract.createScheduler();

    // Create workers
    const workerCount = lang.includes('+') ? Math.min(this.workerCount, 2) : Math.min(this.workerCount, 4);
    
    for (let i = 0; i < workerCount; i++) {
      onProgress((i + 1) / (workerCount + 1), `언어 모델 로딩 중 (${i + 1}/${workerCount})...`);
      
      const worker = await Tesseract.createWorker(lang, 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            // We'll handle this per-image in recognizeImage
          }
        },
      });
      
      this.scheduler.addWorker(worker);
    }

    this.isReady = true;
    onProgress(1, '엔진 준비 완료');
  }

  /**
   * Recognize text from a single image
   * @param {File|Blob|string} image - Image source
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<{text: string, confidence: number, blocks: Array}>}
   */
  async recognizeImage(image, onProgress = () => {}) {
    if (!this.isReady || !this.scheduler) {
      throw new Error('OCR 엔진이 초기화되지 않았습니다. initialize()를 먼저 호출하세요.');
    }

    const result = await this.scheduler.addJob('recognize', image);

    const text = result.data.text.trim();
    const confidence = result.data.confidence;
    const blocks = result.data.blocks || [];
    
    // Extract structured data
    const lines = (result.data.lines || []).map(l => ({
      text: l.text.trim(),
      confidence: l.confidence,
      bbox: l.bbox,
    })).filter(l => l.text.length > 0);

    const words = (result.data.words || []).length;
    const paragraphs = (result.data.paragraphs || []).length;

    return {
      text,
      confidence,
      lines,
      words,
      paragraphs,
      blocks,
    };
  }

  /**
   * Batch recognize multiple images
   * @param {Array<{file: File, id: string}>} images
   * @param {Function} onImageStart - Called when starting each image
   * @param {Function} onImageComplete - Called when each image is done
   * @param {Function} onProgress - Overall progress
   * @returns {Promise<Array>}
   */
  async recognizeBatch(images, onImageStart = () => {}, onImageComplete = () => {}, onProgress = () => {}) {
    const total = images.length;
    let completed = 0;

    // Submit all jobs to the scheduler simultaneously for parallel processing.
    // The scheduler automatically distributes work across available workers.
    const promises = images.map(({ file, id }, i) => {
      onImageStart(id, i, total);

      return this.recognizeImage(file)
        .then(result => {
          completed++;
          onProgress(completed / total, `이미지 ${completed}/${total} 완료`);
          onImageComplete(id, result, i, total);
          return { id, filename: file.name, ...result, error: null };
        })
        .catch(err => {
          completed++;
          onProgress(completed / total, `이미지 ${completed}/${total} 완료`);
          onImageComplete(id, null, i, total);
          return { id, filename: file.name, text: '', confidence: 0, error: err.message };
        });
    });

    return Promise.all(promises);
  }

  /**
   * Terminate all workers and cleanup
   */
  async terminate() {
    if (this.scheduler) {
      await this.scheduler.terminate();
      this.scheduler = null;
    }
    this.isReady = false;
  }
}

// Singleton export
export const ocrEngine = new OcrEngine();
export default ocrEngine;
