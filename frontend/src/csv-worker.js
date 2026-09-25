import { parseCSV } from "./csv.js";

self.onmessage = async ({ data: file }) => {
  try {
    self.postMessage({ dataset: parseCSV(await file.text(), file.name) });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
