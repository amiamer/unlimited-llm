"""
Surya OCR PDF Extraction Service

Pipeline:
  1. Render pages, detect and split two-page spreads (gutter detection)
  2. OCR all pages with Surya
  3. Cross-page pattern detection (repeating headers/footers, page numbers)
  4. Assemble clean text per page

Setup:
  conda create -n surya python=3.11
  conda activate surya
  pip install surya-ocr flask pypdfium2 requests

Run:
  conda activate surya && python scripts/pdf-server.py

Environment:
  PDF_SERVER_PORT (default: 8100)
"""

import os
import sys
import re
import tempfile
import traceback
from collections import Counter
from flask import Flask, request, jsonify

app = Flask(__name__)

# ─── Load Surya models ────────────────────────────────────────────────────────

print("Loading Surya OCR models (this may take a minute on first run)...")
try:
    from surya.foundation import FoundationPredictor
    from surya.detection import DetectionPredictor
    from surya.recognition import RecognitionPredictor
    foundation_predictor = FoundationPredictor()
    detection_predictor = DetectionPredictor()
    recognition_predictor = RecognitionPredictor(foundation_predictor)
    print("Surya OCR models loaded successfully.")
except Exception as e:
    print(f"Failed to load Surya OCR models: {e}")
    sys.exit(1)

try:
    import pypdfium2 as pdfium
except ImportError:
    print("pypdfium2 not installed. Install with: pip install pypdfium2")
    sys.exit(1)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def get_bbox(obj):
    """Extract [x1, y1, x2, y2] from a Surya object."""
    try:
        if hasattr(obj, 'bbox'):
            return list(obj.bbox)
        if hasattr(obj, 'polygon') and obj.polygon:
            xs = [p[0] for p in obj.polygon]
            ys = [p[1] for p in obj.polygon]
            return [min(xs), min(ys), max(xs), max(ys)]
        if isinstance(obj, (list, tuple)) and len(obj) >= 4:
            return list(obj[:4])
    except (IndexError, TypeError, AttributeError):
        pass
    return None


# ─── Spread detection ─────────────────────────────────────────────────────────

def find_spread_split(image):
    """Detect two-page spread via vertical gutter analysis."""
    w, h = image.size
    if w / h < 1.1:
        return None

    try:
        det_results = detection_predictor([image])
        bboxes = det_results[0].bboxes
    except Exception:
        return None

    if not bboxes:
        return None

    num_bins = 200
    bin_width = w / num_bins
    coverage = [0] * num_bins

    for bbox in bboxes:
        coords = get_bbox(bbox)
        if not coords:
            continue
        start_bin = max(0, int(coords[0] / bin_width))
        end_bin = min(num_bins - 1, int(coords[2] / bin_width))
        for b in range(start_bin, end_bin + 1):
            coverage[b] += 1

    center_start = int(num_bins * 0.35)
    center_end = int(num_bins * 0.65)
    threshold = max(1, max(coverage) * 0.05)

    best_gap_start = best_gap_end = -1
    best_gap_len = 0
    gap_start = -1

    for b in range(center_start, center_end + 1):
        if coverage[b] <= threshold:
            if gap_start == -1:
                gap_start = b
        else:
            if gap_start != -1:
                gap_len = b - gap_start
                if gap_len > best_gap_len:
                    best_gap_len = gap_len
                    best_gap_start = gap_start
                    best_gap_end = b
                gap_start = -1

    if gap_start != -1:
        gap_len = center_end + 1 - gap_start
        if gap_len > best_gap_len:
            best_gap_len = gap_len
            best_gap_start = gap_start
            best_gap_end = center_end + 1

    min_gap_bins = max(3, int(num_bins * 0.015))
    if best_gap_len >= min_gap_bins:
        split_bin = (best_gap_start + best_gap_end) // 2
        return int(split_bin * bin_width)

    return None


def pdf_to_images(pdf_path):
    """Convert PDF pages to images, splitting spreads at the gutter."""
    doc = pdfium.PdfDocument(pdf_path)
    images = []
    for i in range(len(doc)):
        page = doc[i]
        bitmap = page.render(scale=2)
        pil_image = bitmap.to_pil()

        split_x = find_spread_split(pil_image)
        if split_x is not None:
            w, h = pil_image.size
            left = pil_image.crop((0, 0, split_x, h))
            right = pil_image.crop((split_x, 0, w, h))
            if left.size[0] > w * 0.2:
                images.append(left)
            if right.size[0] > w * 0.2:
                images.append(right)
            print(f"  Page {i}: spread, split at x={split_x}/{w}")
        else:
            images.append(pil_image)
            print(f"  Page {i}: single")

    doc.close()
    return images


# ─── OCR ──────────────────────────────────────────────────────────────────────

def ocr_all_pages(images):
    """Run Surya OCR on all images. Returns list of page dicts."""
    all_pages = []
    for idx, image in enumerate(images):
        img_w, img_h = image.size
        try:
            preds = recognition_predictor([image], det_predictor=detection_predictor)
            lines = []
            for tl in preds[0].text_lines:
                text = tl.text.strip()
                if not text:
                    continue
                conf = getattr(tl, 'confidence', 1.0)
                bbox = get_bbox(tl)
                y_pct = round(bbox[1] / img_h * 100, 1) if bbox else None
                lines.append({"text": text, "confidence": round(conf, 3), "bbox": bbox, "y_pct": y_pct})

            all_pages.append({"page": idx, "img_w": img_w, "img_h": img_h, "lines": lines})
            print(f"  Page {idx}: {len(lines)} lines")
        except Exception as e:
            print(f"  Page {idx}: error — {e}")
            all_pages.append({"page": idx, "img_w": img_w, "img_h": img_h, "lines": [], "error": str(e)})
    return all_pages


# ─── Cross-page pattern detection ─────────────────────────────────────────────

def detect_patterns(all_pages):
    """Find repeating headers/footers and page numbers across pages.

    Returns a set of text strings to remove.
    """
    remove_texts = set()
    total = len(all_pages)

    if total < 3:
        return remove_texts

    # Collect text at edges (top 8%, bottom 8%) across all pages
    edge_texts = {"top": [], "bottom": []}
    for pg in all_pages:
        for line in pg["lines"]:
            y = line["y_pct"]
            if y is None:
                continue
            if y < 8:
                edge_texts["top"].append(line["text"])
            elif y > 92:
                edge_texts["bottom"].append(line["text"])

    # Text repeating in 30%+ of pages at edges → running header/footer
    min_count = max(2, int(total * 0.3))
    for zone in ("top", "bottom"):
        for text, count in Counter(edge_texts[zone]).items():
            if count >= min_count:
                remove_texts.add(text)

    # Page numbers: short edge text that forms an incrementing sequence
    for zone in ("top", "bottom"):
        nums = []
        num_texts = []
        for pg in all_pages:
            for line in pg["lines"]:
                y = line["y_pct"]
                if y is None:
                    continue
                if (zone == "top" and y < 8) or (zone == "bottom" and y > 92):
                    cleaned = re.sub(r'[^0-9]', '', line["text"])
                    if cleaned and len(line["text"]) <= 6:
                        try:
                            nums.append(int(cleaned))
                            num_texts.append(line["text"])
                        except ValueError:
                            pass

        if len(nums) >= 3:
            sorted_nums = sorted(nums)
            diffs = [sorted_nums[i+1] - sorted_nums[i] for i in range(len(sorted_nums)-1)]
            sequential = sum(1 for d in diffs if 0 < d <= 2)
            if sequential >= len(diffs) * 0.5:
                remove_texts.update(num_texts)
                break

    if remove_texts:
        print(f"  Patterns found: {len(remove_texts)} texts to remove")
        print(f"    Samples: {list(remove_texts)[:5]}")
    else:
        print("  No cross-page patterns found")

    return remove_texts


# ─── Assemble clean text ──────────────────────────────────────────────────────

def clean_page(lines, remove_texts):
    """Remove pattern-matched lines and join the rest."""
    kept = [l["text"] for l in lines if l["text"] not in remove_texts]
    return " ".join(kept)


# ─── Main pipeline ────────────────────────────────────────────────────────────

def extract_text_from_pdf(pdf_path):
    """Full extraction pipeline: split spreads → OCR → pattern cleanup."""
    print("Step 1: Rendering pages & detecting spreads...")
    images = pdf_to_images(pdf_path)
    if not images:
        return {"pages": []}

    print(f"Step 2: OCR on {len(images)} pages...")
    all_pages = ocr_all_pages(images)

    print("Step 3: Cross-page pattern detection...")
    remove_texts = detect_patterns(all_pages)

    print("Step 4: Assembling clean text...")
    result_pages = []
    for pg in all_pages:
        if pg.get("error"):
            result_pages.append({"page": pg["page"], "text": "", "lines": [], "error": pg["error"]})
            continue

        clean_text = clean_page(pg["lines"], remove_texts)
        removed = sum(1 for l in pg["lines"] if l["text"] in remove_texts)

        result_pages.append({
            "page": pg["page"],
            "text": clean_text,
            "lines": [{"text": l["text"], "confidence": l["confidence"]} for l in pg["lines"]],
        })
        if removed:
            print(f"  Page {pg['page']}: removed {removed} lines")

    print(f"Done. {len(result_pages)} pages.")
    return {"pages": result_pages}


# ─── Flask routes ─────────────────────────────────────────────────────────────

@app.route("/extract", methods=["POST"])
def extract():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "File must be a PDF"}), 400

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        file.save(tmp.name)
        tmp_path = tmp.name

    try:
        result = extract_text_from_pdf(tmp_path)
        return jsonify(result)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Extraction failed: {str(e)}"}), 500
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "surya-ocr"})


if __name__ == "__main__":
    port = int(os.environ.get("PDF_SERVER_PORT", 8100))
    # Loopback only — no auth on this service, keep it off the LAN.
    host = os.environ.get("PDF_SERVER_HOST", "127.0.0.1")
    print(f"Starting Surya OCR service on {host}:{port}")
    app.run(host=host, port=port, debug=False)
