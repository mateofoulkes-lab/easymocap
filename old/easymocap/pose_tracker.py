from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import cv2
import mediapipe as mp
import numpy as np


@dataclass
class PoseFrame:
    timestamp: float
    image_landmarks: list[dict]
    world_landmarks: list[dict]


class PoseTracker:
    """MediaPipe Pose wrapper with JSON-friendly 2D and 3D landmarks."""

    def __init__(self) -> None:
        self._mp_pose = mp.solutions.pose
        self._pose = self._mp_pose.Pose(
            static_image_mode=False,
            model_complexity=1,
            smooth_landmarks=True,
            enable_segmentation=False,
            min_detection_confidence=0.55,
            min_tracking_confidence=0.55,
        )
        self.connections = self._mp_pose.POSE_CONNECTIONS

    @staticmethod
    def _pack(items) -> list[dict]:
        if not items:
            return []
        return [
            {
                "x": float(lm.x),
                "y": float(lm.y),
                "z": float(lm.z),
                "visibility": float(getattr(lm, "visibility", 1.0)),
            }
            for lm in items.landmark
        ]

    def process(
        self, frame_bgr: np.ndarray, timestamp: float
    ) -> tuple[np.ndarray, Optional[PoseFrame]]:
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        result = self._pose.process(rgb)
        overlay = frame_bgr.copy()

        if not result.pose_landmarks:
            return overlay, None

        mp.solutions.drawing_utils.draw_landmarks(
            overlay,
            result.pose_landmarks,
            self.connections,
            landmark_drawing_spec=(
                mp.solutions.drawing_styles.get_default_pose_landmarks_style()
            ),
        )

        return overlay, PoseFrame(
            timestamp=float(timestamp),
            image_landmarks=self._pack(result.pose_landmarks),
            world_landmarks=self._pack(result.pose_world_landmarks),
        )

    def close(self) -> None:
        self._pose.close()
