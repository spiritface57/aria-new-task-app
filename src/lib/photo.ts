// Photos are shrunk on the phone before upload: about 150–300 KB instead of
// 3–5 MB, which keeps the free 1 GB of storage enough for thousands of photos.
const MAX_SIDE = 1280;

export async function shrinkPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);   // applies the photo's rotation
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.72));
  if (!blob) throw new Error('Could not read this photo. Try taking it again.');
  return blob;
}
