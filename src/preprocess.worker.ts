self.onmessage = async (e: MessageEvent) => {
  try {
    const {
      bitmap,
      rotation = 0,
      contrast = 1.25,
      brightness = 0,
      threshold = false,
      denoise = false,
      crop,
    } = e.data;
    const rotate = rotation % 180 !== 0;
    const cw = crop ? Math.max(1, bitmap.width * (crop.w / 100)) : bitmap.width;
    const ch = crop ? Math.max(1, bitmap.height * (crop.h / 100)) : bitmap.height;
    const scale = Math.min(1, 2800 / Math.max(cw, ch));
    const w = Math.round(cw * scale),
      h = Math.round(ch * scale);
    const canvas = new OffscreenCanvas(rotate ? h : w, rotate ? w : h);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(
      bitmap,
      crop ? (bitmap.width * crop.x) / 100 : 0,
      crop ? (bitmap.height * crop.y) / 100 : 0,
      cw,
      ch,
      -w / 2,
      -h / 2,
      w,
      h,
    );
    bitmap.close();
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const src = new Uint8ClampedArray(image.data);
    const width = canvas.width;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        let gray = 0,
          count = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx,
              yy = y + dy;
            if (xx >= 0 && xx < width && yy >= 0 && yy < canvas.height) {
              const j = (yy * width + xx) * 4;
              gray += src[j] * 0.299 + src[j + 1] * 0.587 + src[j + 2] * 0.114;
              count++;
            }
          }
        gray = denoise ? gray / count : src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
        gray = Math.max(0, Math.min(255, (gray - 128) * contrast + 128 + brightness));
        if (threshold) gray = gray > 155 ? 255 : 0;
        image.data[i] = image.data[i + 1] = image.data[i + 2] = gray;
      }
    }
    ctx.putImageData(image, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    self.postMessage({ blob });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
