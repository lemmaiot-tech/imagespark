/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Modality, GenerateContentResponse } from '@google/genai';
import { usageManager } from './usageManager.js';

// --- Local Storage Gallery ---
interface GalleryItem {
  src: string;
  prompt: string;
}
// NOTE: Storing base64 images in localStorage is not scalable and can exceed storage quotas.
// The gallery will now be session-based to prevent errors.

// --- State variables ---
let uploadedImage: {
  base64: string;
  mimeType: string;
} | null = null;
let selectedPrompt = '';
let numberOfVariations = 3;
let editHistory: string[] = [];
let historyIndex = -1;

// --- DOM element references ---
const fileUploadInput = document.getElementById('file-upload') as HTMLInputElement;
const uploadBtn = document.getElementById('upload-btn') as HTMLButtonElement;
const generateBtn = document.getElementById('generate-btn') as HTMLButtonElement;
const originalImagePreview = document.getElementById('original-image-preview');
const imageGallery = document.getElementById('image-gallery');
const loader = document.getElementById('loader');
const negativePromptInput = document.getElementById('negative-prompt-input') as HTMLInputElement;
const editModal = document.getElementById('edit-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalImage = document.getElementById('modal-image') as HTMLImageElement;
const filterControls = document.querySelector('.filter-controls');
const resetFiltersBtn = document.getElementById('reset-filters-btn') as HTMLButtonElement;
const modalDownloadBtn = document.getElementById('modal-download-btn');
const themeToggle = document.getElementById('theme-toggle') as HTMLInputElement;
const tooltip = document.getElementById('tooltip');
const saturateSlider = document.getElementById('saturate-slider') as HTMLInputElement;
const saturateValue = document.getElementById('saturate-value');
const downloadOptionsToggle = document.getElementById('download-options-toggle');
const downloadOptionsMenu = document.getElementById('download-options-menu');
const downloadAsJpegBtn = document.getElementById('download-as-jpeg');
const usageCounter = document.getElementById('usage-counter');
const variationsSlider = document.getElementById('variations-slider') as HTMLInputElement;
const variationsValue = document.getElementById('variations-value');
const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
const redoBtn = document.getElementById('redo-btn') as HTMLButtonElement;

// New prompt input elements
const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
const charCounter = document.getElementById('char-counter');
const clearPromptBtn = document.getElementById('clear-prompt-btn');
const autoSuggestionsContainer = document.getElementById('auto-suggestions-container');


// Initialize the Google AI client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const model = 'gemini-2.5-flash-image-preview';

const AUTO_SUGGESTION_KEYWORDS = [
  'photorealistic', 'hyperrealistic', '4K', '8K', 'cinematic lighting',
  'soft lighting', 'studio lighting', 'vibrant colors', 'macro shot',
  'detailed', 'intricate details', 'sharp focus', 'soft focus',
  'on a marble slab', 'in a forest', 'on a wooden table', 'product photography'
];


/**
 * Handles the upscaling of a generated image.
 * @param event The mouse event from the upscale button click.
 */
async function handleUpscaleClick(event: MouseEvent) {
    const target = event.currentTarget as HTMLButtonElement;
    const wrapper = target.closest('.generated-image-wrapper');
    if (!wrapper) return;
    
    const img = wrapper.querySelector('img');
    const spinner = wrapper.querySelector('.inline-spinner-container');
    if (!img || !spinner) return;

    target.disabled = true;
    target.textContent = 'Upscaling...';
    spinner.classList.remove('hidden');

    try {
        const originalSrc = img.src;
        const [header, base64Data] = originalSrc.split(',');
        if (!header || !base64Data) {
            throw new Error('Invalid image data URL.');
        }
        const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';

        const response = await ai.models.generateContent({
            model: model,
            contents: {
                parts: [
                    { inlineData: { data: base64Data, mimeType: mimeType } },
                    { text: 'Upscale this image, significantly increasing its resolution and enhancing details for high-quality printing. Maintain the original composition and style.' }
                ],
            },
            config: {
                responseModalities: [Modality.IMAGE, Modality.TEXT],
            },
        });

        const imagePart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
        if (imagePart?.inlineData) {
            const newBase64 = imagePart.inlineData.data;
            const newMimeType = imagePart.inlineData.mimeType || 'image/png';
            img.src = `data:${newMimeType};base64,${newBase64}`;
            target.textContent = 'Upscaled';
        } else {
            throw new Error('Upscaled image not found in response.');
        }

    } catch (error) {
        console.error("Error upscaling image:", error);
        alert("Failed to upscale image. Please try again.");
        target.disabled = false;
        target.textContent = 'Upscale';
    } finally {
        spinner.classList.add('hidden');
    }
}


/**
 * Creates an image gallery item element.
 * @param item The gallery item data.
 * @returns The HTML element for the gallery item.
 */
function createImageElement(item: GalleryItem): HTMLElement {
    const { src, prompt } = item;
    const wrapper = document.createElement('div');
    wrapper.className = 'generated-image-wrapper';

    const img = new Image();
    img.src = src;
    img.alt = prompt;

    const inlineSpinner = document.createElement('div');
    inlineSpinner.className = 'inline-spinner-container hidden';
    inlineSpinner.innerHTML = '<div class="spinner"></div>';

    const actionsWrapper = document.createElement('div');
    actionsWrapper.className = 'image-actions';

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.onclick = () => openEditModal(img.src);

    const upscaleBtn = document.createElement('button');
    upscaleBtn.textContent = 'Upscale';
    upscaleBtn.onclick = handleUpscaleClick;

    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Download';
    downloadBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = img.src;
        a.download = getFormattedFilename('png');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    actionsWrapper.appendChild(editBtn);
    actionsWrapper.appendChild(upscaleBtn);
    actionsWrapper.appendChild(downloadBtn);

    wrapper.appendChild(img);
    wrapper.appendChild(inlineSpinner);
    wrapper.appendChild(actionsWrapper);

    return wrapper;
}


/**
 * Updates the UI to show the remaining generations and disables/enables the generate button.
 */
function updateUsageUI() {
  if (!usageCounter || !generateBtn) return;

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

/**
 * Converts a File object to a base64 encoded string.
 * @param file The file to convert.
 * @returns A promise that resolves with the base64 string and mime type.
 */
function fileToGenerativePart(file: File): Promise<{ base64: string, mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      if (!base64) {
        reject(new Error("Failed to read file as base64."));
        return;
      }
      resolve({ base64, mimeType: file.type });
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

/**
 * Processes the uploaded file (from input or drag-and-drop).
 * @param file The image file to process.
 */
async function processFile(file: File) {
  if (!file || !file.type.startsWith('image/')) {
    alert('Please upload a valid image file.');
    if (fileUploadInput) fileUploadInput.value = '';
    return;
  }
  
  const uploadInstructions = originalImagePreview?.querySelector('.upload-instructions');

  if (originalImagePreview) {
    const previewImg = document.createElement('img');
    previewImg.src = URL.createObjectURL(file);
    previewImg.onload = () => URL.revokeObjectURL(previewImg.src);
    
    if (uploadInstructions) {
        originalImagePreview.innerHTML = '';
        originalImagePreview.appendChild(previewImg);
    }

    try {
      uploadedImage = await fileToGenerativePart(file);
      updateUsageUI();
    } catch (error) {
      console.error("Error processing file:", error);
      uploadedImage = null;
      if (generateBtn) generateBtn.disabled = true;
      if (uploadInstructions) {
        originalImagePreview.innerHTML = '';
        originalImagePreview.appendChild(uploadInstructions);
        const p = originalImagePreview.querySelector('p');
        if (p) p.style.color = 'red';
        if (p) p.textContent = 'Could not process image.';
      }
    }
  }
}

/**
 * Handles the file input change event.
 */
async function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) {
    await processFile(file);
  }
}

/**
 * Updates the disabled state of the undo and redo buttons based on history.
 */
function updateUndoRedoState() {
    if (!undoBtn || !redoBtn) return;
    undoBtn.disabled = historyIndex <= 0;
    redoBtn.disabled = historyIndex >= editHistory.length - 1;
}

/**
 * Applies the filter state from the current history index to the image and UI controls.
 */
function applyHistoryState() {
    if (!modalImage || !saturateSlider || !saturateValue) return;

    const currentFilter = editHistory[historyIndex];
    modalImage.style.filter = currentFilter;

    // Update the saturation slider to match the new state
    const saturateMatch = currentFilter.match(/saturate\(([^)]+)\)/);
    if (saturateMatch && saturateMatch[1]) {
        const value = saturateMatch[1];
        saturateSlider.value = value;
        saturateValue.textContent = parseFloat(value).toFixed(1);
    } else {
        // If saturate is not in the filter string, reset the slider
        saturateSlider.value = '1';
        saturateValue.textContent = '1.0';
    }

    updateUndoRedoState();
}

/**
 * Records a new filter state into the history.
 * @param newFilter The new CSS filter string to record.
 */
function recordHistoryState(newFilter: string) {
    // If we've undone some steps and are now making a new edit,
    // truncate the "future" history.
    if (historyIndex < editHistory.length - 1) {
        editHistory = editHistory.slice(0, historyIndex + 1);
    }
    editHistory.push(newFilter);
    historyIndex = editHistory.length - 1;
    updateUndoRedoState();
}


/**
 * Opens the editing modal with the specified image.
 * @param imageSrc The data URL of the image to edit.
 */
function openEditModal(imageSrc: string) {
  if (!modalImage || !editModal) return;
  modalImage.src = imageSrc;
  
  // Initialize edit history for the new image
  editHistory = ['none'];
  historyIndex = 0;
  applyHistoryState(); // Apply initial state and update buttons

  editModal.classList.remove('hidden');
}

/**
 * Generates a formatted filename with the current date.
 * @param extension The file extension ('png' or 'jpeg').
 * @returns A string like 'ImageSpark_YY-MM-DD.png'.
 */
function getFormattedFilename(extension: 'png' | 'jpeg'): string {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2);
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `ImageSpark_${year}-${month}-${day}.${extension}`;
}


/**
 * Draws the edited image on a canvas and triggers a download.
 * @param format The desired image format ('png' or 'jpeg').
 */
async function downloadEditedImage(format: 'png' | 'jpeg' = 'png') {
  if (!modalImage) return;

  downloadOptionsMenu?.classList.add('hidden');

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = modalImage.src;

  image.onload = () => {
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    ctx.filter = modalImage.style.filter;
    ctx.drawImage(image, 0, 0);

    const mimeType = `image/${format}`;
    const dataUrl = canvas.toDataURL(mimeType, format === 'jpeg' ? 0.9 : undefined);
    
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = getFormattedFilename(format);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
   image.onerror = () => {
    console.error("Failed to load image for canvas operation.");
   }
}


/**
 * Creates a placeholder element to show while an image is generating.
 * @returns The placeholder HTML element.
 */
function createPlaceholderElement(): HTMLElement {
    const placeholder = document.createElement('div');
    placeholder.className = 'placeholder-wrapper';
    placeholder.innerHTML = `<div class="spinner"></div><p>Generating...</p>`;
    return placeholder;
}

/**
 * Updates a placeholder element to show an error state.
 * @param placeholder The placeholder element to update.
 * @param message The error message to display.
 */
function updatePlaceholderWithError(placeholder: HTMLElement, message: string): void {
    placeholder.classList.add('error');
    // Error Icon SVG
    const errorIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
    `;
    placeholder.innerHTML = `${errorIcon}<p>${message}</p>`;
}


/**
 * Handles the generate button click event.
 */
async function handleGenerateClick() {
  if (!usageManager.canGenerate()) {
    alert(`You have reached your daily generation limit of ${usageManager.getDailyLimit()}. Please try again tomorrow.`);
    updateUsageUI();
    return;
  }

  if (!uploadedImage || !imageGallery || !selectedPrompt) {
    console.error("Required elements, image data, or a prompt is missing.");
    return;
  }

  const negativePrompt = negativePromptInput?.value.trim() || '';
  let finalPrompt = selectedPrompt;
  if (negativePrompt) {
    finalPrompt += `. Avoid the following elements: ${negativePrompt}.`;
  }

  generateBtn.disabled = true;
  generateBtn.textContent = `Generating ${numberOfVariations} image${numberOfVariations > 1 ? 's' : ''}...`;
  
  // Record usage once per click, before starting generation.
  usageManager.recordGeneration();

  // Create and display placeholders
  const placeholders: HTMLElement[] = [];
  for (let i = 0; i < numberOfVariations; i++) {
    const placeholder = createPlaceholderElement();
    placeholders.push(placeholder);
    imageGallery.prepend(placeholder);
  }

  try {
    const generationPromises: Promise<GenerateContentResponse>[] = [];
    for (let i = 0; i < numberOfVariations; i++) {
        const promise = ai.models.generateContent({
            model: model,
            contents: {
                parts: [
                    { inlineData: { data: uploadedImage.base64, mimeType: uploadedImage.mimeType } },
                    { text: finalPrompt },
                ],
            },
            config: {
                responseModalities: [Modality.IMAGE, Modality.TEXT],
            },
        });
        generationPromises.push(promise);
    }

    const results = await Promise.allSettled(generationPromises);
    let imagesGenerated = 0;

    results.forEach((result, index) => {
        const placeholder = placeholders[numberOfVariations - 1 - index]; // Process in reverse order of prepending
        if (!placeholder) return;

        if (result.status === 'fulfilled') {
            const response = result.value;
            const imagePart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
            
            if (imagePart?.inlineData) {
                const base64ImageBytes = imagePart.inlineData.data;
                const mimeType = imagePart.inlineData.mimeType || 'image/png';
                const imageUrl = `data:${mimeType};base64,${base64ImageBytes}`;
                const galleryItem: GalleryItem = { src: imageUrl, prompt: finalPrompt };
                
                const imageElement = createImageElement(galleryItem);
                placeholder.replaceWith(imageElement);
                imagesGenerated++;
            } else {
                 updatePlaceholderWithError(placeholder, 'No image found.');
            }
        } else {
            console.error("A generation promise failed:", result.reason);
            updatePlaceholderWithError(placeholder, 'Generation failed.');
        }
    });

    if (imagesGenerated === 0) {
        alert("Failed to generate any images. Please try a different prompt or style.");
    }

  } catch (error) {
    console.error("Error generating images:", error);
    alert("An unexpected error occurred while generating images. Please try again.");
    // Remove all placeholders on a catastrophic failure
    placeholders.forEach(p => p.remove());

  } finally {
    // Clear the uploaded image and reset the input area.
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
      // Re-add event listener to the new button
      const newUploadBtn = document.getElementById('upload-btn');
      newUploadBtn?.addEventListener('click', () => fileUploadInput?.click());
    }
    if (fileUploadInput) {
        fileUploadInput.value = '';
    }

    // Update UI state (disables button since uploadedImage is now null).
    updateUsageUI();
  }
}

/**
 * Sets the theme for the application.
 * @param theme The theme to set ('light' or 'dark').
 */
function setTheme(theme: string) {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    if (themeToggle) {
        themeToggle.checked = theme === 'light';
    }
}

/**
 * Loads the saved theme from localStorage or defaults to dark.
 */
function loadTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    setTheme(savedTheme);
}

/**
 * Parses the current filter style, updates it with a new value,
 * and applies it to the modal image.
 * @param type The CSS filter type (e.g., 'brightness').
 * @param value The new value for the filter.
 */
function updateFilter(type: string, value: string) {
    if (!modalImage) return;

    const filters = new Map<string, string>();
    const currentFilterStyle = modalImage.style.filter;

    if (currentFilterStyle && currentFilterStyle !== 'none') {
        const filterParts = currentFilterStyle.match(/\w+\([^)]+\)/g) || [];
        filterParts.forEach(part => {
            const match = part.match(/(\w+)\((.+)\)/);
            if (match) {
                filters.set(match[1], match[2]);
            }
        });
    }

    filters.set(type, value);

    const newFilterStyle = Array.from(filters.entries())
        .map(([key, val]) => `${key}(${val})`)
        .join(' ');

    modalImage.style.filter = newFilterStyle;
    recordHistoryState(newFilterStyle);
}


// Attach event listeners once the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  updateUsageUI(); 

  if (fileUploadInput) fileUploadInput.addEventListener('change', handleFileChange);
  if (uploadBtn) uploadBtn.addEventListener('click', () => fileUploadInput.click());
  if (generateBtn) generateBtn.addEventListener('click', handleGenerateClick);

  // Drag and drop logic
  const dropZone = document.getElementById('original-image-preview');
  if (dropZone && originalImagePreview) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      document.body.addEventListener(eventName, e => e.preventDefault());
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, () => {
        originalImagePreview.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, () => {
        originalImagePreview.classList.remove('drag-over');
      });
    });

    dropZone.addEventListener('drop', async (e: DragEvent) => {
      e.preventDefault();
      originalImagePreview.classList.remove('drag-over');
      const droppedFiles = e.dataTransfer?.files;
      if (droppedFiles && droppedFiles.length > 0) {
        if (fileUploadInput) fileUploadInput.files = droppedFiles;
        await processFile(droppedFiles[0]);
      }
    });
  }

  // --- Prompt Input Logic ---
  if (promptInput && charCounter && clearPromptBtn && autoSuggestionsContainer) {
      promptInput.addEventListener('input', () => {
          const prompt = promptInput.value;
          const length = prompt.length;
          const maxLength = promptInput.maxLength;

          selectedPrompt = prompt.trim();
          charCounter.textContent = `${length} / ${maxLength}`;
          updateUsageUI();
          
          // Auto-suggestions
          autoSuggestionsContainer.innerHTML = '';
          const currentWords = prompt.split(/\s+/);
          const lastWord = currentWords[currentWords.length - 1].toLowerCase();

          if (lastWord.length > 1) {
              const suggestions = AUTO_SUGGESTION_KEYWORDS.filter(keyword => 
                  keyword.startsWith(lastWord) && !prompt.toLowerCase().includes(keyword)
              ).slice(0, 5); // Limit to 5 suggestions

              suggestions.forEach(suggestion => {
                  const tag = document.createElement('button');
                  tag.className = 'suggestion-tag';
                  tag.textContent = suggestion;
                  tag.onclick = () => {
                      // Replace the last partial word with the full suggestion
                      currentWords[currentWords.length - 1] = suggestion;
                      promptInput.value = currentWords.join(' ') + ' ';
                      promptInput.focus();
                      // Trigger input event to update everything
                      promptInput.dispatchEvent(new Event('input', { bubbles: true }));
                  };
                  autoSuggestionsContainer.appendChild(tag);
              });
          }
      });
      
      clearPromptBtn.addEventListener('click', () => {
          promptInput.value = '';
          // Trigger input event to update everything
          promptInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
  }

  // Style starter buttons logic
  const styleStarterBtns = document.querySelectorAll('#style-starters .style-btn');
  if (styleStarterBtns.length > 0) {
      styleStarterBtns.forEach(button => {
          button.addEventListener('click', () => {
              if (promptInput) {
                  const promptText = (button as HTMLButtonElement).dataset.prompt || '';
                  promptInput.value = promptText;
                  // Trigger input event to update character count, suggestions, etc.
                  promptInput.dispatchEvent(new Event('input', { bubbles: true }));
                  promptInput.focus();
              }
          });
          
          // Tooltip logic
          if (tooltip) {
            button.addEventListener('mouseenter', (e) => {
                const target = e.currentTarget as HTMLButtonElement;
                const promptText = target.dataset.prompt;
                if (!promptText) return;

                tooltip.textContent = promptText;
                
                const rect = target.getBoundingClientRect();
                tooltip.style.top = `${rect.top - 8}px`; 
                tooltip.style.left = `${rect.left + rect.width / 2}px`;
                tooltip.classList.add('visible');
            });

            button.addEventListener('mouseleave', () => {
                tooltip.classList.remove('visible');
            });
          }
      });
  }
  
  // Variations slider logic
  if (variationsSlider && variationsValue) {
    variationsSlider.addEventListener('input', () => {
        numberOfVariations = parseInt(variationsSlider.value, 10);
        variationsValue.textContent = variationsSlider.value;
    });
  }

  // Modal logic
  modalCloseBtn?.addEventListener('click', () => editModal?.classList.add('hidden'));
  editModal?.addEventListener('click', (e) => {
      if (e.target === editModal) {
          editModal.classList.add('hidden');
      }
  });

  filterControls?.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      if (target.classList.contains('filter-btn') && modalImage) {
          const filterStr = target.dataset.filter || '';
          const match = filterStr.match(/(\w+)\((.+)\)/);
          if (match) {
              updateFilter(match[1], match[2]);
          }
      }
  });

  saturateSlider?.addEventListener('input', () => {
      if (!saturateSlider || !saturateValue) return;
      const value = saturateSlider.value;
      saturateValue.textContent = parseFloat(value).toFixed(1);
      updateFilter('saturate', value);
  });

  resetFiltersBtn?.addEventListener('click', () => {
      // Re-initialize the history to its original state for this session, clearing the stack.
      editHistory = ['none'];
      historyIndex = 0;
      applyHistoryState(); // This applies the 'none' filter and updates UI
  });
  
  undoBtn?.addEventListener('click', () => {
      if (historyIndex > 0) {
          historyIndex--;
          applyHistoryState();
      }
  });

  redoBtn?.addEventListener('click', () => {
      if (historyIndex < editHistory.length - 1) {
          historyIndex++;
          applyHistoryState();
      }
  });

  // Modal download logic
  modalDownloadBtn?.addEventListener('click', () => downloadEditedImage('png'));
  downloadAsJpegBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      downloadEditedImage('jpeg');
  });
  downloadOptionsToggle?.addEventListener('click', (e) => {
      e.stopPropagation(); 
      downloadOptionsMenu?.classList.toggle('hidden');
  });
  window.addEventListener('click', () => {
      if (downloadOptionsMenu && !downloadOptionsMenu.classList.contains('hidden')) {
          downloadOptionsMenu.classList.add('hidden');
      }
  });


  // Theme switcher logic
  themeToggle?.addEventListener('change', () => {
      setTheme(themeToggle.checked ? 'light' : 'dark');
  });
});