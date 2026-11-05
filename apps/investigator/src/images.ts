const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export function imageToDataUrl(path: string, bytes: Uint8Array): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME_BY_EXTENSION[extension];
  if (!mime) throw new Error(`Unsupported image type ".${extension}" (use png, jpg, webp or gif): ${path}`);
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}
