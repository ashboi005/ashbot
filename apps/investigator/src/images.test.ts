import { expect, test } from "bun:test";

import { imageToDataUrl } from "./images";

test("encodes supported images as data URLs", () => {
  expect(imageToDataUrl("shot.PNG", new Uint8Array([1, 2, 3]))).toBe("data:image/png;base64,AQID");
  expect(imageToDataUrl("photo.jpeg", new Uint8Array([1]))).toStartWith("data:image/jpeg;base64,");
});

test("rejects unsupported file types", () => {
  expect(() => imageToDataUrl("notes.pdf", new Uint8Array([1]))).toThrow("Unsupported image type");
});
