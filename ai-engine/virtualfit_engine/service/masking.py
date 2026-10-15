"""Try-on mask estimation for arbitrary user photos.

CatVTON's own automatic masker combines DensePose and two SCHP human-parsing networks, which need
detectron2 and ~1-2 GB of checkpoints from the `zhengchong/CatVTON` Hugging Face repo
(`DensePose/`, `SCHP/`). That stack is isolated here so that nothing else depends on it:

    ENGINE_CATVTON_REPO=<path to a CatVTON git checkout>   (provides model/cloth_masker.py)
    ENGINE_MASKER_CKPT=<local folder or HF repo id containing DensePose/ and SCHP/> (default zhengchong/CatVTON)

Without it the service refuses requests that carry no mask (`MASKER_UNAVAILABLE`); it never
fabricates a mask. Callers may also send their own mask with the request.
The automatic masker's accuracy has not been validated by this project.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

from ..models import ModelUnavailable

CLOTH_TYPES = ("upper", "lower", "overall")


class AutoMaskerBackend:
    def __init__(self, catvton_repo: str | None, ckpt: str = "zhengchong/CatVTON", device: str = "cuda"):
        self.catvton_repo, self.ckpt, self.device = catvton_repo, ckpt, device
        self._masker = None

    def available(self) -> tuple[bool, str]:
        if not self.catvton_repo:
            return False, "ENGINE_CATVTON_REPO is not set (CatVTON checkout with model/cloth_masker.py required)"
        if not (Path(self.catvton_repo) / "model" / "cloth_masker.py").is_file():
            return False, f"{self.catvton_repo} does not contain model/cloth_masker.py"
        return True, "ok"

    def _load(self):
        ok, why = self.available()
        if not ok:
            raise ModelUnavailable("MASKER_UNAVAILABLE", why)
        try:
            sys.path.insert(0, str(self.catvton_repo))
            from model.cloth_masker import AutoMasker  # type: ignore  # CatVTON's own module

            root = Path(self.ckpt)
            if not root.exists():
                from huggingface_hub import snapshot_download

                root = Path(snapshot_download(repo_id=self.ckpt, allow_patterns=["DensePose/*", "SCHP/*"]))
            self._masker = AutoMasker(
                densepose_ckpt=str(root / "DensePose"), schp_ckpt=str(root / "SCHP"), device=self.device
            )
        except Exception as exc:  # missing detectron2, checkpoints, ...
            raise ModelUnavailable("MASKER_UNAVAILABLE", f"AutoMasker failed to load: {type(exc).__name__}: {exc}") from exc

    def __call__(self, person: Image.Image, cloth_type: str) -> Image.Image:
        if cloth_type not in CLOTH_TYPES:
            raise ValueError(f"cloth_type must be one of {CLOTH_TYPES}")
        if self._masker is None:
            self._load()
        return self._masker(person, cloth_type)["mask"].convert("L")
