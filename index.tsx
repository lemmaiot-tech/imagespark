/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Modality } from '@google/genai';
import { usageManager } from './usageManager.js';

// State variables
let uploadedImage: {
  base64: string;
  mimeType: string;
} | null = null;
let selectedPrompt = '';

// DOM element references
const fileUploadInput = document.getElementById('file-upload') as HTMLInputElement;
const generateBtn = document.getElementById('generate-btn') as HTMLButtonElement;
const originalImagePreview = document.getElementById('original-image-preview');
const imageGallery = document.getElementById('image-gallery');
const loader = document.getElementById('loader');
const styleSelector = document.getElementById('style-selector');
const negativePromptInput = document.getElementById('negative-prompt-input') as HTMLInputElement;
const editModal = document.getElementById('edit-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalImage = document.getElementById('modal-image') as HTMLImageElement;
const filterControls = document.querySelector('.filter-controls');
const resetFiltersBtn = document.getElementById('reset-filters-btn');
const modalDownloadBtn = document.getElementById('modal-download-btn');
const themeToggle = document.getElementById('theme-toggle') as HTMLInputElement;
const tooltip = document.getElementById('tooltip');
const saturateSlider = document.getElementById('saturate-slider') as HTMLInputElement;
const saturateValue = document.getElementById('saturate-value');
const downloadOptionsToggle = document.getElementById('download-options-toggle');
const downloadOptionsMenu = document.getElementById('download-options-menu');
const downloadAsJpegBtn = document.getElementById('download-as-jpeg');
const usageCounter = document.getElementById('usage-counter');


// Initialize the Google AI client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const model = 'gemini-2.5-flash-image-preview';


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
    // If limit is not reached, the button state depends on other conditions
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
    // Fix: Corrected typo from readDataURL to readAsDataURL.
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
  
  if (originalImagePreview) {
    const previewImg = document.createElement('img');
    previewImg.src = URL.createObjectURL(file);
    previewImg.onload = () => URL.revokeObjectURL(previewImg.src);
    originalImagePreview.innerHTML = '';
    originalImagePreview.appendChild(previewImg);

    try {
      uploadedImage = await fileToGenerativePart(file);
      updateUsageUI();
    } catch (error) {
      console.error("Error processing file:", error);
      uploadedImage = null;
      generateBtn.disabled = true;
      originalImagePreview.innerHTML = '<p style="color: red;">Could not process image.</p>';
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
 * Opens the editing modal with the specified image.
 * @param imageSrc The data URL of the image to edit.
 */
function openEditModal(imageSrc: string) {
  if (!modalImage || !editModal) return;
  modalImage.src = imageSrc;
  modalImage.style.filter = 'none'; // Reset filters on open
  if (saturateSlider) saturateSlider.value = '1';
  if (saturateValue) saturateValue.textContent = '1.0';
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

  // Hide dropdown if open
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
 * Handles the generate button click event.
 */
async function handleGenerateClick() {
  if (!usageManager.canGenerate()) {
    alert(`You have reached your daily generation limit of ${usageManager.getDailyLimit()}. Please try again tomorrow.`);
    updateUsageUI();
    return;
  }

  if (!uploadedImage || !imageGallery || !loader || !selectedPrompt) {
    console.error("Required elements, image data, or a prompt is missing.");
    return;
  }

  const negativePrompt = negativePromptInput?.value.trim() || '';
  let finalPrompt = selectedPrompt;
  if (negativePrompt) {
    finalPrompt += `. Avoid the following elements: ${negativePrompt}.`;
  }

  generateBtn.disabled = true;
  loader.classList.remove('hidden');
  imageGallery.innerHTML = '';

  try {
    const response = await ai.models.generateContent({
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

    if (response.candidates && response.candidates[0].content.parts) {
        let imageFound = false;
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                imageFound = true;
                const base64ImageBytes = part.inlineData.data;
                const mimeType = part.inlineData.mimeType || 'image/png';
                const imageUrl = `data:${mimeType};base64,${base64ImageBytes}`;

                const wrapper = document.createElement('div');
                wrapper.className = 'generated-image-wrapper';
                
                const img = new Image();
                img.src = imageUrl;
                img.alt = finalPrompt;

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
                downloadBtn.onclick = (e) => {
                    const currentWrapper = (e.currentTarget as HTMLElement).closest('.generated-image-wrapper');
                    const currentImg = currentWrapper?.querySelector('img');
                    if (currentImg) {
                        const a = document.createElement('a');
                        a.href = currentImg.src;
                        a.download = getFormattedFilename('png');
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                    }
                };
                
                actionsWrapper.appendChild(editBtn);
                actionsWrapper.appendChild(upscaleBtn);
                actionsWrapper.appendChild(downloadBtn);
                
                wrapper.appendChild(img);
                wrapper.appendChild(inlineSpinner);
                wrapper.appendChild(actionsWrapper);
                imageGallery.appendChild(wrapper);
            }
        }
        if (imageFound) {
            usageManager.recordGeneration();
        } else {
            imageGallery.innerHTML = '<p class="gallery-message">No images were generated. Please try a different prompt or style.</p>';
        }
    } else {
      imageGallery.innerHTML = '<p class="gallery-message">No content was generated. Please try again.</p>';
    }

  } catch (error) {
    console.error("Error generating images:", error);
    if (imageGallery) {
      imageGallery.innerHTML = `<p class="gallery-message error">Error: Could not generate images. Please try again.</p>`;
    }
  } finally {
    updateUsageUI();
    loader.classList.add('hidden');
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
}


// Attach event listeners once the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  loadTheme(); // Load theme on init
  updateUsageUI(); // Set initial usage count and button state

  if (fileUploadInput) fileUploadInput.addEventListener('change', handleFileChange);
  if (generateBtn) generateBtn.addEventListener('click', handleGenerateClick);

  // Drag and drop logic
  const dropZone = document.getElementById('original-image-container');
  if (dropZone && originalImagePreview) {
    // Prevent default browser behavior (opening file) for the whole window
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
      const droppedFiles = e.dataTransfer?.files;
      if (droppedFiles && droppedFiles.length > 0) {
        if (fileUploadInput) fileUploadInput.files = droppedFiles;
        await processFile(droppedFiles[0]);
      }
    });
  }

  // Style selector logic
  const styleButtons = styleSelector?.querySelectorAll('.style-btn');
  if (styleButtons && styleButtons.length > 0) {
      styleButtons.forEach(button => {
          button.addEventListener('click', () => {
              styleButtons.forEach(btn => btn.classList.remove('active'));
              button.classList.add('active');
              selectedPrompt = (button as HTMLButtonElement).dataset.prompt || '';
              updateUsageUI();
          });

          // Tooltip logic
          if (tooltip) {
            button.addEventListener('mouseenter', (e) => {
                const target = e.currentTarget as HTMLButtonElement;
                const promptText = target.dataset.prompt;
                if (!promptText) return;

                tooltip.textContent = promptText;
                
                const rect = target.getBoundingClientRect();
                tooltip.style.top = `${rect.top - 8}px`; // 8px spacing above
                tooltip.style.left = `${rect.left + rect.width / 2}px`;
                tooltip.classList.add('visible');
            });

            button.addEventListener('mouseleave', () => {
                tooltip.classList.remove('visible');
            });
          }
      });
  }

  // Quick suggestions logic
  const suggestionTags = document.querySelectorAll('.suggestion-tag');
  suggestionTags.forEach(tag => {
      tag.addEventListener('click', () => {
          const prompt = (tag as HTMLElement).dataset.prompt;
          const targetStyleId = (tag as HTMLElement).dataset.targetStyle;
          
          if (prompt) {
              selectedPrompt = prompt;
          }

          if (styleButtons) {
              styleButtons.forEach(btn => btn.classList.remove('active'));
              if (targetStyleId) {
                  const targetButton = document.getElementById(targetStyleId);
                  targetButton?.classList.add('active');
              }
          }
          
          updateUsageUI();
      });
  });

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
      if (modalImage) modalImage.style.filter = 'none';
      if (saturateSlider) saturateSlider.value = '1';
      if (saturateValue) saturateValue.textContent = '1.0';
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