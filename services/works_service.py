from __future__ import annotations

import threading
from datetime import datetime
from typing import Any

from services.config import config


class WorksService:
    def __init__(self):
        self._lock = threading.RLock()
        self._storage = config.get_storage_backend()

    def _load_works(self) -> list[dict[str, Any]]:
        try:
            return self._storage.load_works()
        except Exception:
            return []

    def _save_works(self, works: list[dict[str, Any]]) -> None:
        self._storage.save_works(works)

    def save_work(
        self,
        work_id: str,
        user_id: str,
        prompt: str,
        model: str,
        size: str | None,
        quality: str | None,
        images: list[str],
    ) -> dict[str, Any]:
        with self._lock:
            works = self._load_works()
            # 避免重复写入相同 ID
            if any(w["id"] == work_id for w in works):
                return next(w for w in works if w["id"] == work_id)

            new_work = {
                "id": work_id,
                "user_id": user_id,
                "prompt": prompt,
                "model": model,
                "size": size or "1024x1024",
                "quality": quality or "standard",
                "images": images,
                "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "is_public": False,
                "likes": 0,
            }
            works.append(new_work)
            self._save_works(works)
            return new_work

    def list_user_works(
        self, user_id: str, limit: int | None = None, offset: int = 0
    ) -> tuple[list[dict[str, Any]], int]:
        with self._lock:
            works = self._load_works()
            user_works = [w for w in works if w["user_id"] == user_id]
            user_works.sort(key=lambda x: x.get("created_at", ""), reverse=True)
            total = len(user_works)
            if limit is not None:
                sliced = user_works[offset : offset + limit]
            else:
                sliced = user_works[offset:]
            return sliced, total

    def delete_user_work(self, user_id: str, work_id: str) -> bool:
        with self._lock:
            works = self._load_works()
            work_to_delete = next((w for w in works if w["id"] == work_id and w["user_id"] == user_id), None)
            if not work_to_delete:
                return False
            works = [w for w in works if not (w["id"] == work_id and w["user_id"] == user_id)]
            self._save_works(works)

            # Physically delete associated images and thumbnails from disk
            images = work_to_delete.get("images")
            if images and isinstance(images, list):
                from urllib.parse import urlparse
                from services.image_service import delete_images

                paths_to_delete = []
                for img in images:
                    if not img:
                        continue
                    if isinstance(img, str):
                        if img.startswith(("http://", "https://")):
                            parsed = urlparse(img)
                            path = parsed.path.lstrip("/")
                            if path.startswith("images/"):
                                path = path[len("images/"):]
                            paths_to_delete.append(path)
                        else:
                            paths_to_delete.append(img)
                if paths_to_delete:
                    try:
                        delete_images(paths_to_delete)
                    except Exception as e:
                        import logging
                        logging.getLogger("chatgpt2api").warning(
                            f"Failed to delete files for work {work_id}: {e}"
                        )
            return True

    def toggle_public_work(self, user_id: str, work_id: str, is_public: bool) -> bool:
        with self._lock:
            works = self._load_works()
            work = next((w for w in works if w["id"] == work_id and w["user_id"] == user_id), None)
            if not work:
                return False
            work["is_public"] = bool(is_public)
            self._save_works(works)
            return True

    def list_public_gallery(
        self, search_query: str = "", limit: int | None = None, offset: int = 0
    ) -> tuple[list[dict[str, Any]], int]:
        with self._lock:
            works = self._load_works()
            # 过滤公开作品
            gallery = [w for w in works if w.get("is_public") is True]
            if search_query.strip():
                query = search_query.lower().strip()
                gallery = [w for w in gallery if query in w.get("prompt", "").lower()]
            gallery.sort(key=lambda x: x.get("created_at", ""), reverse=True)
            total = len(gallery)
            if limit is not None:
                sliced = gallery[offset : offset + limit]
            else:
                sliced = gallery[offset:]
            return sliced, total

    def like_work(self, work_id: str) -> int:
        with self._lock:
            works = self._load_works()
            work = next((w for w in works if w["id"] == work_id), None)
            if not work:
                return 0
            likes = int(work.get("likes", 0)) + 1
            work["likes"] = likes
            self._save_works(works)
            return likes


works_service = WorksService()
