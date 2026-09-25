import { parseCSV } from "./csv.js";

// Deterministic synthetic examples, explicitly labelled in the UI.
export function demoDatasets() {
  return [
    { name: "UNet", file: "unet.csv", length: 60, base: 0.79, phase: 1 },
    { name: "UNet++", file: "unetpp.csv", length: 54, base: 0.83, phase: 2 },
    {
      name: "SegFormer",
      file: "segformer.csv",
      length: 48,
      base: 0.88,
      phase: 3,
    },
  ].map((model, i) => {
    const lines = [
      "epoch,train_loss,val_loss,val_iou,val_f1,val_precision,val_recall",
    ];
    for (let epoch = 1; epoch <= model.length; epoch++) {
      const noise =
        Math.sin(epoch * 1.73 + model.phase) * 0.027 * Math.exp(-epoch / 45);
      const iou = model.base - 0.53 * Math.exp(-epoch / 10) + noise;
      lines.push(
        [
          epoch,
          0.64 * Math.exp(-epoch / 17) + 0.09 + noise / 3,
          0.52 * Math.exp(-epoch / 15) + 0.16 - i * 0.017 + noise,
          iou,
          (2 * iou) / (1 + iou),
          0.91 - 0.36 * Math.exp(-epoch / 12) + noise,
          0.89 - 0.3 * Math.exp(-epoch / 11) - noise,
        ]
          .map((v, j) => (j ? v.toFixed(6) : v))
          .join(","),
      );
    }
    return {
      ...parseCSV(lines.join("\n"), model.file),
      name: model.name,
      id: `demo${i}`,
      demo: true,
    };
  });
}
