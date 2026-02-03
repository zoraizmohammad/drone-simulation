"""
Flower Detection Model
----------------------
YOLOv8-based flower detection model.

Architecture choice: YOLOv8 Nano (yolov8n)
  - Parameters:  3.2M
  - Size:        6.3MB
  - COCO mAP50:  37.3
  - RPi4 speed:  ~8-12 FPS at 640×640 (CPU, INT8 quantized)
  - Good enough for flowers which are large, colorful, and distinct

Fine-tuning approach:
  1. Start from yolov8n pretrained on COCO (general objects)
  2. Replace head: 80 COCO classes → 3 flower classes
  3. Fine-tune on labeled flower dataset (~500-2000 images)
  4. Export to ONNX for RPi deployment

Dataset recommendations:
  - Oxford 102 Flowers (17/102 classes relevant to garden pollinators)
  - iNaturalist plant observations
  - Custom dataset: photograph with the same downward-facing camera you
    will use on the drone — same resolution, angle, lighting conditions
  - Roboflow has several pre-labeled "flower detection" datasets
    (search "flower detection" at roboflow.com/universe)

Labeling tip: When labeling aerial/overhead flower images, label the
entire visible flower head (including petals) with a tight bounding box.
Do NOT label the stem — stems look too similar to grass from above.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

import yaml
from loguru import logger


class FlowerDetectionModel:
    """
    Wrapper around YOLOv8 for flower detection.
    Handles training, evaluation, and ONNX export.
    """

    def __init__(self, config_path: str = "config/model_config.yaml"):
        with open(config_path) as f:
            self.cfg = yaml.safe_load(f)["model"]
        self.train_cfg = yaml.safe_load(open(config_path))["training"]

        self._model = None
        self.weights_path = self.cfg["weights_path"]
        self.onnx_path = self.cfg["onnx_path"]

    def load(self, weights: Optional[str] = None) -> "FlowerDetectionModel":
        """Load an existing model from weights file."""
        from ultralytics import YOLO

        path = weights or self.weights_path
        if not Path(path).exists():
            logger.warning(f"Weights not found at {path} — using pretrained {self.cfg['architecture']}")
            path = self.cfg["architecture"]   # Download pretrained from ultralytics

        self._model = YOLO(path)
        logger.info(f"Model loaded: {path}")
        return self

    def train(
        self,
        dataset_yaml: str,
        resume: bool = False,
        device: str = "cpu",
    ) -> Path:
        """
        Fine-tune YOLOv8 on the flower dataset.

        Args:
            dataset_yaml: Path to YOLO-format dataset.yaml file.
                          See ml/data/flowers/dataset.yaml for format.
            resume:       Continue from last checkpoint.
            device:       "cpu", "0" (GPU), "mps" (Apple Silicon).

        Returns:
            Path to best.pt weights file.

        Training time estimates:
          - 100 epochs, 1000 images, CPU-only: ~4 hours
          - 100 epochs, 1000 images, GPU:       ~15 minutes
          - Fine-tune on RPi (not recommended): extremely slow
          Train on a laptop/desktop, then copy best.pt to RPi.
        """
        from ultralytics import YOLO
        t = self.train_cfg

        # Start from pretrained base
        model = YOLO(self.cfg["architecture"])
        logger.info(f"Starting training: {t['epochs']} epochs, dataset={dataset_yaml}")

        results = model.train(
            data=dataset_yaml,
            epochs=t["epochs"],
            imgsz=t["image_size"],
            batch=t["batch_size"],
            lr0=t["learning_rate"],
            momentum=t["momentum"],
            weight_decay=t["weight_decay"],
            patience=t["patience"],
            device=device,
            resume=resume,
            # Augmentation — critical for aerial flower images
            degrees=t["augmentation"]["degrees"],
            flipud=t["augmentation"]["flipud"],
            fliplr=t["augmentation"]["fliplr"],
            hsv_h=t["augmentation"]["hsv_h"],
            hsv_s=t["augmentation"]["hsv_s"],
            hsv_v=t["augmentation"]["hsv_v"],
            mosaic=t["augmentation"]["mosaic"],
            # Save to ml/weights/
            project="ml/weights",
            name="flower_model",
            exist_ok=True,
        )

        best_weights = Path(results.save_dir) / "weights" / "best.pt"
        logger.info(f"Training complete. Best weights: {best_weights}")

        # Copy to expected location
        import shutil
        Path(self.weights_path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(best_weights, self.weights_path)

        return best_weights

    def evaluate(self, dataset_yaml: str) -> dict:
        """Run validation on the test split and return metrics."""
        if self._model is None:
            self.load()

        logger.info("Evaluating model...")
        metrics = self._model.val(data=dataset_yaml)

        results = {
            "mAP50":    metrics.box.map50,
            "mAP50_95": metrics.box.map,
            "precision": metrics.box.p.mean(),
            "recall":    metrics.box.r.mean(),
        }

        logger.info(f"mAP50={results['mAP50']:.3f} mAP50-95={results['mAP50_95']:.3f} "
                    f"P={results['precision']:.3f} R={results['recall']:.3f}")
        return results

    def export_onnx(self, output_path: Optional[str] = None) -> str:
        """
        Export model to ONNX format for optimized RPi deployment.

        ONNX runtime on RPi4 is 2-3x faster than PyTorch for inference.

        For even faster inference (at slight accuracy cost), you can also
        quantize to INT8:
            yolo export model=flower_model.pt format=onnx int8=True
        """
        if self._model is None:
            self.load()

        out = output_path or self.onnx_path
        Path(out).parent.mkdir(parents=True, exist_ok=True)

        logger.info(f"Exporting to ONNX: {out}")
        self._model.export(
            format="onnx",
            imgsz=self.train_cfg["image_size"],
            simplify=True,      # Simplify ONNX graph for faster inference
            dynamic=False,      # Static batch size (1) for RPi
            opset=12,           # ONNX opset 12 is well-supported
        )

        # Ultralytics saves alongside the .pt file — move to desired location
        pt_path = Path(self.weights_path)
        default_onnx = pt_path.with_suffix(".onnx")
        if default_onnx.exists() and str(default_onnx) != out:
            import shutil
            shutil.move(str(default_onnx), out)

        logger.info(f"ONNX export complete: {out}")
        return out

    def benchmark_rpi(self, num_frames: int = 100) -> dict:
        """
        Benchmark inference speed with dummy frames.
        Run this on the actual RPi4 to measure real performance.
        """
        import time
        import numpy as np

        logger.info(f"Benchmarking {num_frames} frames...")

        # Simulate camera frames
        dummy_frames = [
            np.random.randint(0, 255, (640, 640, 3), dtype=np.uint8)
            for _ in range(num_frames)
        ]

        if self.cfg["use_onnx"]:
            import onnxruntime as ort
            session = ort.InferenceSession(
                self.onnx_path,
                providers=["CPUExecutionProvider"],
            )
            input_name = session.get_inputs()[0].name

            t0 = time.perf_counter()
            for frame in dummy_frames:
                img = frame.astype(np.float32) / 255.0
                img = np.transpose(img, (2, 0, 1))[np.newaxis]
                session.run(None, {input_name: img})
            elapsed = time.perf_counter() - t0
        else:
            if self._model is None:
                self.load()
            t0 = time.perf_counter()
            for frame in dummy_frames:
                self._model(frame, verbose=False)
            elapsed = time.perf_counter() - t0

        fps = num_frames / elapsed
        ms_per_frame = elapsed / num_frames * 1000

        results = {
            "fps": fps,
            "ms_per_frame": ms_per_frame,
            "backend": "ONNX" if self.cfg["use_onnx"] else "PyTorch",
        }
        logger.info(f"Benchmark: {fps:.1f} FPS ({ms_per_frame:.1f}ms/frame) [{results['backend']}]")
        return results
