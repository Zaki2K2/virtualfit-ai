# Dataset preparation (VITON-HD)

**Status:** the tooling is implemented and unit-tested on synthetic miniature trees. It has **not** been run on the
real VITON-HD data, which was not available in the development environment (see "Getting the data").

## Getting the data

VITON-HD is a research-only dataset (CC BY-NC 4.0; see `shadow2496/VITON-HD`, README "Dataset"): 11,647 train and 2,032 test
frontal-view woman + top pairs at 1024x768. It is **not** redistributed here and must never be committed.

Download it yourself from the link in the VITON-HD README (Google Drive). The link served an HTML page rather than the
file when probed with `curl`, so download it in a browser (or with `gdown` in Colab), unzip it, and put the folder
in Google Drive at `MyDrive/virtualfit/VITON-HD`.

## Expected layout (nothing is assumed silently)

```
VITON-HD/
  train_pairs.txt  test_pairs.txt          "person.jpg cloth.jpg" per line
  train/ image/ cloth/ agnostic-mask/ image-parse-v3/
  test/  image/ cloth/ agnostic-mask/ image-parse-v3/
```

Folder names are configurable (`DatasetLayout`). **Unverified:** I could not inspect the real archive, so the exact folder names
(`agnostic-mask` vs `image-parse-v3`, mask file suffix `_mask.png`) come from CatVTON's README and VITON-HD's `datasets.py`.
If your copy differs, `prepare` reports `missing_directory` / `missing_mask` issues instead of guessing; adjust `DatasetLayout`.

## What `prepare` does

```bash
python -m virtualfit_engine.dataset.cli prepare --root /path/to/VITON-HD --out runs/exp1/data \
       --n-train 200 --n-val 40 --n-heldout 40 --seed 42
```

| Check            | Behaviour                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pair file        | each line must be `person cloth`; duplicates in the list are reported and skipped                                                                                                                                                                                                                                                                                           |
| Files exist      | person and own-garment images must exist (`missing_person` / `missing_cloth`)                                                                                                                                                                                                                                                                                               |
| Corrupt images   | every image is fully decoded (`corrupt_person` / `corrupt_cloth`), truncated files are caught                                                                                                                                                                                                                                                                               |
| Pair consistency | training uses **paired** samples (person with their own garment, same file name); the official unpaired garment is stored as `unpaired_cloth` for qualitative tests                                                                                                                                                                                                         |
| Resolution       | recorded per sample; very small images rejected (`too_small`); everything is normalised later to 512x384 (crop person/mask, white-pad garment)                                                                                                                                                                                                                              |
| Category         | VITON-HD is upper-body only; every record is `upper_body`                                                                                                                                                                                                                                                                                                                   |
| Masks            | uses the dataset's `agnostic-mask` when present; otherwise **derives** one from the human-parsing map (labels 5, 6, 7, 14, 15 = upper-clothes, dress, coat, arms, from VITON-HD's own `datasets.py`, dilated by 8 px). The source is recorded (`mask_source`). Masks must be binary, match the person size, and cover 3-60% of the image (`bad_mask`, `mask_size_mismatch`) |
| Duplicates       | byte-identical person images are dropped (SHA-1), keeping the first                                                                                                                                                                                                                                                                                                         |
| Leakage          | an id, person image or garment image may appear in only one experiment split (`assert_no_leakage`)                                                                                                                                                                                                                                                                          |

**Mask caveat:** the parse-derived mask is an approximation of CatVTON's agnostic mask and was not validated against real data;
coverage checks only catch _broken_ masks, not anatomically wrong ones. Prefer the dataset's own masks and inspect a sample.

## Experiment splits

| Split     | Count | Source                                          | Used for                          |
| --------- | ----- | ----------------------------------------------- | --------------------------------- |
| `train`   | 200   | official **train** split, random with seed      | fine-tuning                       |
| `val`     | 40    | official **train** split, disjoint from `train` | validation loss during training   |
| `heldout` | 40    | official **test** split                         | evaluation only, never trained on |

The command **fails** (exit code 2) when there are not enough valid samples; it never shrinks the experiment silently.
Official test samples cannot enter `train`/`val` (`make_experiment_splits` raises). The evaluation CLI refuses manifests that contain train samples.

## Outputs

`train.jsonl`, `val.jsonl`, `heldout.jsonl` (one JSON record per line), `summary.json` (counts, mask sources, resolutions, manifest SHA-256, validation stats) and `issues.json` (every rejected sample with the reason).
The training metadata stores the manifest hash so a checkpoint can be tied to the exact data it saw.

## Tests

`tests/test_dataset.py` covers valid trees, missing directories/files, corrupt images, bad/missing/mismatched masks, parse fallback, duplicates, split disjointness/determinism, refusal to shrink, content leakage, manifest round-trip and the CLI. The fixtures are random-noise images created only inside test temp folders; they are **never** usable for training (the training metadata marks anything not trained on real pretrained weights as non-genuine).
