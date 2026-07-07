export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read image file as a data URL.'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
}

export function readImageDimensions(src: string): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(undefined);
    image.src = src;
  });
}

export function fitImageBlockSize(width?: number, height?: number): { width: number; height: number } {
  if (!width || !height || width <= 0 || height <= 0) return { width: 300, height: 230 };

  const maxWidth = 640;
  const maxImageHeight = 520;
  const minWidth = 240;
  const minImageHeight = 180;
  const blockChromeHeight = 38;
  const ratio = width / height;
  let nextWidth = maxWidth;
  let nextHeight = nextWidth / ratio;

  if (nextHeight > maxImageHeight) {
    nextHeight = maxImageHeight;
    nextWidth = nextHeight * ratio;
  }

  if (nextWidth < minWidth) {
    nextWidth = minWidth;
    nextHeight = nextWidth / ratio;
  }

  if (nextHeight < minImageHeight) {
    nextHeight = minImageHeight;
    nextWidth = nextHeight * ratio;
  }

  return {
    width: Math.round(Math.min(nextWidth, maxWidth)),
    height: Math.round(Math.min(nextHeight, maxImageHeight) + blockChromeHeight),
  };
}
