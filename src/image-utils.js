/**
 * Moon OCR Reader — Image Utilities
 * Client-side image pre-processing for OCR performance optimization
 */

/**
 * Resize an image if it exceeds maxDimension, using OffscreenCanvas for performance.
 * Returns the original file if no resize is needed.
 * @param {File} file - Original image file
 * @param {number} maxDimension - Maximum width or height (default: 2000)
 * @returns {Promise<File>} - Resized file (or original if within limits)
 */
export async function resizeForOcr(file, maxDimension = 2000) {
  try {
    const img = await createImageBitmap(file);

    // Skip resize if already within limits
    if (img.width <= maxDimension && img.height <= maxDimension) {
      img.close();
      return file;
    }

    const scale = maxDimension / Math.max(img.width, img.height);
    const newWidth = Math.round(img.width * scale);
    const newHeight = Math.round(img.height * scale);

    const canvas = new OffscreenCanvas(newWidth, newHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, newWidth, newHeight);
    img.close();

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    return new File([blob], file.name, { type: 'image/jpeg' });
  } catch {
    // Fallback: return original file if resize fails
    return file;
  }
}

/**
 * Generate a SHA-256 hash for a file (used for result caching)
 * @param {File} file
 * @returns {Promise<string>} hex hash string
 */
export async function getFileHash(file) {
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
