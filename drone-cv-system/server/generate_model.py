"""
Generates a minimal ONNX model for flower detection.

Primary path:   uses Ultralytics YOLOv8n (downloads pretrained COCO weights)
Fallback path:  builds a minimal valid ONNX graph with onnx library that
                returns zero-detection tensors (mock bridge handles detection)

Usage:
    python3 drone-cv-system/server/generate_model.py
"""

from __future__ import annotations
import os
import sys
import shutil
import logging

logging.basicConfig(level=logging.INFO, format='%(levelname)s  %(message)s')
log = logging.getLogger(__name__)

HERE     = os.path.dirname(os.path.abspath(__file__))
ROOT     = os.path.join(HERE, '..', '..')
MODELS   = os.path.join(HERE, '..', 'models')
OUT_PATH = os.path.join(MODELS, 'flower_detector.onnx')


def generate_yolov8n() -> str:
    """Download YOLOv8n pretrained weights and export to ONNX."""
    from ultralytics import YOLO  # type: ignore

    log.info('Loading YOLOv8n pretrained weights (downloads ~6 MB if absent)…')
    model = YOLO('yolov8n.pt')

    log.info('Exporting to ONNX (opset 11, imgsz 640)…')
    # Export writes to the CWD; we move it afterwards
    export_result = model.export(format='onnx', simplify=True, imgsz=640, opset=11)

    # Ultralytics returns the output path
    src = str(export_result) if export_result else 'yolov8n.onnx'
    if not os.path.exists(src):
        src = 'yolov8n.onnx'

    os.makedirs(MODELS, exist_ok=True)
    shutil.move(src, OUT_PATH)
    log.info(f'✓  YOLOv8n ONNX saved → {OUT_PATH}')
    return OUT_PATH


def generate_minimal_onnx() -> str:
    """
    Build a minimal but valid ONNX model that returns an empty detection
    tensor in YOLOv8 output format [1, 84, 8400].
    The mock bridge will supply actual detections; this model satisfies
    the interface contract so the bridge can load and call it without error.
    """
    import onnx  # type: ignore
    from onnx import helper, TensorProto, numpy_helper  # type: ignore
    import numpy as np

    log.info('Building minimal ONNX pass-through model…')

    input_shape  = [1, 3, 640, 640]
    output_shape = [1, 84, 8400]

    # Constant zeros output (no detections)
    zero_tensor = numpy_helper.from_array(
        np.zeros(output_shape, dtype=np.float32),
        name='zero_detections',
    )

    node = helper.make_node(
        'Constant',
        inputs=[],
        outputs=['output0'],
        value=zero_tensor,
    )

    graph = helper.make_graph(
        [node],
        'flower_detector_minimal',
        [helper.make_tensor_value_info('images',  TensorProto.FLOAT, input_shape)],
        [helper.make_tensor_value_info('output0', TensorProto.FLOAT, output_shape)],
    )

    opset = helper.make_opsetid('', 11)
    model = helper.make_model(graph, opset_imports=[opset])
    model.ir_version = 7
    model.doc_string = (
        'Minimal flower detector stub. '
        'Returns zero-detection tensor; detection_bridge mock fills real results.'
    )

    os.makedirs(MODELS, exist_ok=True)
    onnx.save(model, OUT_PATH)
    log.info(f'✓  Minimal ONNX model saved → {OUT_PATH}')
    return OUT_PATH


def main() -> None:
    if os.path.exists(OUT_PATH):
        log.info(f'Model already exists at {OUT_PATH} — delete it to regenerate.')
        return

    # Try YOLOv8n first (best for actual inference on synthetic frames)
    try:
        generate_yolov8n()
        return
    except ImportError:
        log.warning('ultralytics not installed — trying minimal ONNX fallback…')
    except Exception as e:
        log.warning(f'YOLOv8n export failed ({e}) — trying minimal ONNX fallback…')

    # Fall back to minimal ONNX model
    try:
        generate_minimal_onnx()
    except ImportError:
        log.error(
            'onnx package not installed.\n'
            'Install with:  pip install onnx\n'
            'Or for full model:  pip install ultralytics'
        )
        sys.exit(1)


if __name__ == '__main__':
    main()
