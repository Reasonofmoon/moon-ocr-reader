/**
 * Moon OCR Reader — Main Application
 */
import './style.css';
import { ocrEngine } from './ocr-engine.js';
import { resizeForOcr, getFileHash } from './image-utils.js';
import { isGeminiAvailable, geminiVisionRead, geminiMergeResults, setApiKey, clearApiKey, getApiKey } from './gemini-vision.js';

// ============================================
// State
// ============================================
const state = {
  images: [], // { id, file, url, name }
  results: [], // { id, filename, text, confidence, ... }
  isProcessing: false,
  aiEnabled: false, // Gemini dual-path toggle
};

let imageIdCounter = 0;
const resultCache = new Map(); // SHA-256 hash -> OCR result

// ============================================
// DOM Refs
// ============================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  dropZone: $('#drop-zone'),
  fileInput: $('#file-input'),
  langSelect: $('#language-select'),
  previewSection: $('#preview-section'),
  imageCount: $('#image-count'),
  imageGallery: $('#image-gallery'),
  btnClearAll: $('#btn-clear-all'),
  btnStartOcr: $('#btn-start-ocr'),
  progressSection: $('#progress-section'),
  progressBar: $('#progress-bar'),
  progressStatus: $('#progress-status'),
  progressDetail: $('#progress-detail'),
  resultsSection: $('#results-section'),
  resultsContainer: $('#results-container'),
  btnCopyAll: $('#btn-copy-all'),
  btnDownloadTxt: $('#btn-download-txt'),
  btnDownloadMd: $('#btn-download-md'),
  toastContainer: $('#toast-container'),
  aiToggle: $('#ai-toggle'),
  aiStatus: $('#ai-status'),
  btnAiSettings: $('#btn-ai-settings'),
  apiKeyModal: $('#api-key-modal'),
  apiKeyInput: $('#api-key-input'),
  btnSaveKey: $('#btn-save-key'),
  btnDeleteKey: $('#btn-delete-key'),
  btnModalClose: $('#btn-modal-close'),
  btnToggleKeyVis: $('#btn-toggle-key-visibility'),
};

// ============================================
// Toast Notification
// ============================================
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  dom.toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease-out forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================
// Image Management
// ============================================
function addImages(files) {
  const validTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/gif', 'image/tiff'];
  
  for (const file of files) {
    if (!validTypes.includes(file.type)) {
      showToast(`지원하지 않는 형식: ${file.name}`, 'error');
      continue;
    }
    
    const id = `img-${++imageIdCounter}`;
    const url = URL.createObjectURL(file);
    state.images.push({ id, file, url, name: file.name });
  }
  
  renderGallery();
  
  if (state.images.length > 0) {
    dom.previewSection.classList.remove('hidden');
    showToast(`${files.length}개 이미지가 추가되었습니다`);
  }
}

function removeImage(id) {
  const idx = state.images.findIndex(img => img.id === id);
  if (idx !== -1) {
    URL.revokeObjectURL(state.images[idx].url);
    state.images.splice(idx, 1);
  }
  
  renderGallery();
  
  if (state.images.length === 0) {
    dom.previewSection.classList.add('hidden');
  }
}

function clearAllImages() {
  state.images.forEach(img => URL.revokeObjectURL(img.url));
  state.images = [];
  renderGallery();
  dom.previewSection.classList.add('hidden');
  dom.resultsSection.classList.add('hidden');
  state.results = [];
}

function renderGallery() {
  dom.imageCount.textContent = state.images.length;
  dom.imageGallery.innerHTML = state.images.map(img => `
    <div class="image-card" data-id="${img.id}" id="card-${img.id}">
      <img src="${img.url}" alt="${img.name}" loading="lazy" />
      <div class="card-overlay">
        <span class="card-filename">${img.name}</span>
        <button class="card-remove" data-remove="${img.id}" title="삭제">✕</button>
      </div>
    </div>
  `).join('');
  
  // Bind remove buttons
  dom.imageGallery.querySelectorAll('.card-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeImage(btn.dataset.remove);
    });
  });
}

// ============================================
// OCR Processing
// ============================================
async function startOcr() {
  if (state.images.length === 0 || state.isProcessing) return;
  
  state.isProcessing = true;
  state.results = [];
  
  dom.btnStartOcr.disabled = true;
  dom.progressSection.classList.remove('hidden');
  dom.resultsSection.classList.remove('hidden');
  dom.resultsContainer.innerHTML = '';
  
  const lang = dom.langSelect.value;
  const useAI = state.aiEnabled && isGeminiAvailable();
  
  try {
    // Phase 1: Initialize Tesseract engine
    updateProgress(0, 'OCR 엔진 초기화 중...', 'Tesseract.js 워커를 생성합니다');
    
    await ocrEngine.initialize(lang, (progress, message) => {
      updateProgress(progress * 0.1, message, '언어 모델을 다운로드하고 있습니다 (최초 1회)');
    });
    
    // Phase 2: Pre-resize images and check cache
    updateProgress(0.1, '이미지 전처리 중...', '고해상도 이미지를 최적화합니다');
    
    const imagesToProcess = [];
    const cachedResults = [];
    
    for (const img of state.images) {
      const hash = await getFileHash(img.file);
      const cacheKey = `${hash}_${lang}_${useAI ? 'ai' : 'ocr'}`;
      
      if (resultCache.has(cacheKey)) {
        const cached = resultCache.get(cacheKey);
        cachedResults.push({ ...cached, id: img.id, filename: img.file.name });
      } else {
        const resizedFile = await resizeForOcr(img.file);
        imagesToProcess.push({ file: resizedFile, id: img.id, originalFile: img.file, hash, cacheKey });
      }
    }
    
    // Render cached results immediately
    for (const cached of cachedResults) {
      state.results.push(cached);
      appendSingleResult(cached);
      const card = document.getElementById(`card-${cached.id}`);
      if (card) {
        card.classList.add('done');
        card.insertAdjacentHTML('afterbegin', `<div class="card-status-badge done">✓</div>`);
      }
    }
    
    if (cachedResults.length > 0) {
      showToast(`${cachedResults.length}개 이미지 캐시 적중 ⚡`);
    }
    
    updateProgress(0.15, '텍스트 추출 시작...', `${imagesToProcess.length}개 이미지 처리 예정`);
    
    if (imagesToProcess.length > 0) {
      // ── Phase 3: Dual-Path Processing ──────────────────
      // Path A (Tesseract OCR) runs in parallel batch.
      // Path B (Gemini Vision) fires per-image concurrently.
      // Results merge after both complete for each image.
      
      // Kick off Gemini Vision for all images in parallel (non-blocking)
      const visionPromises = new Map(); // id -> Promise<string>
      if (useAI) {
        for (const imgData of imagesToProcess) {
          visionPromises.set(
            imgData.id,
            geminiVisionRead(imgData.originalFile, lang).catch(err => {
              console.warn(`Vision read failed for ${imgData.id}:`, err);
              return ''; // graceful fallback
            })
          );
        }
      }
      
      // Run Tesseract OCR batch (parallel workers)
      const results = await ocrEngine.recognizeBatch(
        imagesToProcess.map(img => ({ file: img.file, id: img.id })),
        // onImageStart
        (id, idx, total) => {
          const card = document.getElementById(`card-${id}`);
          if (card) {
            card.classList.add('processing');
            card.insertAdjacentHTML('afterbegin', `<div class="card-status-badge processing">⏳</div>`);
          }
        },
        // onImageComplete — show OCR result immediately, then refine in background
        (id, result, idx, total) => {
          const card = document.getElementById(`card-${id}`);
          if (card) {
            card.classList.remove('processing');
            card.classList.add('done');
            const badge = card.querySelector('.card-status-badge');
            if (badge) {
              badge.classList.remove('processing');
              badge.classList.add('done');
              badge.textContent = '✓';
            }
          }
          
          if (result) {
            const imgMeta = imagesToProcess.find(i => i.id === id);
            const resultEntry = {
              id,
              filename: imgMeta?.originalFile?.name || 'unknown',
              ...result,
              error: null,
              ocrText: result.text, // preserve original OCR
              visionText: null,     // will be filled by AI
              mergedText: null,     // will be filled by merge
              aiStatus: useAI ? 'pending' : 'disabled',
            };
            state.results.push(resultEntry);
            appendSingleResult(resultEntry);
            
            // ── Background: AI Vision merge ──
            if (useAI && visionPromises.has(id)) {
              refineSingleResult(resultEntry, visionPromises.get(id), lang, imgMeta?.cacheKey);
            } else if (imgMeta) {
              resultCache.set(imgMeta.cacheKey, { text: result.text, confidence: result.confidence, lines: result.lines, words: result.words, paragraphs: result.paragraphs, blocks: result.blocks });
            }
          }
        },
        // onProgress
        (progress, message) => {
          updateProgress(0.15 + progress * 0.75, message, `${lang} 모델로 텍스트를 추출하는 중`);
        },
      );
    }
    
    dom.progressSection.classList.add('hidden');
    
    const totalChars = state.results.reduce((sum, r) => sum + (r.text?.length || 0), 0);
    showToast(`${state.results.length}개 이미지에서 ${totalChars.toLocaleString()}자 추출 완료${useAI ? ' · AI 보정 진행 중...' : ''}`);
    
  } catch (err) {
    console.error('OCR Error:', err);
    showToast(`오류 발생: ${err.message}`, 'error');
    dom.progressSection.classList.add('hidden');
  } finally {
    state.isProcessing = false;
    dom.btnStartOcr.disabled = false;
  }
}

/**
 * Background dual-path refinement for a single image.
 * Waits for Gemini Vision result, then merges with OCR.
 */
async function refineSingleResult(resultEntry, visionPromise, lang, cacheKey) {
  const resultCard = dom.resultsContainer.querySelector(`[data-result-id="${resultEntry.id}"]`);
  
  try {
    // Show AI refining indicator
    if (resultCard) {
      const body = resultCard.querySelector('.result-card-body');
      body?.insertAdjacentHTML('afterbegin', `
        <div class="ai-refine-banner" id="ai-banner-${resultEntry.id}">
          <div class="ai-refine-spinner"></div>
          <span>🤖 AI Vision 분석 + 교차 검증 중...</span>
        </div>
      `);
    }
    
    // Wait for Gemini Vision result
    const visionText = await visionPromise;
    resultEntry.visionText = visionText;
    
    if (visionText && resultEntry.ocrText) {
      // Merge OCR + Vision via Gemini
      const banner = document.getElementById(`ai-banner-${resultEntry.id}`);
      if (banner) banner.querySelector('span').textContent = '🔀 OCR + Vision 병합 중...';
      
      const mergedText = await geminiMergeResults(resultEntry.ocrText, visionText, lang);
      resultEntry.mergedText = mergedText;
      resultEntry.text = mergedText; // update main text to merged version
      resultEntry.aiStatus = 'done';
      
      // Update the result card in-place
      updateResultCardWithAI(resultEntry);
      
      // Cache the merged result
      if (cacheKey) {
        resultCache.set(cacheKey, {
          text: mergedText,
          ocrText: resultEntry.ocrText,
          visionText: visionText,
          mergedText: mergedText,
          confidence: resultEntry.confidence,
          lines: resultEntry.lines,
          words: resultEntry.words,
          paragraphs: resultEntry.paragraphs,
          blocks: resultEntry.blocks,
          aiStatus: 'done',
        });
      }
      
      showToast(`${resultEntry.filename} AI 보정 완료 ✨`);
    } else if (visionText && !resultEntry.ocrText) {
      // OCR failed but Vision succeeded — use vision text
      resultEntry.text = visionText;
      resultEntry.mergedText = visionText;
      resultEntry.aiStatus = 'done';
      updateResultCardWithAI(resultEntry);
    } else {
      // Vision failed — keep OCR result
      resultEntry.aiStatus = 'failed';
      const banner = document.getElementById(`ai-banner-${resultEntry.id}`);
      if (banner) {
        banner.innerHTML = '<span>⚠️ AI Vision 응답 없음 — OCR 결과 유지</span>';
        banner.classList.add('ai-refine-failed');
      }
    }
  } catch (err) {
    console.warn(`AI refinement failed for ${resultEntry.id}:`, err);
    resultEntry.aiStatus = 'failed';
    const banner = document.getElementById(`ai-banner-${resultEntry.id}`);
    if (banner) {
      banner.innerHTML = `<span>⚠️ AI 보정 실패 — OCR 결과 유지</span>`;
      banner.classList.add('ai-refine-failed');
    }
  }
}

/**
 * Update an existing result card with AI-merged text and dual-source view
 */
function updateResultCardWithAI(resultEntry) {
  const resultCard = dom.resultsContainer.querySelector(`[data-result-id="${resultEntry.id}"]`);
  if (!resultCard) return;
  
  const body = resultCard.querySelector('.result-card-body');
  if (!body) return;
  
  const hasText = resultEntry.text && resultEntry.text.length > 0;
  
  body.innerHTML = hasText ? `
    <div class="ai-result-badge">✨ AI 보정 완료</div>
    <div class="result-text">${escapeHtml(resultEntry.text)}</div>
    <details class="dual-source-details">
      <summary>🔍 원본 비교 (OCR vs Vision)</summary>
      <div class="dual-source-grid">
        <div class="dual-source-col">
          <div class="dual-source-label">📝 Tesseract OCR</div>
          <div class="dual-source-text">${escapeHtml(resultEntry.ocrText || '')}</div>
        </div>
        <div class="dual-source-col">
          <div class="dual-source-label">🤖 Gemini Vision</div>
          <div class="dual-source-text">${escapeHtml(resultEntry.visionText || '')}</div>
        </div>
      </div>
    </details>
    <div class="result-meta">
      <div class="meta-item"><div class="meta-dot meta-dot-ai"></div>AI 보정됨</div>
      <div class="meta-item"><div class="meta-dot"></div>OCR 신뢰도: ${resultEntry.confidence?.toFixed(1) || 0}%</div>
      <div class="meta-item"><div class="meta-dot"></div>글자: ${resultEntry.text.length.toLocaleString()}자</div>
    </div>
  ` : `
    <div class="result-empty">텍스트를 감지하지 못했습니다</div>
  `;
  
  // Re-bind copy button to use merged text
  const copyBtn = resultCard.querySelector('[data-copy-id]');
  if (copyBtn) {
    const newBtn = copyBtn.cloneNode(true);
    copyBtn.parentNode.replaceChild(newBtn, copyBtn);
    newBtn.addEventListener('click', () => {
      if (resultEntry.text) {
        navigator.clipboard.writeText(resultEntry.text).then(() => {
          showToast('AI 보정 텍스트가 복사되었습니다');
        });
      }
    });
  }
}

function updateProgress(progress, status, detail) {
  const pct = Math.min(Math.max(progress * 100, 0), 100);
  dom.progressBar.style.width = `${pct}%`;
  dom.progressStatus.textContent = status;
  dom.progressDetail.textContent = detail;
}

// ============================================
// Results Rendering
// ============================================
function renderResults() {
  dom.resultsContainer.innerHTML = state.results.map((result, idx) => {
    const img = state.images.find(i => i.id === result.id);
    const thumbUrl = img ? img.url : '';
    const hasText = result.text && result.text.length > 0;
    
    return `
      <div class="result-card" data-result-id="${result.id}">
        <div class="result-card-header">
          <div class="result-card-title">
            ${thumbUrl ? `<img src="${thumbUrl}" alt="" />` : ''}
            <span>${result.filename}</span>
          </div>
          <div class="result-card-actions">
            <button class="btn-icon" title="텍스트 복사" data-copy-id="${result.id}">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="5.333" y="5.333" width="9.333" height="9.333" rx="1.333" stroke="currentColor" stroke-width="1.5"/><path d="M3.333 10.667H2.667A1.333 1.333 0 011.333 9.333V2.667A1.333 1.333 0 012.667 1.333h6.666A1.333 1.333 0 0110.667 2.667v.666" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
          </div>
        </div>
        <div class="result-card-body">
          ${hasText ? `
            <div class="result-text">${escapeHtml(result.text)}</div>
            <div class="result-meta">
              <div class="meta-item"><div class="meta-dot"></div>신뢰도: ${result.confidence.toFixed(1)}%</div>
              <div class="meta-item"><div class="meta-dot"></div>단어: ${result.words || 0}개</div>
              <div class="meta-item"><div class="meta-dot"></div>글자: ${result.text.length.toLocaleString()}자</div>
            </div>
          ` : `
            <div class="result-empty">텍스트를 감지하지 못했습니다</div>
          `}
        </div>
      </div>
    `;
  }).join('');
  
  // Bind copy buttons
  dom.resultsContainer.querySelectorAll('[data-copy-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const resultId = btn.dataset.copyId;
      const result = state.results.find(r => r.id === resultId);
      if (result && result.text) {
        navigator.clipboard.writeText(result.text).then(() => {
          showToast('클립보드에 복사되었습니다');
        });
      }
    });
  });
}

/**
 * Append a single result card to the DOM in real-time (streaming pattern).
 * Shows OCR result immediately; AI refinement updates the card in-place later.
 */
function appendSingleResult(result) {
  const img = state.images.find(i => i.id === result.id);
  const thumbUrl = img ? img.url : '';
  const hasText = result.text && result.text.length > 0;
  const isAIPending = result.aiStatus === 'pending';
  
  const cardHtml = `
    <div class="result-card ${isAIPending ? 'ai-pending' : ''}" data-result-id="${result.id}">
      <div class="result-card-header">
        <div class="result-card-title">
          ${thumbUrl ? `<img src="${thumbUrl}" alt="" />` : ''}
          <span>${result.filename}</span>
          ${isAIPending ? '<span class="ai-label">🤖 AI 대기</span>' : ''}
        </div>
        <div class="result-card-actions">
          <button class="btn-icon" title="텍스트 복사" data-copy-id="${result.id}">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="5.333" y="5.333" width="9.333" height="9.333" rx="1.333" stroke="currentColor" stroke-width="1.5"/><path d="M3.333 10.667H2.667A1.333 1.333 0 011.333 9.333V2.667A1.333 1.333 0 012.667 1.333h6.666A1.333 1.333 0 0110.667 2.667v.666" stroke="currentColor" stroke-width="1.5"/></svg>
          </button>
        </div>
      </div>
      <div class="result-card-body">
        ${hasText ? `
          <div class="result-text">${escapeHtml(result.text)}</div>
          <div class="result-meta">
            <div class="meta-item"><div class="meta-dot"></div>신뢰도: ${result.confidence?.toFixed(1) || 0}%</div>
            <div class="meta-item"><div class="meta-dot"></div>단어: ${result.words || 0}개</div>
            <div class="meta-item"><div class="meta-dot"></div>글자: ${result.text.length.toLocaleString()}자</div>
          </div>
        ` : `
          <div class="result-empty">텍스트를 감지하지 못했습니다</div>
        `}
      </div>
    </div>
  `;
  
  dom.resultsContainer.insertAdjacentHTML('beforeend', cardHtml);
  
  // Bind the copy button
  const newCard = dom.resultsContainer.querySelector(`[data-result-id="${result.id}"] [data-copy-id]`);
  if (newCard) {
    newCard.addEventListener('click', () => {
      // Always copy the latest text (which may have been AI-merged)
      const current = state.results.find(r => r.id === result.id);
      const textToCopy = current?.text || result.text;
      if (textToCopy) {
        navigator.clipboard.writeText(textToCopy).then(() => {
          showToast('클립보드에 복사되었습니다');
        });
      }
    });
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================
// Export Functions
// ============================================
function getAllText() {
  return state.results
    .filter(r => r.text)
    .map((r, i) => {
      const header = `=== ${r.filename} ===`;
      return `${header}\n${r.text}`;
    })
    .join('\n\n');
}

function getAllTextMarkdown() {
  return state.results
    .filter(r => r.text)
    .map((r, i) => {
      return `## ${r.filename}\n\n> 신뢰도: ${r.confidence.toFixed(1)}% | 단어: ${r.words || 0}개 | 글자: ${r.text.length.toLocaleString()}자\n\n${r.text}`;
    })
    .join('\n\n---\n\n');
}

function copyAllText() {
  const text = getAllText();
  if (!text) {
    showToast('복사할 텍스트가 없습니다', 'error');
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    showToast('전체 텍스트가 복사되었습니다');
  });
}

function downloadFile(content, filename, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`${filename} 다운로드 완료`);
}

function downloadTxt() {
  const text = getAllText();
  if (!text) { showToast('다운로드할 텍스트가 없습니다', 'error'); return; }
  const timestamp = new Date().toISOString().slice(0, 10);
  downloadFile(text, `moon-ocr-${timestamp}.txt`);
}

function downloadMd() {
  const md = `# Moon OCR Reader — 텍스트 추출 결과\n\n> 추출일: ${new Date().toLocaleString('ko-KR')}\n\n${getAllTextMarkdown()}`;
  if (!getAllTextMarkdown()) { showToast('다운로드할 텍스트가 없습니다', 'error'); return; }
  const timestamp = new Date().toISOString().slice(0, 10);
  downloadFile(md, `moon-ocr-${timestamp}.md`);
}

// ============================================
// Event Handlers
// ============================================
function setupEventListeners() {
  // Drop zone — click
  dom.dropZone.addEventListener('click', () => {
    dom.fileInput.click();
  });
  
  // File input change
  dom.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      addImages(Array.from(e.target.files));
      e.target.value = ''; // Reset for re-upload
    }
  });
  
  // Drag and drop
  dom.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dom.dropZone.classList.add('drag-over');
  });
  
  dom.dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dom.dropZone.classList.remove('drag-over');
  });
  
  dom.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dom.dropZone.classList.remove('drag-over');
    
    if (e.dataTransfer.files.length > 0) {
      addImages(Array.from(e.dataTransfer.files));
    }
  });
  
  // Paste from clipboard
  document.addEventListener('paste', (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    
    if (imageItems.length > 0) {
      e.preventDefault();
      const files = imageItems.map((item, i) => {
        const file = item.getAsFile();
        // Give pasted images a name
        const ext = file.type.split('/')[1] || 'png';
        return new File([file], `clipboard-${Date.now()}-${i}.${ext}`, { type: file.type });
      });
      addImages(files);
    }
  });
  
  // Buttons
  dom.btnClearAll.addEventListener('click', clearAllImages);
  dom.btnStartOcr.addEventListener('click', startOcr);
  dom.btnCopyAll.addEventListener('click', copyAllText);
  dom.btnDownloadTxt.addEventListener('click', downloadTxt);
  dom.btnDownloadMd.addEventListener('click', downloadMd);
}

// ============================================
// Initialize
// ============================================
function updateAIStatus() {
  const ready = isGeminiAvailable();
  if (dom.aiStatus) {
    dom.aiStatus.classList.remove('ai-ready', 'ai-not-ready');
    dom.aiStatus.classList.add(ready ? 'ai-ready' : 'ai-not-ready');
    dom.aiStatus.title = ready ? 'Gemini API 연결됨' : 'API 키 미설정';
  }
  return ready;
}

function init() {
  setupEventListeners();
  
  // AI toggle
  const geminiReady = updateAIStatus();
  if (dom.aiToggle) {
    dom.aiToggle.addEventListener('change', (e) => {
      state.aiEnabled = e.target.checked;
      if (e.target.checked && !isGeminiAvailable()) {
        // Open settings modal instead of just showing error
        e.target.checked = false;
        state.aiEnabled = false;
        dom.apiKeyModal?.classList.remove('hidden');
      }
    });
    if (geminiReady) {
      dom.aiToggle.checked = true;
      state.aiEnabled = true;
    }
  }
  
  // API Key Modal
  dom.btnAiSettings?.addEventListener('click', () => {
    // Pre-fill with masked key if exists
    const existing = getApiKey();
    if (existing) {
      dom.apiKeyInput.value = existing;
      dom.apiKeyInput.type = 'password';
    } else {
      dom.apiKeyInput.value = '';
    }
    dom.apiKeyModal?.classList.remove('hidden');
  });
  
  dom.btnModalClose?.addEventListener('click', () => {
    dom.apiKeyModal?.classList.add('hidden');
  });
  
  dom.apiKeyModal?.addEventListener('click', (e) => {
    if (e.target === dom.apiKeyModal) dom.apiKeyModal.classList.add('hidden');
  });
  
  dom.btnToggleKeyVis?.addEventListener('click', () => {
    const input = dom.apiKeyInput;
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  
  dom.btnSaveKey?.addEventListener('click', () => {
    const key = dom.apiKeyInput.value.trim();
    if (!key) {
      showToast('API 키를 입력하세요', 'error');
      return;
    }
    setApiKey(key);
    updateAIStatus();
    dom.aiToggle.checked = true;
    state.aiEnabled = true;
    dom.apiKeyModal.classList.add('hidden');
    showToast('Gemini API 키가 저장되었습니다 ✨');
  });
  
  dom.btnDeleteKey?.addEventListener('click', () => {
    clearApiKey();
    dom.apiKeyInput.value = '';
    updateAIStatus();
    dom.aiToggle.checked = false;
    state.aiEnabled = false;
    dom.apiKeyModal.classList.add('hidden');
    showToast('API 키가 삭제되었습니다');
  });
}

init();
