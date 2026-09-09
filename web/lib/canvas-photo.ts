export type PhotoBounds = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

/** Fit images to the page; dropped images are centred at the page-local pointer. */
export function photoBounds(width: number, height: number, page: { width: number; height: number }, point?: Point): PhotoBounds {
  const ratio = Math.min(1, (page.width - 80) / width, (page.height - 80) / height);
  const w = width * ratio, h = height * ratio;
  return { width: w, height: h,
    x: Math.max(0, Math.min(page.width - w, (point?.x ?? page.width / 2) - w / 2)),
    y: Math.max(0, Math.min(page.height - h, (point?.y ?? page.height / 2) - h / 2)) };
}

/** Use the current page rectangle so viewport scroll and zoom cannot offset a drop. */
export function photoDropPoint(client: Point, rect: PhotoBounds, page: { width: number; height: number }): Point {
  return { x: Math.max(0, Math.min(page.width, (client.x - rect.x) * page.width / rect.width)),
    y: Math.max(0, Math.min(page.height, (client.y - rect.y) * page.height / rect.height)) };
}

export type PhotoError = "photoInvalid" | "photoTooLarge" | "photoFailed";
export class CanvasPhotoError extends Error {
  readonly issue: PhotoError;
  constructor(issue: PhotoError) { super(issue); this.issue = issue; }
}

export async function readCanvasPhoto(file: File) {
  if (file.size > 20 * 1024 * 1024) throw new CanvasPhotoError("photoTooLarge");
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte);
  const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
  if (!png && !jpeg) throw new CanvasPhotoError("photoInvalid");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new CanvasPhotoError("photoFailed"));
    reader.onabort = () => reject(new CanvasPhotoError("photoFailed"));
    reader.readAsDataURL(new Blob([file], { type: png ? "image/png" : "image/jpeg" }));
  });
  const image = new window.Image(); image.src = dataUrl;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) throw new CanvasPhotoError("photoFailed");
  return { dataUrl, width: image.naturalWidth, height: image.naturalHeight };
}
