/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Modality, GenerateContentResponse } from '@google/genai';

// --- Inlined authManager ---
const authManager = {
  STORAGE_KEY_USER: 'imageSparkUser',
  getCurrentUser(): string | null {
    return localStorage.getItem(this.STORAGE_KEY_USER);
  },
  login(email: string) {
    localStorage.setItem(this.STORAGE_KEY_USER, email.toLowerCase().trim());
  },
  logout() {
    localStorage.removeItem(this.STORAGE_KEY_USER);
  }
};


// --- Inlined usageManager ---
const USAGE_LIMIT = 5;
const STORAGE_KEY_USAGE_PREFIX = 'imageSparkUsage_';

interface UsageData {
  count: number;
  lastReset: number; // Date of the last reset as YYYYMMDD
}

function getTodayDateKey(): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return parseInt(`${year}${month}${day}`, 10);
}

function getUsageStorageKey(): string | null {
    const user = authManager.getCurrentUser();
    return user ? `${STORAGE_KEY_USAGE_PREFIX}${user}` : null;
}

function getUsageData(): UsageData {
  const key = getUsageStorageKey();
  if (!key) return { count: USAGE_LIMIT, lastReset: getTodayDateKey() }; // Logged out users can't generate

  const data = localStorage.getItem(key);
  const today = getTodayDateKey();

  if (data) {
    try {
        const parsed = JSON.parse(data) as UsageData;
        if (parsed.lastReset < today) {
          const freshData = { count: 0, lastReset: today };
          saveUsageData(freshData);
          return freshData;
        }
        return parsed;
    } catch (e) {
        console.error("Could not parse usage data, resetting.", e);
    }
  }

  const initialData = { count: 0, lastReset: today };
  saveUsageData(initialData);
  return initialData;
}

function saveUsageData(data: UsageData) {
  const key = getUsageStorageKey();
  if (key) {
    localStorage.setItem(key, JSON.stringify(data));
  }
}

const usageManager = {
  canGenerate(): boolean {
    if (!authManager.getCurrentUser()) return false;
    const data = getUsageData();
    return data.count < USAGE_LIMIT;
  },
  recordGeneration() {
    let data = getUsageData();
    if (data.count < USAGE_LIMIT) {
      data.count++;
      saveUsageData(data);
    }
  },
  getRemainingGenerations(): number {
    const data = getUsageData();
    const remaining = USAGE_LIMIT - data.count;
    return remaining > 0 ? remaining : 0;
  },
  getDailyLimit(): number {
    return USAGE_LIMIT;
  }
};

// --- Inlined historyManager ---
interface GalleryItem {
  src: string;
  prompt: string;
}

const STORAGE_KEY_HISTORY_PREFIX = 'imageSparkHistory_';
const HISTORY_LIMIT = 20;

function getHistoryStorageKey(): string | null {
    const user = authManager.getCurrentUser();
    return user ? `${STORAGE_KEY_HISTORY_PREFIX}${user}` : null;
}

const historyManager = {
    getHistory(): GalleryItem[] {
        const key = getHistoryStorageKey();
        if (!key) return [];
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error("Failed to parse history, clearing.", e);
            localStorage.removeItem(key);
            return [];
        }
    },
    saveHistory(history: GalleryItem[]) {
        const key = getHistoryStorageKey();
        if (key) {
          localStorage.setItem(key, JSON.stringify(history));
        }
    },
    addItemToHistory(item: GalleryItem) {
        let history = this.getHistory();
        history.unshift(item); // Add to the beginning
        if (history.length > HISTORY_LIMIT) {
            history = history.slice(0, HISTORY_LIMIT); // Keep only the latest items
        }
        this.saveHistory(history);
    },
    clearHistory() {
        const key = getHistoryStorageKey();
        if (key) {
          localStorage.removeItem(key);
        }
    }
};

// --- Interfaces ---
interface ImageFile {
  base64: string;
  mimeType: string;
  src: string;
}

// --- State variables ---
let uploadedImage: ImageFile | null = null;
let selectedPrompt = '';
let selectedStyle = '';
let numberOfVariations = 3;
let selectedAspectRatio = '1:1';
let editHistory: string[] = [];
let historyIndex = -1;
let gridSlices = 3;
let gridLineThickness = 2;

// Masking tool state
let isMaskingEnabled = false;
let isDrawing = false;
let brushSize = 20;
let lastX = 0;
let lastY = 0;

// Zoom & Pan state
let scale = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let startPanX = 0;
let startPanY = 0;
let initialPanX = 0;
let initialPanY = 0;
let initialPinchDistance = 0;


// --- DOM element references ---
const fileUploadInput = document.getElementById('file-upload') as HTMLInputElement;
const uploadBtn = document.getElementById('upload-btn') as HTMLButtonElement;
const generateBtn = document.getElementById('generate-btn') as HTMLButtonElement;
const originalImagePreview = document.getElementById('original-image-preview');
const imageGallery = document.getElementById('image-gallery');
const negativePromptInput = document.getElementById('negative-prompt-input') as HTMLInputElement;
const editModal = document.getElementById('edit-modal') as HTMLDivElement;
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalImageContainer = document.querySelector('.modal-image-container');
const modalImage = document.getElementById('modal-image') as HTMLImageElement;
const modalImageFiltered = document.getElementById('modal-image-filtered') as HTMLImageElement;
const filtersGroup = document.querySelector('.filters-group');
const resetAdjustmentsBtn = document.getElementById('reset-adjustments-btn') as HTMLButtonElement;
const resetFiltersBtn = document.getElementById('reset-filters-btn') as HTMLButtonElement;
const resetAllBtn = document.getElementById('reset-all-btn') as HTMLButtonElement;
const modalDownloadBtn = document.getElementById('modal-download-btn');
const themeToggle = document.getElementById('theme-toggle') as HTMLInputElement;
const tooltip = document.getElementById('tooltip');
const saturateSlider = document.getElementById('saturate-slider') as HTMLInputElement;
const saturateValue = document.getElementById('saturate-value');
const brightnessSlider = document.getElementById('brightness-slider') as HTMLInputElement;
const brightnessValue = document.getElementById('brightness-value');
const contrastSlider = document.getElementById('contrast-slider') as HTMLInputElement;
const contrastValue = document.getElementById('contrast-value');
const downloadOptionsToggle = document.getElementById('download-options-toggle');
const downloadOptionsMenu = document.getElementById('download-options-menu');
const downloadAsJpegBtn = document.getElementById('download-as-jpeg');
const usageCounter = document.getElementById('usage-counter');
const variationsSlider = document.getElementById('variations-slider') as HTMLInputElement;
const variationsValue = document.getElementById('variations-value');
const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
const redoBtn = document.getElementById('redo-btn') as HTMLButtonElement;
const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
const charCounter = document.getElementById('char-counter');
const clearPromptBtn = document.getElementById('clear-prompt-btn');
const autoSuggestionsContainer = document.getElementById('auto-suggestions-container');
const artisticStyleSelector = document.getElementById('artistic-style-selector');
const aspectRatioSelector = document.getElementById('aspect-ratio-selector');

// Image Toolkit elements
const toolkitContainer = document.getElementById('image-toolkit-container');
const magicRemoverBtn = document.getElementById('magic-remover-btn') as HTMLButtonElement;
const blueprintifyBtn = document.getElementById('blueprintify-btn') as HTMLButtonElement;
const sceneCreatorBtn = document.getElementById('scene-creator-btn') as HTMLButtonElement;
const compositionGridBtn = document.getElementById('composition-grid-btn') as HTMLButtonElement;
const copyEffectBtn = document.getElementById('copy-effect-btn') as HTMLButtonElement;
const styleFileUploadInput = document.getElementById('style-file-upload') as HTMLInputElement;
const toolkitPreviewContainer = document.getElementById('toolkit-preview-container');
const toolkitPreviewPlaceholder = toolkitPreviewContainer?.querySelector('.placeholder');
const toolkitPreviewImg = document.getElementById('toolkit-preview-img') as HTMLImageElement;
const toolkitDownloadBtn = document.getElementById('toolkit-download-btn') as HTMLButtonElement;
const gridSizeControl = document.getElementById('grid-size-control');
const gridSizeSlider = document.getElementById('grid-size-slider') as HTMLInputElement;
const gridSizeValue = document.getElementById('grid-size-value');
const gridThicknessControl = document.getElementById('grid-thickness-control');
const gridThicknessSlider = document.getElementById('grid-thickness-slider') as HTMLInputElement;
const gridThicknessValue = document.getElementById('grid-thickness-value');


// Masking tool elements
const enableMaskDrawing = document.getElementById('enable-mask-drawing') as HTMLInputElement;
const brushSizeControl = document.getElementById('brush-size-control');
const brushSizeSlider = document.getElementById('brush-size-slider') as HTMLInputElement;
const brushSizeValue = document.getElementById('brush-size-value');
const maskButtons = document.getElementById('mask-buttons');
const clearMaskBtn = document.getElementById('clear-mask-btn') as HTMLButtonElement;
const maskCanvas = document.getElementById('mask-canvas') as HTMLCanvasElement;
const maskCtx = maskCanvas?.getContext('2d');

// AI Edit elements
const aiEditPrompt = document.getElementById('ai-edit-prompt') as HTMLTextAreaElement;
const aiEditGenerateBtn = document.getElementById('ai-edit-generate-btn') as HTMLButtonElement;


// History Modal elements
const historyBtn = document.getElementById('history-btn');
const historyModal = document.getElementById('history-modal');
const historyModalCloseBtn = document.getElementById('history-modal-close-btn');
const historyGallery = document.getElementById('history-gallery');
const clearHistoryBtn = document.getElementById('clear-history-btn');

// Scene Creator Modal elements
const sceneCreatorModal = document.getElementById('scene-creator-modal');
const sceneCreatorModalCloseBtn = document.getElementById('scene-creator-modal-close-btn');
const sceneCreatorProductImg = document.getElementById('scene-creator-product-img') as HTMLImageElement;
const sceneCreatorPrompt = document.getElementById('scene-creator-prompt') as HTMLTextAreaElement;
const sceneCreatorGenerateBtn = document.getElementById('scene-creator-generate-btn') as HTMLButtonElement;
const sceneCreatorResultContainer = document.getElementById('scene-creator-result-container');
const sceneCreatorResultPlaceholder = sceneCreatorResultContainer?.querySelector('.placeholder');
const sceneCreatorResultImg = document.getElementById('scene-creator-result-img') as HTMLImageElement;
const sceneCreatorActions = document.getElementById('scene-creator-actions');
const sceneCreatorUseBtn = document.getElementById('scene-creator-use-btn') as HTMLButtonElement;
const sceneCreatorDownloadBtn = document.getElementById('scene-creator-download-btn') as HTMLButtonElement;

// Account Modal elements
const accountModal = document.getElementById('account-modal');
const accountModalCloseBtn = document.getElementById('account-modal-close-btn');
const loginPromptBtn = document.getElementById('login-prompt-btn');
const logoutBtn = document.getElementById('logout-btn');
const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('email-input') as HTMLInputElement;
const accountInfo = document.getElementById('account-info');
const userEmailSpan = document.getElementById('user-email');


// Initialize the Google AI client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const model = 'gemini-2.5-flash-image';

const AUTO_SUGGESTION_KEYWORDS = [
  'photorealistic', 'hyperrealistic', '4K', '8K', 'cinematic lighting',
  'soft lighting', 'studio lighting', 'vibrant colors', 'macro shot',
  'detailed', 'intricate details', 'sharp focus', 'soft focus',
  'on a marble slab', 'in a forest', 'on a wooden table', 'product photography'
];

const ADJUSTMENT_FILTER_NAMES = ['brightness', 'contrast', 'saturate'];
const PREDEFINED_FILTER_FUNCTIONS = ['sepia', 'grayscale', 'hue-rotate'];

async function applyWatermark(base64Src: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Canvas context not available'));

            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            ctx.drawImage(img, 0, 0);

            const watermarkText = 'ImageSpark';
            const fontSize = Math.max(12, Math.min(canvas.width, canvas.height) / 20);
            ctx.font = `bold ${fontSize}px ${getComputedStyle(document.body).fontFamily}`;
            
            const theme = document.body.getAttribute('data-theme') || 'dark';
            ctx.fillStyle = theme === 'dark' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)';
            
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const textMetrics = ctx.measureText(watermarkText);
            const textWidth = textMetrics.width * 1.5;
            const textHeight = fontSize * 3;

            ctx.save();
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(-Math.PI / 4);
            
            const maxDimension = Math.max(canvas.width, canvas.height) * 1.5;

            for (let x = -maxDimension / 2; x < maxDimension / 2; x += textWidth) {
                for (let y = -maxDimension / 2; y < maxDimension / 2; y += textHeight) {
                    ctx.fillText(watermarkText, x, y);
                }
            }

            ctx.restore();
            resolve(canvas.toDataURL());
        };
        img.onerror = (err) => reject(err);
        img.src = base64Src;
    });
}

async function performUpscale(event: MouseEvent) {
    const target = event.currentTarget as HTMLButtonElement;
    const wrapper = target.closest('.generated-image-wrapper');
    if (!wrapper) return;

    const upscaleWrapper = wrapper.querySelector('.upscale-menu-wrapper');
    const upscaleToggle = wrapper.querySelector('.upscale-toggle') as HTMLButtonElement;
    const menu = wrapper.querySelector('.upscale-menu') as HTMLDivElement;
    const spinner = wrapper.querySelector('.inline-spinner-container');

    if (!spinner || !upscaleToggle || !menu || !upscaleWrapper) return;

    const prompt = target.dataset.prompt;
    const level = target.dataset.level;
    const originalSrc = target.dataset.originalSrc;
    if (!prompt || !level || !originalSrc) return;

    menu.classList.remove('visible');
    upscaleToggle.classList.remove('open');
    upscaleToggle.disabled = true;
    upscaleToggle.textContent = `Upscaling ${level}...`;
    spinner.classList.remove('hidden');

    try {
        const [header, base64Data] = originalSrc.split(',');
        if (!header || !base64Data) throw new Error('Invalid image data URL.');
        const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';

        const response = await ai.models.generateContent({
            model: model,
            contents: { parts: [{ inlineData: { data: base64Data, mimeType: mimeType } }, { text: prompt }] },
            config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
        });

        const imagePart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
        if (imagePart?.inlineData) {
            const newBase64 = imagePart.inlineData.data;
            const newMimeType = imagePart.inlineData.mimeType || 'image/png';
            const cleanSrc = `data:${newMimeType};base64,${newBase64}`;

            const imgElement = wrapper.querySelector('img');
            if(imgElement) {
                 applyWatermark(cleanSrc).then(watermarkedSrc => {
                    imgElement.src = watermarkedSrc;
                }).catch(console.error);
            }
            upscaleToggle.textContent = 'Upscaled ✔';
            upscaleWrapper.querySelectorAll('button').forEach(btn => btn.disabled = true);
        } else {
            throw new Error('Upscaled image not found in response.');
        }
    } catch (error) {
        console.error("Error upscaling image:", error);
        alert("Failed to upscale image. Please try again.");
        upscaleToggle.disabled = false;
        upscaleToggle.innerHTML = `Upscale <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" stroke="currentColor" stroke-width="1"><path fill-rule="evenodd" d="M7.646 4.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1-.708.708L8 5.707l-5.646 5.647a.5.5 0 0 1-.708-.708z"/></svg>`;
    } finally {
        spinner.classList.add('hidden');
    }
}

function useGeneratedAsInput(item: GalleryItem) {
    const { src, prompt } = item;
    const [header, base64Data] = src.split(',');
    if (!header || !base64Data) {
        console.error("Invalid image source for 'Use as Input'");
        return;
    }
    const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';

    uploadedImage = { src, base64: base64Data, mimeType };

    applyWatermark(src).then(watermarkedSrc => {
        if (originalImagePreview) {
            originalImagePreview.innerHTML = `<img src="${watermarkedSrc}" alt="Uploaded product preview">`;
        }
        if (toolkitPreviewImg) {
            toolkitPreviewImg.src = watermarkedSrc;
        }
    }).catch(console.error);

    if (promptInput) {
        promptInput.value = prompt;
        promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    if (toolkitContainer && toolkitPreviewPlaceholder) {
        toolkitContainer.classList.remove('hidden');
        toolkitPreviewImg.classList.remove('hidden');
        toolkitPreviewPlaceholder.classList.add('hidden');
        [magicRemoverBtn, blueprintifyBtn, sceneCreatorBtn, compositionGridBtn, copyEffectBtn].forEach(btn => {
            if (btn) btn.disabled = false;
        });
        toolkitDownloadBtn.disabled = true;
    }
    
    updateUsageUI();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function createImageElement(item: GalleryItem): HTMLElement {
    const { src, prompt } = item;
    const originalSrc = src;
    const wrapper = document.createElement('div');
    wrapper.className = 'generated-image-wrapper';

    const img = new Image();
    img.alt = prompt;

    applyWatermark(originalSrc).then(watermarkedSrc => {
        img.src = watermarkedSrc;
    }).catch(console.error);
    
    wrapper.addEventListener('click', (e) => {
        // Open the modal if the click target is not a button within the actions.
        if (!(e.target as HTMLElement).closest('button')) {
            openEditModal(img.src, originalSrc);
        }
    });


    const inlineSpinner = document.createElement('div');
    inlineSpinner.className = 'inline-spinner-container hidden';
    inlineSpinner.innerHTML = '<div class="spinner"></div>';

    const actionsWrapper = document.createElement('div');
    actionsWrapper.className = 'image-actions';

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.onclick = () => openEditModal(img.src, originalSrc);

    const useAsInputBtn = document.createElement('button');
    useAsInputBtn.textContent = 'Use as Input';
    useAsInputBtn.onclick = () => useGeneratedAsInput(item);

    const upscaleMenuWrapper = document.createElement('div');
    upscaleMenuWrapper.className = 'upscale-menu-wrapper';
    const upscaleToggleBtn = document.createElement('button');
    upscaleToggleBtn.className = 'upscale-toggle';
    upscaleToggleBtn.innerHTML = `Upscale <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" stroke="currentColor" stroke-width="1"><path fill-rule="evenodd" d="M7.646 4.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1-.708.708L8 5.707l-5.646 5.647a.5.5 0 0 1-.708-.708z"/></svg>`;
    upscaleToggleBtn.onclick = (e) => {
        e.stopPropagation();
        const menu = upscaleToggleBtn.nextElementSibling as HTMLElement;
        const isVisible = menu.classList.contains('visible');
        document.querySelectorAll('.upscale-menu.visible').forEach(m => m.classList.remove('visible'));
        document.querySelectorAll('.upscale-toggle.open').forEach(b => b.classList.remove('open'));
        if (!isVisible) {
            menu.classList.add('visible');
            upscaleToggleBtn.classList.add('open');
        }
    };
    const upscaleMenu = document.createElement('div');
    upscaleMenu.className = 'upscale-menu';
    const upscaleOption1 = document.createElement('button');
    upscaleOption1.className = 'upscale-option';
    upscaleOption1.textContent = '2x (Subtle)';
    upscaleOption1.dataset.level = '2x';
    upscaleOption1.dataset.prompt = 'Subtly upscale this image to twice its original resolution, enhancing clarity without introducing artificial details. Focus on sharpening existing lines and textures.';
    upscaleOption1.dataset.originalSrc = originalSrc;
    upscaleOption1.onclick = performUpscale;
    const upscaleOption2 = document.createElement('button');
    upscaleOption2.className = 'upscale-option';
    upscaleOption2.textContent = '4x (Detailed)';
    upscaleOption2.dataset.level = '4x';
    upscaleOption2.dataset.prompt = 'Upscale this image to four times its original resolution, intelligently adding fine details and textures to create a hyperrealistic, high-quality result. Enhance lighting and depth.';
    upscaleOption2.dataset.originalSrc = originalSrc;
    upscaleOption2.onclick = performUpscale;
    upscaleMenu.appendChild(upscaleOption1);
    upscaleMenu.appendChild(upscaleOption2);
    upscaleMenuWrapper.appendChild(upscaleToggleBtn);
    upscaleMenuWrapper.appendChild(upscaleMenu);

    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Download';
    downloadBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = originalSrc;
        a.download = getFormattedFilename('png');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    actionsWrapper.appendChild(editBtn);
    actionsWrapper.appendChild(useAsInputBtn);
    actionsWrapper.appendChild(upscaleMenuWrapper);
    actionsWrapper.appendChild(downloadBtn);

    wrapper.appendChild(img);
    wrapper.appendChild(inlineSpinner);
    wrapper.appendChild(actionsWrapper);

    return wrapper;
}

function updateUsageUI() {
  if (!usageCounter || !generateBtn) return;
  const user = authManager.getCurrentUser();
  if (!user) {
      usageCounter.textContent = 'Log in to start generating.';
      generateBtn.textContent = 'Please Log In to Generate';
      generateBtn.disabled = true;
      return;
  }
  const remaining = usageManager.getRemainingGenerations();
  const limit = usageManager.getDailyLimit();
  usageCounter.textContent = `You have ${remaining} of ${limit} generations left today.`;
  
  if (remaining <= 0) {
    generateBtn.disabled = true;
    generateBtn.textContent = 'Daily limit reached';
  } else {
    generateBtn.textContent = 'Generate';
    generateBtn.disabled = !uploadedImage || !selectedPrompt;
  }
}

function fileToGenerativePart(file: File): Promise<ImageFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const [, base64] = src.split(',');
      if (!base64) return reject(new Error("Failed to read file as base64."));
      resolve({ base64, mimeType: file.type, src });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function resetToolkit() {
    if (!toolkitContainer || !toolkitPreviewImg || !toolkitPreviewPlaceholder || !compositionGridBtn) return;
    toolkitContainer.classList.add('hidden');
    toolkitPreviewImg.classList.add('hidden');
    toolkitPreviewPlaceholder?.classList.remove('hidden');
    toolkitPreviewImg.src = '';
    [magicRemoverBtn, blueprintifyBtn, sceneCreatorBtn, compositionGridBtn, copyEffectBtn, toolkitDownloadBtn].forEach(btn => {
        if (btn) btn.disabled = true;
    });
    compositionGridBtn.classList.remove('active');
    toolkitPreviewContainer?.classList.remove('grid-active');
    if(toolkitPreviewContainer) {
        toolkitPreviewContainer.style.removeProperty('--grid-size');
        toolkitPreviewContainer.style.removeProperty('--grid-line-thickness');
    }

    // Reset grid controls
    gridSizeControl?.classList.add('hidden');
    gridSlices = 3;
    if (gridSizeSlider) gridSizeSlider.value = '3';
    if (gridSizeValue) gridSizeValue.textContent = '3x3';

    gridThicknessControl?.classList.add('hidden');
    gridLineThickness = 2;
    if (gridThicknessSlider) gridThicknessSlider.value = '2';
    if (gridThicknessValue) gridThicknessValue.textContent = '2px';
}

function resetMainUploader() {
    uploadedImage = null;
    if (originalImagePreview) {
      const uploadInstructions = `
        <div class="upload-instructions">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
          <p>Drag & drop an image here</p>
          <span class="upload-or">or</span>
          <button id="upload-btn" class="action-button">Select Image</button>
        </div>`;
      originalImagePreview.innerHTML = uploadInstructions;
    }
    if (fileUploadInput) fileUploadInput.value = '';
}

function resetControlInputs() {
    if (promptInput) {
        promptInput.value = '';
        promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (negativePromptInput) {
        negativePromptInput.value = '';
    }
    if (variationsSlider && variationsValue) {
        const defaultValue = 3;
        numberOfVariations = defaultValue;
        variationsSlider.value = String(defaultValue);
        variationsValue.textContent = String(defaultValue);
    }
    if (artisticStyleSelector) {
        const defaultValue = '';
        selectedStyle = defaultValue;
        artisticStyleSelector.querySelectorAll('.style-select-btn').forEach(btn => btn.classList.remove('active'));
        const defaultButton = artisticStyleSelector.querySelector(`.style-select-btn[data-style=""]`);
        defaultButton?.classList.add('active');
    }
    if (aspectRatioSelector) {
        const defaultValue = '1:1';
        selectedAspectRatio = defaultValue;
        aspectRatioSelector.querySelectorAll('.aspect-ratio-btn').forEach(btn => btn.classList.remove('active'));
        const defaultButton = aspectRatioSelector.querySelector(`.aspect-ratio-btn[data-ratio="${defaultValue}"]`);
        defaultButton?.classList.add('active');
    }
}

async function processFile(file: File) {
  if (!file || !file.type.startsWith('image/')) {
    alert('Please upload a valid image file.');
    if (fileUploadInput) fileUploadInput.value = '';
    return;
  }
  
  if (originalImagePreview) {
    try {
      uploadedImage = await fileToGenerativePart(file);

      applyWatermark(uploadedImage.src).then(watermarkedSrc => {
          if (originalImagePreview) {
            originalImagePreview.innerHTML = `<img src="${watermarkedSrc}" alt="Uploaded product preview">`;
          }
          if (toolkitPreviewImg) {
            toolkitPreviewImg.src = watermarkedSrc;
          }
      }).catch(console.error);

      if (toolkitContainer && toolkitPreviewImg && toolkitPreviewPlaceholder) {
        toolkitContainer.classList.remove('hidden');
        toolkitPreviewImg.classList.remove('hidden');
        toolkitPreviewPlaceholder.classList.add('hidden');
        [magicRemoverBtn, blueprintifyBtn, sceneCreatorBtn, compositionGridBtn, copyEffectBtn].forEach(btn => {
            if (btn) btn.disabled = false;
        });
        toolkitDownloadBtn.disabled = true;
      }
      updateUsageUI();
    } catch (error) {
      console.error("Error processing file:", error);
      uploadedImage = null;
      if (generateBtn) generateBtn.disabled = true;
      resetMainUploader();
      resetToolkit();
    }
  }
}

async function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  if (target.files?.[0]) await processFile(target.files[0]);
}

function updateUndoRedoState() {
    if (!undoBtn || !redoBtn) return;
    undoBtn.disabled = historyIndex <= 0;
    redoBtn.disabled = historyIndex >= editHistory.length - 1;
}

function updateActiveFilterButtons() {
    if (!modalImageFiltered) return;
    const currentFilterStyle = modalImageFiltered.style.filter;
    const filterButtons = document.querySelectorAll('.filters-group .filter-btn');
    
    // Deactivate all first
    filterButtons.forEach(button => button.classList.remove('active'));

    // Find which button's filter is a substring of the current style
    // This isn't perfect, but works for mutually exclusive complex filters.
    let bestMatchButton: HTMLButtonElement | null = null;
    let longestMatchLength = 0;

    filterButtons.forEach(button => {
        const btn = button as HTMLButtonElement;
        const filterValue = btn.dataset.filter || '';
        if (filterValue && currentFilterStyle.includes(filterValue) && filterValue.length > longestMatchLength) {
            bestMatchButton = btn;
            longestMatchLength = filterValue.length;
        }
    });

    if (bestMatchButton) {
        bestMatchButton.classList.add('active');
    }
}

function applyHistoryState() {
    if (!modalImageFiltered || !saturateSlider || !saturateValue || !brightnessSlider || !brightnessValue || !contrastSlider || !contrastValue) return;
    const currentFilter = editHistory[historyIndex];
    modalImageFiltered.style.filter = currentFilter;

    const filters: { [key: string]: { slider: HTMLInputElement, valueEl: HTMLElement, default: string } } = {
        saturate: { slider: saturateSlider, valueEl: saturateValue, default: '1' },
        brightness: { slider: brightnessSlider, valueEl: brightnessValue, default: '1' },
        contrast: { slider: contrastSlider, valueEl: contrastValue, default: '1' },
    };

    Object.entries(filters).forEach(([name, { slider, valueEl, default: defaultValue }]) => {
        const match = currentFilter.match(new RegExp(`${name}\\(([^)]+)\\)`));
        if (match?.[1]) {
            slider.value = match[1];
            valueEl.textContent = parseFloat(match[1]).toFixed(1);
        } else {
            slider.value = defaultValue;
            valueEl.textContent = parseFloat(defaultValue).toFixed(1);
        }
    });

    updateActiveFilterButtons();
    updateUndoRedoState();
}

function recordHistoryState(newFilter: string) {
    if (historyIndex < editHistory.length - 1) {
        editHistory = editHistory.slice(0, historyIndex + 1);
    }
    editHistory.push(newFilter);
    historyIndex = editHistory.length - 1;
    updateUndoRedoState();
}

function clearMask() {
    if (!maskCtx || !maskCanvas || !modalImageFiltered) return;
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    modalImageFiltered.style.maskImage = 'none';
    modalImageFiltered.style.webkitMaskImage = 'none';
}

function closeEditModal() {
    if (!editModal) return;
    editModal.classList.add('hidden');
    editModal.dataset.originalSrc = '';
    cleanupZoomPanListeners();
}

function openEditModal(watermarkedSrc: string, originalSrc: string) {
  if (!modalImage || !modalImageFiltered || !editModal || !maskCanvas || !enableMaskDrawing) return;
  
  editModal.dataset.originalSrc = originalSrc;
  
  enableMaskDrawing.checked = false;
  isMaskingEnabled = false;
  maskCanvas.classList.remove('drawing-active');
  brushSizeControl?.classList.add('hidden');
  maskButtons?.classList.add('hidden');

  // Reset AI edit UI
  if (aiEditPrompt) aiEditPrompt.value = '';
  if (aiEditGenerateBtn) aiEditGenerateBtn.disabled = true;


  modalImage.src = watermarkedSrc;
  modalImageFiltered.src = watermarkedSrc;

  modalImage.onload = () => {
    initializeTransform();
  };
  
  editHistory = ['none'];
  historyIndex = 0;
  applyHistoryState();
  setupZoomPanListeners();
  editModal.classList.remove('hidden');
}

function getFormattedFilename(extension: 'png' | 'jpeg'): string {
  const now = new Date();
  const date = `${now.getFullYear().toString().slice(-2)}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
  return `ImageSpark_${date}.${extension}`;
}

async function downloadEditedImage(format: 'png' | 'jpeg' = 'png') {
  if (!modalImage || !editModal) return;
  downloadOptionsMenu?.classList.add('hidden');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = editModal.dataset.originalSrc || modalImage.src; // Use clean original src
  image.onload = () => {
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    ctx.drawImage(image, 0, 0);
    const hasMask = modalImageFiltered.style.maskImage && modalImageFiltered.style.maskImage !== 'none';
    const hasFilter = modalImageFiltered.style.filter && modalImageFiltered.style.filter !== 'none';
    if (hasFilter) {
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;
        tempCanvas.width = image.naturalWidth;
        tempCanvas.height = image.naturalHeight;
        tempCtx.filter = modalImageFiltered.style.filter;
        tempCtx.drawImage(image, 0, 0);
        if (hasMask) {
            tempCtx.globalCompositeOperation = 'destination-in';
            tempCtx.drawImage(maskCanvas, 0, 0, image.naturalWidth, image.naturalHeight);
            ctx.drawImage(tempCanvas, 0, 0);
        } else {
             ctx.clearRect(0, 0, canvas.width, canvas.height);
             ctx.drawImage(tempCanvas, 0, 0);
        }
    }
    const mimeType = `image/${format}`;
    const dataUrl = canvas.toDataURL(mimeType, format === 'jpeg' ? 0.9 : undefined);
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = getFormattedFilename(format);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
   image.onerror = () => console.error("Failed to load image for canvas operation.");
}

function createPlaceholderElement(): HTMLElement {
    const placeholder = document.createElement('div');
    placeholder.className = 'placeholder-wrapper';
    placeholder.innerHTML = `<div class="spinner"></div><p>Generating...</p>`;
    return placeholder;
}

function updatePlaceholderWithError(placeholder: HTMLElement, message: string): void {
    placeholder.classList.add('error');
    placeholder.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <p>${message}</p>`;
}

async function handleAiImageEdit() {
    if (!editModal || !aiEditPrompt || !aiEditGenerateBtn || !modalImageContainer) return;
    const originalSrc = editModal.dataset.originalSrc;
    const prompt = aiEditPrompt.value.trim();

    if (!originalSrc || !prompt) return;
    if (!usageManager.canGenerate()) {
        alert(`You have reached your daily generation limit of ${usageManager.getDailyLimit()}.`);
        return updateUsageUI();
    }

    aiEditGenerateBtn.disabled = true;
    aiEditPrompt.disabled = true;
    aiEditGenerateBtn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:3px;"></div><span>Applying...</span>';
    
    try {
        usageManager.recordGeneration();
        updateUsageUI();

        const [header, base64Data] = originalSrc.split(',');
        if (!header || !base64Data) throw new Error('Invalid image data URL.');
        const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';

        const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [{ inlineData: { data: base64Data, mimeType } }, { text: prompt }] },
            config: { responseModalities: [Modality.IMAGE] },
        });

        const imagePart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
        if (imagePart?.inlineData) {
            const newBase64 = imagePart.inlineData.data;
            const newMimeType = imagePart.inlineData.mimeType || 'image/png';
            const newSrc = `data:${newMimeType};base64,${newBase64}`;
            
            historyManager.addItemToHistory({ src: newSrc, prompt: `AI Edit: ${prompt}` });
            editModal.dataset.originalSrc = newSrc;
            const watermarkedSrc = await applyWatermark(newSrc);

            if (modalImage && modalImageFiltered) {
                await new Promise(resolve => {
                    modalImage.onload = resolve;
                    modalImage.src = watermarkedSrc;
                    modalImageFiltered.src = watermarkedSrc;
                });
            }

            editHistory = ['none'];
            historyIndex = 0;
            applyHistoryState();
            
            aiEditPrompt.value = '';

        } else {
            throw new Error('AI edit did not return an image.');
        }
    } catch (error) {
        console.error("Error during AI image edit:", error);
        alert("Failed to apply AI edit. Please try again.");
    } finally {
        aiEditGenerateBtn.disabled = true; // stays disabled as prompt is empty
        aiEditPrompt.disabled = false;
        aiEditGenerateBtn.innerHTML = 'Apply AI Edit';
    }
}

async function handleGenerateClick() {
  if (!usageManager.canGenerate()) {
    alert(`You have reached your daily generation limit of ${usageManager.getDailyLimit()}. Please try again tomorrow.`);
    return updateUsageUI();
  }
  if (!uploadedImage || !imageGallery || !selectedPrompt) return;

  generateBtn.disabled = true;
  generateBtn.textContent = `Generating ${numberOfVariations} image${numberOfVariations > 1 ? 's' : ''}...`;
  usageManager.recordGeneration();

  imageGallery.querySelectorAll('.placeholder-wrapper.error').forEach(el => el.remove());

  const placeholders = Array.from({ length: numberOfVariations }, () => {
    const el = createPlaceholderElement();
    imageGallery.prepend(el);
    return el;
  });

  try {
    const generationPromises = Array.from({ length: numberOfVariations }, () => {
        const parts: ({ text: string } | { inlineData: { data: string; mimeType: string; } })[] = [
            { inlineData: { data: uploadedImage.base64, mimeType: uploadedImage.mimeType } }
        ];

        let promptParts = [`Fulfill this request: "${selectedPrompt}"`];
        if (selectedStyle) {
            promptParts.push(selectedStyle);
        }
        let finalPrompt = promptParts.join(' ').trim() + '.';

        const negativePrompt = negativePromptInput?.value.trim() || '';
        if (negativePrompt) finalPrompt += ` Avoid the following elements: ${negativePrompt}.`;
        const aspectRatioMap: { [key: string]: string } = {
            '4:5': 'a portrait 4:5',
            '3:4': 'a portrait 3:4',
            '9:16': 'a portrait 9:16',
            '16:9': 'a landscape 16:9',
        };
        if (selectedAspectRatio !== '1:1') {
            finalPrompt += ` The final image must have ${aspectRatioMap[selectedAspectRatio]} aspect ratio.`;
        }
        parts.push({ text: finalPrompt });

        return ai.models.generateContent({
            model: model,
            contents: { parts },
            config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
        });
    });

    const results = await Promise.allSettled(generationPromises);
    let imagesGenerated = 0;

    results.forEach((result, index) => {
        const placeholder = placeholders[placeholders.length - 1 - index];
        if (!placeholder) return;

        if (result.status === 'fulfilled') {
            const imagePart = result.value.candidates?.[0]?.content?.parts.find(p => p.inlineData);
            if (imagePart?.inlineData) {
                const imageUrl = `data:${imagePart.inlineData.mimeType || 'image/png'};base64,${imagePart.inlineData.data}`;
                const galleryItem: GalleryItem = { src: imageUrl, prompt: selectedPrompt };
                historyManager.addItemToHistory(galleryItem);
                placeholder.replaceWith(createImageElement(galleryItem));
                imagesGenerated++;
            } else {
                 updatePlaceholderWithError(placeholder, 'No image found.');
            }
        } else {
            console.error("A generation promise failed:", result.reason);
            updatePlaceholderWithError(placeholder, 'Generation failed.');
        }
    });

    if (imagesGenerated === 0) alert("Failed to generate any images. Please try a different prompt or style.");

  } catch (error) {
    console.error("Error generating images:", error);
    alert("An unexpected error occurred. Please try again.");
    placeholders.forEach(p => p.remove());
  } finally {
    resetMainUploader();
    resetToolkit();
    resetControlInputs();
    updateUsageUI();
  }
}

function setTheme(theme: string) {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    if (themeToggle) themeToggle.checked = theme === 'light';
}

function loadTheme() {
    setTheme(localStorage.getItem('theme') || 'dark');
}

function updateFilter(type: string, value: string) {
    if (!modalImageFiltered) return;
    const filters = new Map<string, string>();
    const currentFilterStyle = modalImageFiltered.style.filter;
    if (currentFilterStyle && currentFilterStyle !== 'none') {
        (currentFilterStyle.match(/\w+\([^)]+\)/g) || []).forEach(part => {
            const match = part.match(/(\w+)\((.+)\)/);
            if (match) filters.set(match[1], match[2]);
        });
    }
    filters.set(type, value);
    const newFilterStyle = Array.from(filters.entries()).map(([k, v]) => `${k}(${v})`).join(' ');
    modalImageFiltered.style.filter = newFilterStyle;
    recordHistoryState(newFilterStyle);
}

async function applyToolkitAIEffect(button: HTMLButtonElement, prompt: string, partsOverride?: any[]) {
    if (!uploadedImage) return alert("Please upload an image first.");
    if (!usageManager.canGenerate()) return alert("You've reached your daily generation limit.");

    const originalButtonContent = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<div class="spinner"></div><span>Processing...</span>';

    try {
        usageManager.recordGeneration();
        updateUsageUI();

        const response = await ai.models.generateContent({
            model: model,
            contents: { parts: partsOverride || [
                { inlineData: { data: uploadedImage.base64, mimeType: uploadedImage.mimeType } },
                { text: prompt },
            ]},
            config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
        });
        
        const imagePart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
        if (imagePart?.inlineData) {
            const newBase64 = imagePart.inlineData.data;
            const newMimeType = imagePart.inlineData.mimeType || 'image/png';
            const newSrc = `data:${newMimeType};base64,${newBase64}`;
            
            const effectName = button.querySelector('span')?.textContent || 'Toolkit Effect';
            historyManager.addItemToHistory({ src: newSrc, prompt: effectName });
            uploadedImage = { src: newSrc, base64: newBase64, mimeType: newMimeType };

            applyWatermark(newSrc).then(watermarkedSrc => {
                if (toolkitPreviewImg) toolkitPreviewImg.src = watermarkedSrc;
                if (originalImagePreview) originalImagePreview.innerHTML = `<img src="${watermarkedSrc}" alt="Uploaded product preview">`;
            }).catch(console.error);

            if (toolkitDownloadBtn) toolkitDownloadBtn.disabled = false;
        } else {
            throw new Error("No image data returned from the API.");
        }

    } catch (error) {
        console.error("Toolkit AI effect failed:", error);
        alert("Sorry, the effect could not be applied. Please try again.");
    } finally {
        button.disabled = false;
        button.innerHTML = originalButtonContent;
    }
}

// --- Zoom & Pan Functions ---
function applyTransform() {
    if (!modalImage || !modalImageFiltered || !maskCanvas) return;
    const transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    modalImage.style.transform = transform;
    modalImageFiltered.style.transform = transform;
    maskCanvas.style.transform = transform;
}

function clampPan() {
    if (!modalImageContainer || !modalImage) return;
    const containerRect = modalImageContainer.getBoundingClientRect();
    const imageRect = modalImage.getBoundingClientRect();
    const scaledWidth = imageRect.width;
    const scaledHeight = imageRect.height;

    const minX = Math.min(0, containerRect.width - scaledWidth);
    const maxX = Math.max(0, containerRect.width - scaledWidth);
    panX = Math.max(minX, Math.min(panX, maxX));

    const minY = Math.min(0, containerRect.height - scaledHeight);
    const maxY = Math.max(0, containerRect.height - scaledHeight);
    panY = Math.max(minY, Math.min(panY, maxY));
}

function initializeTransform() {
    if (!modalImageContainer || !modalImage || !modalImageFiltered || !maskCanvas) return;
    const containerRect = modalImageContainer.getBoundingClientRect();
    
    // Reset styles to get natural dimensions
    modalImage.style.transform = 'none';
    const imageRect = modalImage.getBoundingClientRect();
    
    scale = 1;
    panX = (containerRect.width - imageRect.width) / 2;
    panY = (containerRect.height - imageRect.height) / 2;

    maskCanvas.width = imageRect.width;
    maskCanvas.height = imageRect.height;
    clearMask();

    applyTransform();
}

const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!modalImageContainer) return;
    const rect = modalImageContainer.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const zoomFactor = 1.1;
    const oldScale = scale;
    if (e.deltaY < 0) {
        scale = Math.min(5, scale * zoomFactor);
    } else {
        scale = Math.max(1, scale / zoomFactor);
    }
    panX = mx - (mx - panX) * (scale / oldScale);
    panY = my - (my - panY) * (scale / oldScale);
    clampPan();
    applyTransform();
};

const handleMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    if (!modalImageContainer) return;
    isPanning = true;
    startPanX = e.clientX;
    startPanY = e.clientY;
    initialPanX = panX;
    initialPanY = panY;
    modalImageContainer.classList.add('panning');
};

const handleMouseMove = (e: MouseEvent) => {
    if (!isPanning) return;
    e.preventDefault();
    panX = initialPanX + (e.clientX - startPanX);
    panY = initialPanY + (e.clientY - startPanY);
    clampPan();
    applyTransform();
};

const handleMouseUp = () => {
    isPanning = false;
    modalImageContainer?.classList.remove('panning');
};

function getPinchDistance(touches: TouchList) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

const handleTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 1) { // Pan
        isPanning = true;
        startPanX = e.touches[0].clientX;
        startPanY = e.touches[0].clientY;
        initialPanX = panX;
        initialPanY = panY;
    } else if (e.touches.length === 2) { // Pinch
        isPanning = false; // Stop panning if a second finger is added
        initialPinchDistance = getPinchDistance(e.touches);
    }
};

const handleTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1 && isPanning) {
        panX = initialPanX + (e.touches[0].clientX - startPanX);
        panY = initialPanY + (e.touches[0].clientY - startPanY);
        clampPan();
        applyTransform();
    } else if (e.touches.length === 2 && initialPinchDistance > 0) {
        const newDist = getPinchDistance(e.touches);
        const oldScale = scale;
        scale = Math.max(1, Math.min(5, scale * (newDist / initialPinchDistance)));

        if (!modalImageContainer) return;
        const rect = modalImageContainer.getBoundingClientRect();
        const midX = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
        const midY = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;
        panX = midX - (midX - panX) * (scale / oldScale);
        panY = midY - (midY - panY) * (scale / oldScale);
        
        clampPan();
        applyTransform();
        initialPinchDistance = newDist;
    }
};

const handleTouchEnd = (e: TouchEvent) => {
    if (e.touches.length < 2) initialPinchDistance = 0;
    if (e.touches.length < 1) isPanning = false;
};

function setupZoomPanListeners() {
    modalImageContainer?.addEventListener('wheel', handleWheel);
    modalImageContainer?.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    modalImageContainer?.addEventListener('mouseleave', handleMouseUp);
    // Touch events
    modalImageContainer?.addEventListener('touchstart', handleTouchStart);
    modalImageContainer?.addEventListener('touchmove', handleTouchMove);
    modalImageContainer?.addEventListener('touchend', handleTouchEnd);
}
function cleanupZoomPanListeners() {
    modalImageContainer?.removeEventListener('wheel', handleWheel);
    modalImageContainer?.removeEventListener('mousedown', handleMouseDown);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    modalImageContainer?.removeEventListener('mouseleave', handleMouseUp);
    // Touch events
    modalImageContainer?.removeEventListener('touchstart', handleTouchStart);
    modalImageContainer?.removeEventListener('touchmove', handleTouchMove);
    modalImageContainer?.removeEventListener('touchend', handleTouchEnd);
}


// --- Mask Drawing Functions ---
function getMousePos(canvas: HTMLCanvasElement, evt: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    // Adjust mouse coordinates for current pan and zoom
    const transformedX = (evt.clientX - rect.left - panX) / scale;
    const transformedY = (evt.clientY - rect.top - panY) / scale;
    return { x: transformedX, y: transformedY };
}
function handleMaskMouseDown(e: MouseEvent) {
    if (!isMaskingEnabled || !maskCanvas) return;
    isDrawing = true;
    const pos = getMousePos(maskCanvas, e);
    [lastX, lastY] = [pos.x, pos.y];
}
function draw(e: MouseEvent) {
    if (!isDrawing || !isMaskingEnabled || !maskCtx || !maskCanvas) return;
    maskCtx.strokeStyle = 'red';
    maskCtx.lineJoin = 'round';
    maskCtx.lineCap = 'round';
    maskCtx.lineWidth = brushSize / scale; // Adjust brush size based on zoom
    maskCtx.beginPath();
    maskCtx.moveTo(lastX, lastY);
    const pos = getMousePos(maskCanvas, e);
    maskCtx.lineTo(pos.x, pos.y);
    maskCtx.stroke();
    [lastX, lastY] = [pos.x, pos.y];
}
function handleMaskMouseUp() {
    if (!isMaskingEnabled || !maskCanvas || !modalImageFiltered) return;
    isDrawing = false;
    const maskDataUrl = maskCanvas.toDataURL();
    modalImageFiltered.style.maskImage = `url(${maskDataUrl})`;
    modalImageFiltered.style.webkitMaskImage = `url(${maskDataUrl})`;
}

// --- Scene Creator Modal Functions ---
function dataUrlToImageFile(dataUrl: string): ImageFile | null {
    const parts = dataUrl.split(',');
    if (parts.length !== 2) return null;
    const [header, base64] = parts;
    const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
    return { base64, mimeType, src: dataUrl };
}

function openSceneCreatorModal() {
    if (!sceneCreatorModal || !uploadedImage) return;
    
    // Reset state
    sceneCreatorProductImg.src = uploadedImage.src; // Show clean image in preview
    applyWatermark(uploadedImage.src).then(watermarkedSrc => {
        sceneCreatorProductImg.src = watermarkedSrc;
    }).catch(console.error);

    sceneCreatorPrompt.value = '';
    sceneCreatorGenerateBtn.disabled = true;
    sceneCreatorResultImg.classList.add('hidden');
    sceneCreatorResultImg.dataset.originalSrc = '';
    sceneCreatorResultPlaceholder?.classList.remove('hidden');
    sceneCreatorResultContainer.innerHTML = ''; // Clear old results
    if (sceneCreatorResultPlaceholder) sceneCreatorResultContainer.appendChild(sceneCreatorResultPlaceholder);
    if (sceneCreatorResultImg) sceneCreatorResultContainer.appendChild(sceneCreatorResultImg);
    
    sceneCreatorModal.classList.remove('hidden');
}

function closeSceneCreatorModal() {
    sceneCreatorModal?.classList.add('hidden');
}

async function handleSceneCreation() {
    if (!uploadedImage || !sceneCreatorPrompt || !sceneCreatorGenerateBtn || !sceneCreatorResultContainer) return;

    const scenePrompt = sceneCreatorPrompt.value.trim();
    if (!scenePrompt) return;

    if (!usageManager.canGenerate()) {
        alert("You've reached your daily generation limit.");
        return;
    }

    sceneCreatorGenerateBtn.disabled = true;
    sceneCreatorPrompt.disabled = true;
    sceneCreatorResultContainer.innerHTML = `<div class="placeholder-wrapper"><div class="spinner"></div><p>Creating scene...</p></div>`;

    try {
        usageManager.recordGeneration();
        updateUsageUI();

        const fullPrompt = `The user wants to place their product into a new scene. The user has provided an image of their product and a text description of the desired scene. Your task is to generate a new, photorealistic image where the product is seamlessly integrated into the described scene. Pay close attention to realistic lighting, shadows, and reflections to make the composition believable. Do not alter the product itself. The scene description is: '${scenePrompt}'`;

        const response = await ai.models.generateContent({
            model: model,
            contents: { parts: [
                { inlineData: { data: uploadedImage.base64, mimeType: uploadedImage.mimeType } },
                { text: fullPrompt },
            ]},
            config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
        });

        const imagePart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
        if (imagePart?.inlineData) {
            const newBase64 = imagePart.inlineData.data;
            const newMimeType = imagePart.inlineData.mimeType || 'image/png';
            const newSrc = `data:${newMimeType};base64,${newBase64}`;
            
            historyManager.addItemToHistory({ src: newSrc, prompt: `Scene: ${scenePrompt}` });
            sceneCreatorResultImg.dataset.originalSrc = newSrc;
            
            applyWatermark(newSrc).then(watermarkedSrc => {
                sceneCreatorResultImg.src = watermarkedSrc;
            }).catch(console.error);
            
            sceneCreatorResultImg.classList.remove('hidden');
            sceneCreatorActions?.classList.remove('hidden');
            sceneCreatorResultContainer.innerHTML = '';
            sceneCreatorResultContainer.appendChild(sceneCreatorResultImg);
        } else {
            throw new Error("No image data returned from the API.");
        }
    } catch (error) {
        console.error("Scene creation failed:", error);
        sceneCreatorResultContainer.innerHTML = `<div class="placeholder-wrapper error"><p>Sorry, the scene could not be created. Please try again.</p></div>`;
    } finally {
        sceneCreatorGenerateBtn.disabled = false;
        sceneCreatorPrompt.disabled = false;
    }
}

// --- History Modal Functions ---
function populateHistoryModal() {
    if (!historyGallery) return;
    const history = historyManager.getHistory();
    historyGallery.innerHTML = ''; // Clear previous items

    if (history.length === 0) {
        historyGallery.innerHTML = '<p class="history-empty-message">Your generation history is empty.</p>';
        return;
    }

    history.forEach(item => {
        const wrapper = document.createElement('div');
        wrapper.className = 'generated-image-wrapper history-item';
        
        const img = new Image();
        img.src = item.src;
        img.alt = item.prompt;
        
        wrapper.addEventListener('click', (e) => {
            if (!(e.target as HTMLElement).closest('button')) {
                applyWatermark(item.src).then(watermarkedSrc => {
                    openEditModal(watermarkedSrc, item.src);
                }).catch(console.error);
            }
        });

        const actionsWrapper = document.createElement('div');
        actionsWrapper.className = 'image-actions';

        const useAsInputBtn = document.createElement('button');
        useAsInputBtn.textContent = 'Use as Input';
        useAsInputBtn.onclick = () => {
            useGeneratedAsInput(item);
            historyModal?.classList.add('hidden');
        };

        const downloadBtn = document.createElement('button');
        downloadBtn.textContent = 'Download';
        downloadBtn.onclick = () => {
            const a = document.createElement('a');
            a.href = item.src;
            a.download = getFormattedFilename('png');
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        };
        actionsWrapper.appendChild(useAsInputBtn);
        actionsWrapper.appendChild(downloadBtn);
        wrapper.appendChild(img);
        wrapper.appendChild(actionsWrapper);
        historyGallery.appendChild(wrapper);
    });
}

// --- Auth Functions ---
function initAuth() {
    const user = authManager.getCurrentUser();
    if (user) {
        // User is logged in
        accountInfo?.classList.remove('hidden');
        loginPromptBtn?.classList.add('hidden');
        if (userEmailSpan) userEmailSpan.textContent = user;
    } else {
        // User is logged out
        accountInfo?.classList.add('hidden');
        loginPromptBtn?.classList.remove('hidden');
    }
    updateUsageUI();
}

document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  initAuth();

  const uploadArea = document.getElementById('original-image-preview');
  if (uploadArea) {
      uploadArea.addEventListener('click', () => {
          // Only trigger the file input if the upload instructions are present.
          // This prevents re-triggering the upload when an image preview is already shown.
          if (uploadArea.querySelector('.upload-instructions')) {
              fileUploadInput?.click();
          }
      });
  }

  if (fileUploadInput) fileUploadInput.addEventListener('change', handleFileChange);
  if (generateBtn) generateBtn.addEventListener('click', handleGenerateClick);
  if (copyEffectBtn) copyEffectBtn.addEventListener('click', () => styleFileUploadInput?.click());
  if (styleFileUploadInput) styleFileUploadInput.addEventListener('change', async (e) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file && uploadedImage && copyEffectBtn) {
        try {
            const styleImage = await fileToGenerativePart(file);
            const prompt = "The user has provided two images. The first is the primary subject. The second is a style reference. Analyze the style, lighting, color palette, and texture of the second image and apply it to the subject from the first image.";
            const parts = [
                { inlineData: { data: uploadedImage.base64, mimeType: uploadedImage.mimeType } },
                { inlineData: { data: styleImage.base64, mimeType: styleImage.mimeType } },
                { text: prompt }
            ];
            await applyToolkitAIEffect(copyEffectBtn, prompt, parts);
        } catch(error) {
            console.error("Could not process style file for copy effect", error);
            alert("Could not process the selected style image.");
        }
    }
  });


  if (originalImagePreview) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => document.body.addEventListener(evt, e => e.preventDefault()));
    ['dragenter', 'dragover'].forEach(evt => originalImagePreview.addEventListener(evt, () => originalImagePreview.classList.add('drag-over')));
    ['dragleave', 'drop'].forEach(evt => originalImagePreview.addEventListener(evt, () => originalImagePreview.classList.remove('drag-over')));
    originalImagePreview.addEventListener('drop', async (e: DragEvent) => {
      e.preventDefault();
      originalImagePreview.classList.remove('drag-over');
      if (e.dataTransfer?.files?.[0]) await processFile(e.dataTransfer.files[0]);
    });
  }

  if (promptInput && charCounter && clearPromptBtn && autoSuggestionsContainer) {
      promptInput.addEventListener('input', () => {
          selectedPrompt = promptInput.value.trim();
          charCounter.textContent = `${promptInput.value.length} / ${promptInput.maxLength}`;
          updateUsageUI();
          autoSuggestionsContainer.innerHTML = '';
          const lastWord = promptInput.value.split(/\s+/).pop()?.toLowerCase() || '';
          if (lastWord.length > 1) {
              AUTO_SUGGESTION_KEYWORDS
                .filter(kw => kw.startsWith(lastWord) && !promptInput.value.toLowerCase().includes(kw))
                .slice(0, 5)
                .forEach(suggestion => {
                    const tag = document.createElement('button');
                    tag.className = 'suggestion-tag';
                    tag.textContent = suggestion;
                    tag.onclick = () => {
                        promptInput.value = promptInput.value.replace(new RegExp(`${lastWord}$`), suggestion + ' ');
                        promptInput.focus();
                        promptInput.dispatchEvent(new Event('input', { bubbles: true }));
                    };
                    autoSuggestionsContainer.appendChild(tag);
              });
          }
      });
      clearPromptBtn.addEventListener('click', () => {
          promptInput.value = '';
          promptInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
  }

  document.querySelectorAll('#style-starters .style-btn').forEach(button => {
    button.addEventListener('click', () => {
        if (promptInput) {
            promptInput.value = (button as HTMLButtonElement).dataset.prompt || '';
            promptInput.dispatchEvent(new Event('input', { bubbles: true }));
            promptInput.focus();
        }
    });
    if (tooltip) {
        button.addEventListener('mouseenter', (e) => {
            const target = e.currentTarget as HTMLButtonElement;
            tooltip.textContent = target.dataset.prompt || '';
            const rect = target.getBoundingClientRect();
            tooltip.style.top = `${rect.top - 8}px`; 
            tooltip.style.left = `${rect.left + rect.width / 2}px`;
            tooltip.classList.add('visible');
        });
        button.addEventListener('mouseleave', () => tooltip.classList.remove('visible'));
    }
  });
  
  if (variationsSlider && variationsValue) {
    variationsSlider.addEventListener('input', () => {
        numberOfVariations = parseInt(variationsSlider.value, 10);
        variationsValue.textContent = variationsSlider.value;
    });
  }

  artisticStyleSelector?.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('.style-select-btn');
    if (!target) return;
    selectedStyle = (target as HTMLButtonElement).dataset.style || '';
    artisticStyleSelector.querySelectorAll('.style-select-btn').forEach(btn => btn.classList.remove('active'));
    target.classList.add('active');
  });

  aspectRatioSelector?.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('.aspect-ratio-btn');
    if (!target) return;
    selectedAspectRatio = target.getAttribute('data-ratio') || '1:1';
    aspectRatioSelector.querySelectorAll('.aspect-ratio-btn').forEach(btn => btn.classList.remove('active'));
    target.classList.add('active');
  });

  // Image Toolkit Logic
  if (magicRemoverBtn) magicRemoverBtn.addEventListener('click', () => applyToolkitAIEffect(magicRemoverBtn, 'Remove the background from this image, leaving only the main subject against a transparent background.'));
  if (blueprintifyBtn) blueprintifyBtn.addEventListener('click', () => applyToolkitAIEffect(blueprintifyBtn, 'Transform this image into a detailed technical blueprint schematic. The background should be blue, and the subject\'s lines should be white. Include fictional annotations and dimensions for a realistic blueprint effect.'));
  if (sceneCreatorBtn) sceneCreatorBtn.addEventListener('click', openSceneCreatorModal);
  
  compositionGridBtn?.addEventListener('click', () => {
      const isActive = compositionGridBtn.classList.toggle('active');
      toolkitPreviewContainer?.classList.toggle('grid-active', isActive);
      gridSizeControl?.classList.toggle('hidden', !isActive);
      gridThicknessControl?.classList.toggle('hidden', !isActive);

      if (isActive && toolkitPreviewContainer) {
          toolkitPreviewContainer.style.setProperty('--grid-size', String(gridSlices));
          toolkitPreviewContainer.style.setProperty('--grid-line-thickness', `${gridLineThickness}px`);
      }
      if (toolkitDownloadBtn) toolkitDownloadBtn.disabled = false;
  });

  gridSizeSlider?.addEventListener('input', () => {
      gridSlices = parseInt(gridSizeSlider.value, 10);
      if (gridSizeValue) gridSizeValue.textContent = `${gridSlices}x${gridSlices}`;
      if (toolkitPreviewContainer?.classList.contains('grid-active')) {
          toolkitPreviewContainer.style.setProperty('--grid-size', String(gridSlices));
      }
  });

  gridThicknessSlider?.addEventListener('input', () => {
      gridLineThickness = parseInt(gridThicknessSlider.value, 10);
      if (gridThicknessValue) gridThicknessValue.textContent = `${gridLineThickness}px`;
      if (toolkitPreviewContainer?.classList.contains('grid-active')) {
          toolkitPreviewContainer.style.setProperty('--grid-line-thickness', `${gridLineThickness}px`);
      }
  });

  toolkitDownloadBtn?.addEventListener('click', () => {
      if (!uploadedImage) return;
      const cleanSrc = uploadedImage.src;
      
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
          const isGridActive = toolkitPreviewContainer?.classList.contains('grid-active');

          if (isGridActive) {
              const tileWidth = Math.floor(img.naturalWidth / gridSlices);
              const tileHeight = Math.floor(img.naturalHeight / gridSlices);
              
              if (tileWidth === 0 || tileHeight === 0) {
                  alert("Image is too small to be sliced.");
                  return;
              }
              const baseFilename = getFormattedFilename('png').replace('.png', '');

              for (let row = 0; row < gridSlices; row++) {
                  for (let col = 0; col < gridSlices; col++) {
                      const tileCanvas = document.createElement('canvas');
                      tileCanvas.width = tileWidth;
                      tileCanvas.height = tileHeight;
                      const tileCtx = tileCanvas.getContext('2d');
                      if (!tileCtx) continue;

                      const sx = col * tileWidth;
                      const sy = row * tileHeight;

                      tileCtx.drawImage(
                          img,
                          sx, sy, tileWidth, tileHeight,
                          0, 0, tileWidth, tileHeight
                      );

                      const dataUrl = tileCanvas.toDataURL('image/png');
                      const tileFilename = `${baseFilename}_tile_${row * gridSlices + col + 1}.png`;

                      const a = document.createElement('a');
                      a.href = dataUrl;
                      a.download = tileFilename;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                  }
              }
          } else {
              const a = document.createElement('a');
              a.href = cleanSrc;
              a.download = getFormattedFilename('png');
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
          }
      };
      img.onerror = () => {
          console.error("Failed to load image for canvas operation.");
          alert("Could not load the image for download. It might be a network issue or a problem with the image source.");
      };
      img.src = cleanSrc;
  });

  // Edit Modal logic
  modalCloseBtn?.addEventListener('click', closeEditModal);
  editModal?.addEventListener('click', (e) => { if (e.target === editModal) closeEditModal(); });
  
  if (aiEditGenerateBtn) aiEditGenerateBtn.addEventListener('click', handleAiImageEdit);
  if (aiEditPrompt) {
    aiEditPrompt.addEventListener('input', () => {
        if (aiEditGenerateBtn) {
            aiEditGenerateBtn.disabled = aiEditPrompt.value.trim().length === 0;
        }
    });
  }

  filtersGroup?.addEventListener('click', (e) => {
    const target = e.target as HTMLButtonElement;
    if (!target.classList.contains('filter-btn') || !modalImageFiltered) return;

    const clickedFilterValue = target.dataset.filter || '';
    const wasActive = target.classList.contains('active');

    // Get current adjustment filters (from sliders)
    const currentFilters = (modalImageFiltered.style.filter || '').match(/\w+\([^)]+\)/g) || [];
    const adjustments = currentFilters.filter(f => ADJUSTMENT_FILTER_NAMES.some(adj => f.startsWith(adj)));

    let newFilterStyle = adjustments.join(' ');

    // If the clicked button was not active, add its filter. Otherwise, it gets toggled off.
    if (!wasActive) {
        newFilterStyle += ' ' + clickedFilterValue;
    }

    modalImageFiltered.style.filter = newFilterStyle.trim();
    recordHistoryState(newFilterStyle.trim() || 'none');
    updateActiveFilterButtons();
  });

  saturateSlider?.addEventListener('input', () => {
      if (!saturateSlider || !saturateValue) return;
      saturateValue.textContent = parseFloat(saturateSlider.value).toFixed(1);
      updateFilter('saturate', saturateSlider.value);
  });
  brightnessSlider?.addEventListener('input', () => {
    if (!brightnessSlider || !brightnessValue) return;
    brightnessValue.textContent = parseFloat(brightnessSlider.value).toFixed(1);
    updateFilter('brightness', brightnessSlider.value);
  });
  contrastSlider?.addEventListener('input', () => {
    if (!contrastSlider || !contrastValue) return;
    contrastValue.textContent = parseFloat(contrastSlider.value).toFixed(1);
    updateFilter('contrast', contrastSlider.value);
  });
  
  resetAdjustmentsBtn?.addEventListener('click', () => {
    if (!modalImageFiltered || !saturateSlider || !brightnessSlider || !contrastSlider) return;
    saturateSlider.value = '1';
    brightnessSlider.value = '1';
    contrastSlider.value = '1';
    
    saturateSlider.dispatchEvent(new Event('input', { bubbles: true }));
    brightnessSlider.dispatchEvent(new Event('input', { bubbles: true }));
    contrastSlider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  
  resetFiltersBtn?.addEventListener('click', () => {
      if (!modalImageFiltered) return;
      const currentFilters = (modalImageFiltered.style.filter || '').match(/\w+\([^)]+\)/g) || [];
      const adjustments = currentFilters.filter(f => ADJUSTMENT_FILTER_NAMES.some(adj => f.startsWith(adj)));
      const newFilterStyle = adjustments.join(' ');
      
      modalImageFiltered.style.filter = newFilterStyle;
      recordHistoryState(newFilterStyle.trim() || 'none');
      updateActiveFilterButtons();
  });

  resetAllBtn?.addEventListener('click', () => {
      editHistory = ['none'];
      historyIndex = 0;
      applyHistoryState();
      initializeTransform();
  });
  undoBtn?.addEventListener('click', () => { if (historyIndex > 0) { historyIndex--; applyHistoryState(); } });
  redoBtn?.addEventListener('click', () => { if (historyIndex < editHistory.length - 1) { historyIndex++; applyHistoryState(); } });
  modalDownloadBtn?.addEventListener('click', () => downloadEditedImage('png'));
  downloadAsJpegBtn?.addEventListener('click', (e) => { e.preventDefault(); downloadEditedImage('jpeg'); });
  downloadOptionsToggle?.addEventListener('click', (e) => { e.stopPropagation(); downloadOptionsMenu?.classList.toggle('hidden'); });
  
  // Masking tool logic
  enableMaskDrawing?.addEventListener('change', () => {
      isMaskingEnabled = enableMaskDrawing.checked;
      maskCanvas?.classList.toggle('drawing-active', isMaskingEnabled);
      brushSizeControl?.classList.toggle('hidden', !isMaskingEnabled);
      maskButtons?.classList.toggle('hidden', !isMaskingEnabled);
      const cursorVal = isMaskingEnabled ? `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="${brushSize}" height="${brushSize}" viewBox="0 0 ${brushSize} ${brushSize}"><circle cx="${brushSize/2}" cy="${brushSize/2}" r="${brushSize/2 - 1}" fill="none" stroke="black" stroke-width="1" stroke-dasharray="2,2"/></svg>') ${brushSize/2} ${brushSize/2}, auto` : 'default';
      if (maskCanvas) maskCanvas.style.cursor = cursorVal;
  });
  brushSizeSlider?.addEventListener('input', () => {
    brushSize = parseInt(brushSizeSlider.value, 10);
    if(brushSizeValue) brushSizeValue.textContent = brushSize.toString();
    if(isMaskingEnabled && maskCanvas) {
        maskCanvas.style.cursor = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="${brushSize}" height="${brushSize}" viewBox="0 0 ${brushSize} ${brushSize}"><circle cx="${brushSize/2}" cy="${brushSize/2}" r="${brushSize/2 - 1}" fill="none" stroke="black" stroke-width="1" stroke-dasharray="2,2"/></svg>') ${brushSize/2} ${brushSize/2}, auto`;
    }
  });
  clearMaskBtn?.addEventListener('click', clearMask);
  maskCanvas?.addEventListener('mousedown', handleMaskMouseDown);
  maskCanvas?.addEventListener('mousemove', draw);
  maskCanvas?.addEventListener('mouseup', handleMaskMouseUp);
  maskCanvas?.addEventListener('mouseleave', () => { isDrawing = false; });

  // Scene Creator Modal Logic
  sceneCreatorModalCloseBtn?.addEventListener('click', closeSceneCreatorModal);
  sceneCreatorModal?.addEventListener('click', (e) => { if(e.target === sceneCreatorModal) closeSceneCreatorModal() });
  sceneCreatorPrompt?.addEventListener('input', () => {
    if (sceneCreatorPrompt && sceneCreatorGenerateBtn) sceneCreatorGenerateBtn.disabled = sceneCreatorPrompt.value.trim().length === 0;
  });
  sceneCreatorGenerateBtn?.addEventListener('click', handleSceneCreation);
  sceneCreatorUseBtn?.addEventListener('click', () => {
    const originalSrc = sceneCreatorResultImg?.dataset.originalSrc;
    if (!originalSrc) return;
    const newImageFile = dataUrlToImageFile(originalSrc);
    if (newImageFile) {
        uploadedImage = newImageFile;
        
        applyWatermark(uploadedImage.src).then(watermarkedSrc => {
            if (originalImagePreview) originalImagePreview.innerHTML = `<img src="${watermarkedSrc}" alt="Uploaded product preview">`;
            if (toolkitPreviewImg) toolkitPreviewImg.src = watermarkedSrc;
        }).catch(console.error);

        if (toolkitDownloadBtn) toolkitDownloadBtn.disabled = false;
        closeSceneCreatorModal();
    } else {
        alert("Could not use the generated image.");
    }
  });
  sceneCreatorDownloadBtn?.addEventListener('click', () => {
      const originalSrc = sceneCreatorResultImg?.dataset.originalSrc;
      if (!originalSrc || !sceneCreatorPrompt) return;
      const a = document.createElement('a');
      a.href = originalSrc;
      a.download = getFormattedFilename('png');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
  });

  // History Modal Logic
  historyBtn?.addEventListener('click', () => {
    if (!authManager.getCurrentUser()) {
        alert("Please log in to view your history.");
        return;
    }
    populateHistoryModal();
    historyModal?.classList.remove('hidden');
  });
  historyModalCloseBtn?.addEventListener('click', () => historyModal?.classList.add('hidden'));
  historyModal?.addEventListener('click', e => { if (e.target === historyModal) historyModal.classList.add('hidden'); });
  clearHistoryBtn?.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear your entire generation history? This cannot be undone.')) {
        historyManager.clearHistory();
        populateHistoryModal();
    }
  });
  
  // Account Modal Logic
  loginPromptBtn?.addEventListener('click', () => accountModal?.classList.remove('hidden'));
  accountModalCloseBtn?.addEventListener('click', () => accountModal?.classList.add('hidden'));
  accountModal?.addEventListener('click', (e) => { if (e.target === accountModal) accountModal.classList.add('hidden'); });
  logoutBtn?.addEventListener('click', () => {
      authManager.logout();
      initAuth();
      imageGallery.innerHTML = '';
  });
  loginForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = emailInput?.value;
      if (email) {
          authManager.login(email);
          initAuth();
          accountModal?.classList.add('hidden');
          emailInput.value = '';
      }
  });


  // Global click listener for menus
  window.addEventListener('click', (e) => {
      if (downloadOptionsMenu && !downloadOptionsMenu.classList.contains('hidden')) {
          downloadOptionsMenu.classList.add('hidden');
      }
      if (!(e.target as HTMLElement).closest('.upscale-menu-wrapper')) {
        document.querySelectorAll('.upscale-menu.visible').forEach(menu => menu.classList.remove('visible'));
        document.querySelectorAll('.upscale-toggle.open').forEach(b => b.classList.remove('open'));
      }
  });

  themeToggle?.addEventListener('change', () => setTheme(themeToggle.checked ? 'light' : 'dark'));
});