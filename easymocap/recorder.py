from __future__ import annotations

import json
import math
from dataclasses import asdict
from pathlib import Path

import numpy as np

from .pose_tracker import PoseFrame


LEFT_ANKLE = 27
RIGHT_ANKLE = 28
LEFT_HEEL = 29
RIGHT_HEEL = 30
LEFT_TOE = 31
RIGHT_TOE = 32
LEFT_HIP = 23
RIGHT_HIP = 24


class MotionRecorder:
    """Stores raw pose frames and optionally post-processes planted feet."""

    def __init__(self) -> None:
        self.frames: list[PoseFrame] = []
        self.foot_lock = False

    def reset(self, foot_lock: bool) -> None:
        self.frames.clear()
        self.foot_lock = bool(foot_lock)

    def add(self, frame: PoseFrame) -> None:
        self.frames.append(frame)

    def save(
        self,
        path: str | Path,
        source_fbx: str,
        source_audio: str,
    ) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)

        frames = self._apply_foot_lock(self.frames) if self.foot_lock else self.frames
        start = frames[0].timestamp if frames else 0.0
        data = {
            "format": "easymocap-take-v1",
            "source_fbx": str(source_fbx),
            "source_audio": str(source_audio),
            "foot_lock": self.foot_lock,
            "duration": (frames[-1].timestamp - start) if frames else 0.0,
            "frames": [
                {
                    **asdict(frame),
                    "timestamp": float(frame.timestamp - start),
                }
                for frame in frames
            ],
        }
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return path

    @staticmethod
    def _vec(lm: dict) -> np.ndarray:
        return np.array([lm["x"], lm["y"], lm["z"]], dtype=np.float64)

    def _apply_foot_lock(self, frames: list[PoseFrame]) -> list[PoseFrame]:
        if len(frames) < 3:
            return frames

        copied = [
            PoseFrame(
                timestamp=f.timestamp,
                image_landmarks=[dict(x) for x in f.image_landmarks],
                world_landmarks=[dict(x) for x in f.world_landmarks],
            )
            for f in frames
        ]
        self._lock_side(copied, LEFT_ANKLE, LEFT_HEEL, LEFT_TOE)
        self._lock_side(copied, RIGHT_ANKLE, RIGHT_HEEL, RIGHT_TOE)
        return copied

    def _lock_side(
        self,
        frames: list[PoseFrame],
        ankle_i: int,
        heel_i: int,
        toe_i: int,
    ) -> None:
        locked = False
        target: dict[int, np.ndarray] | None = None
        slow_count = 0

        for i, frame in enumerate(frames):
            lm = frame.world_landmarks
            if len(lm) <= toe_i:
                locked = False
                slow_count = 0
                target = None
                continue

            foot_points = [lm[ankle_i], lm[heel_i], lm[toe_i]]
            visibility = min(p.get("visibility", 1.0) for p in foot_points)
            if visibility < 0.45:
                locked = False
                slow_count = 0
                target = None
                continue

            ankle = self._vec(lm[ankle_i])
            speed = math.inf
            if i > 0 and len(frames[i - 1].world_landmarks) > toe_i:
                previous = self._vec(frames[i - 1].world_landmarks[ankle_i])
                dt = max(frame.timestamp - frames[i - 1].timestamp, 1 / 120)
                speed = float(np.linalg.norm(ankle - previous) / dt)

            hips = (
                self._vec(lm[LEFT_HIP]) + self._vec(lm[RIGHT_HIP])
            ) * 0.5
            foot_low = ankle[1] > hips[1] + 0.28
            slow = speed < 0.18

            if not locked:
                slow_count = slow_count + 1 if (slow and foot_low) else 0
                if slow_count >= 4:
                    target = {
                        ankle_i: self._vec(lm[ankle_i]),
                        heel_i: self._vec(lm[heel_i]),
                        toe_i: self._vec(lm[toe_i]),
                    }
                    locked = True
            elif speed > 0.38:
                locked = False
                slow_count = 0
                target = None
            elif target:
                for idx in (ankle_i, heel_i, toe_i):
                    p = target[idx]
                    lm[idx]["x"] = float(p[0])
                    lm[idx]["y"] = float(p[1])
                    lm[idx]["z"] = float(p[2])
