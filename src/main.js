/**
 * Moon OCR Reader — Main Application
 */
import './style.css';
import { ocrEngine } from './ocr-engine.js';

// ============================================
// State
// ============================================
const state = {
  images: [], // { id, file, url, name }
  results: [], // { id, filename, text, confidence, ... }
  isProcessing: false,
};

let imageIdCounter = 0;

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
  dom.resultsSection.classList.add('hidden');
  dom.resultsContainer.innerHTML = '';
  
  const lang = dom.langSelect.value;
  
  try {
    // Initialize engine
    updateProgress(0, 'OCR 엔진 초기화 중...', 'Tesseract.js 워커를 생성합니다');
    
    await ocrEngine.initialize(lang, (progress, message) => {
      updateProgress(progress * 0.2, message, '언어 모델을 다운로드하고 있습니다 (최초 1회)');
    });
    
    // Process images
    const images = state.images.map(img => ({ file: img.file, id: img.id }));
    
    const results = await ocrEngine.recognizeBatch(
      images,
      // onImageStart
      (id, idx, total) => {
        const card = document.getElementById(`card-${id}`);
        if (card) {
          card.classList.add('processing');
          card.insertAdjacentHTML('afterbegin', `<div class="card-status-badge processing">⏳</div>`);
        }
      },
      // onImageComplete
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
      },
      // onProgress
      (progress, message) => {
        updateProgress(0.2 + progress * 0.8, message, `${lang} 모델로 텍스트를 추출하는 중`);
      },
    );
    
    state.results = results;
    renderResults();
    
    dom.progressSection.classList.add('hidden');
    dom.resultsSection.classList.remove('hidden');
    
    const totalChars = results.reduce((sum, r) => sum + (r.text?.length || 0), 0);
    showToast(`${results.length}개 이미지에서 ${totalChars.toLocaleString()}자 추출 완료`);
    
  } catch (err) {
    console.error('OCR Error:', err);
    showToast(`오류 발생: ${err.message}`, 'error');
    dom.progressSection.classList.add('hidden');
  } finally {
    state.isProcessing = false;
    dom.btnStartOcr.disabled = false;
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
function init() {
  setupEventListeners();
}

init();
