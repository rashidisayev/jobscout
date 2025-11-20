# ONNX Model Setup (Optional)

For full dense embedding support, you can download and add ONNX models here.

## Recommended Models

1. **all-MiniLM-L6-v2** (Recommended - Small, Fast)
   - Download: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
   - Convert to ONNX format
   - Place in: `vendor/onnx/all-MiniLM-L6-v2.onnx`

2. **e5-small** (Alternative)
   - Download: https://huggingface.co/intfloat/e5-small
   - Convert to ONNX format
   - Place in: `vendor/onnx/e5-small.onnx`

## Setup Instructions

1. Install ONNX runtime for web:
   ```bash
   npm install onnxruntime-web
   ```

2. Include in `options.html`:
   ```html
   <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js"></script>
   ```

3. Download and convert model to ONNX format (if not already available)

4. Place model file in `vendor/onnx/` directory

5. Update `manifest.json` to include model files in `web_accessible_resources`

## Fallback Behavior

If ONNX models are not available, the extension will use a TF-IDF-based fallback embedding system that still provides reasonable semantic matching.

## Performance

- Model size: ~80-90MB (all-MiniLM-L6-v2)
- Inference time: ~50-100ms per text on modern hardware
- Embeddings are cached to avoid recomputation

