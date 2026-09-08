from __future__ import annotations

import sys
import time
from pathlib import Path

import cv2
from PySide6.QtCore import Qt, QTimer, QUrl
from PySide6.QtGui import QImage, QPixmap
from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
from PySide6.QtWidgets import (
    QApplication, QCheckBox, QFileDialog, QHBoxLayout, QLabel, QMainWindow,
    QMessageBox, QPushButton, QProgressBar, QVBoxLayout, QWidget,
)

from easymocap.blender_bridge import export_fbx, find_blender
from easymocap.pose_tracker import PoseTracker
from easymocap.recorder import MotionRecorder


class EasyMocapWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("EasyMocap")
        self.resize(1100, 780)

        self.audio_path: Path | None = None
        self.fbx_path: Path | None = None
        self.last_take_path: Path | None = None
        self.camera: cv2.VideoCapture | None = None
        self.tracker = PoseTracker()
        self.recorder = MotionRecorder()
        self.last_pose = None
        self.recording = False
        self.record_started_at = 0.0
        self.countdown_value = 0

        self.player = QMediaPlayer(self)
        self.audio_output = QAudioOutput(self)
        self.audio_output.setVolume(0.9)
        self.player.setAudioOutput(self.audio_output)
        self.player.mediaStatusChanged.connect(self._media_status_changed)
        self.player.positionChanged.connect(self._audio_progress)

        self.camera_timer = QTimer(self)
        self.camera_timer.setInterval(15)
        self.camera_timer.timeout.connect(self._camera_tick)

        self.countdown_timer = QTimer(self)
        self.countdown_timer.setInterval(1000)
        self.countdown_timer.timeout.connect(self._countdown_tick)

        self._build_ui()
        self._style()

    def _build_ui(self) -> None:
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(12)

        title = QLabel("EasyMocap")
        title.setObjectName("title")
        subtitle = QLabel("Audio-synchronised webcam mocap → animated FBX for Unity")
        subtitle.setObjectName("subtitle")
        layout.addWidget(title)
        layout.addWidget(subtitle)

        row = QHBoxLayout()
        self.audio_btn = QPushButton("Load audio")
        self.audio_btn.clicked.connect(self._load_audio)
        self.audio_label = QLabel("No audio")
        self.rig_label = QLabel(f"Rig fijo: {self.fbx_path.name}")
        self.rig_label.setToolTip(str(self.fbx_path))
        row.addWidget(self.audio_btn)
        row.addWidget(self.audio_label, 1)
        row.addSpacing(10)
        row.addWidget(self.rig_label)
        layout.addLayout(row)

        self.video = QLabel("Camera off")
        self.video.setAlignment(Qt.AlignCenter)
        self.video.setMinimumHeight(500)
        self.video.setObjectName("video")
        layout.addWidget(self.video, 1)

        self.countdown = QLabel("", self.video)
        self.countdown.setAlignment(Qt.AlignCenter)
        self.countdown.setObjectName("countdown")
        self.countdown.hide()

        status = QHBoxLayout()
        self.tracking_status = QLabel("● Waiting for camera")
        self.foot_lock = QCheckBox("Foot Lock IK")
        self.foot_lock.setChecked(True)
        status.addWidget(self.tracking_status)
        status.addStretch(1)
        status.addWidget(self.foot_lock)
        layout.addLayout(status)

        self.progress = QProgressBar()
        self.progress.setRange(0, 1000)
        self.progress.setValue(0)
        self.progress.setTextVisible(False)
        layout.addWidget(self.progress)

        controls = QHBoxLayout()
        self.camera_btn = QPushButton("Open camera")
        self.camera_btn.clicked.connect(self._toggle_camera)
        self.record_btn = QPushButton("Record")
        self.record_btn.setObjectName("record")
        self.record_btn.clicked.connect(self._start_record)
        self.export_btn = QPushButton("Export animated FBX")
        self.export_btn.clicked.connect(self._export)
        controls.addWidget(self.camera_btn)
        controls.addStretch(1)
        controls.addWidget(self.record_btn)
        controls.addWidget(self.export_btn)
        layout.addLayout(controls)

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        self.countdown.setGeometry(self.video.rect())

    def _style(self) -> None:
        self.setStyleSheet("""
            QMainWindow { background:#111317; }
            QWidget { color:#eef1f5; font-size:14px; }
            QLabel#title { font-size:30px; font-weight:700; }
            QLabel#subtitle { color:#9aa3ad; margin-bottom:4px; }
            QLabel#video {
                background:#070809; border:1px solid #2b3139;
                border-radius:12px; color:#66707c;
            }
            QPushButton {
                background:#252b33; border:1px solid #39414c;
                border-radius:8px; padding:9px 14px;
            }
            QPushButton:hover { background:#303844; }
            QPushButton#record {
                background:#c93545; border-color:#e24b5b;
                font-weight:700; min-width:110px;
            }
            QLabel#countdown {
                color:white; background:rgba(0,0,0,120);
                font-size:110px; font-weight:800;
            }
            QProgressBar {
                border:1px solid #303640; border-radius:5px;
                background:#171a1f; height:10px;
            }
            QProgressBar::chunk { background:#6ccf8d; border-radius:4px; }
        """)

    def _load_audio(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "Open audio", "", "Audio (*.mp3 *.ogg)")
        if not path:
            return
        self.audio_path = Path(path)
        self.audio_label.setText(self.audio_path.name)
        self.player.setSource(QUrl.fromLocalFile(str(self.audio_path)))

    def _toggle_camera(self) -> None:
        if self.camera is not None:
            self._close_camera()
            return

        cam = cv2.VideoCapture(0, cv2.CAP_DSHOW)
        if not cam.isOpened():
            cam.release()
            cam = cv2.VideoCapture(0)
        if not cam.isOpened():
            QMessageBox.critical(self, "Camera", "Could not open the default camera.")
            return

        cam.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cam.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        self.camera = cam
        self.camera_btn.setText("Close camera")
        self.camera_timer.start()

    def _close_camera(self) -> None:
        self.camera_timer.stop()
        if self.camera is not None:
            self.camera.release()
        self.camera = None
        self.camera_btn.setText("Open camera")
        self.video.clear()
        self.video.setText("Camera off")
        self.tracking_status.setText("● Waiting for camera")

    def _camera_tick(self) -> None:
        if self.camera is None:
            return
        ok, frame = self.camera.read()
        if not ok:
            return

        frame = cv2.flip(frame, 1)
        now = time.perf_counter()
        overlay, pose = self.tracker.process(frame, now)
        self.last_pose = pose

        if pose:
            visible = [x.get("visibility", 1.0) for x in pose.world_landmarks]
            quality = sum(v > 0.55 for v in visible) / max(len(visible), 1)
            if quality > 0.72:
                self.tracking_status.setText("● Body locked")
                self.tracking_status.setStyleSheet("color:#73d698")
            else:
                self.tracking_status.setText("● Partial body — step back")
                self.tracking_status.setStyleSheet("color:#f0b35d")

            if self.recording:
                pose.timestamp = now - self.record_started_at
                self.recorder.add(pose)
        else:
            self.tracking_status.setText("● No body detected")
            self.tracking_status.setStyleSheet("color:#ef6b78")

        rgb = cv2.cvtColor(overlay, cv2.COLOR_BGR2RGB)
        h, w, channels = rgb.shape
        image = QImage(rgb.data, w, h, channels * w, QImage.Format_RGB888).copy()
        self.video.setPixmap(QPixmap.fromImage(image).scaled(
            self.video.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation
        ))

    def _start_record(self) -> None:
        if self.recording or self.countdown_timer.isActive():
            return
        if not self.audio_path:
            QMessageBox.information(self, "Missing audio", "Load an MP3 or OGG first.")
            return
        if self.camera is None:
            QMessageBox.information(self, "Camera", "Open the camera first.")
            return
        if not self.last_pose:
            QMessageBox.information(self, "Tracking", "Stand in frame until your body is detected.")
            return

        self.recorder.reset(self.foot_lock.isChecked())
        self.player.stop()
        self.player.setPosition(0)
        self.progress.setValue(0)
        self.countdown_value = 3
        self.countdown.setGeometry(self.video.rect())
        self.countdown.setText("3")
        self.countdown.show()
        self.countdown.raise_()
        self.countdown_timer.start()

    def _countdown_tick(self) -> None:
        self.countdown_value -= 1
        if self.countdown_value > 0:
            self.countdown.setText(str(self.countdown_value))
            return

        self.countdown_timer.stop()
        self.countdown.hide()
        self.record_started_at = time.perf_counter()
        self.recording = True
        self.record_btn.setText("Recording…")
        self.player.play()

    def _media_status_changed(self, status) -> None:
        if status == QMediaPlayer.EndOfMedia and self.recording:
            self._finish_record()

    def _audio_progress(self, position_ms: int) -> None:
        duration = self.player.duration()
        if duration > 0:
            self.progress.setValue(int(1000 * position_ms / duration))

    def _finish_record(self) -> None:
        if not self.recording:
            return
        self.recording = False
        self.record_btn.setText("Record")

        captures = Path.cwd() / "captures"
        captures.mkdir(exist_ok=True)
        stamp = time.strftime("%Y%m%d_%H%M%S")
        self.last_take_path = captures / f"take_{stamp}.json"
        self.recorder.save(
            self.last_take_path,
            str(self.fbx_path),
            str(self.audio_path),
        )
        self.progress.setValue(1000)
        QMessageBox.information(
            self,
            "Take captured",
            f"Recorded {len(self.recorder.frames)} pose frames.\n\n"
            f"Take saved to:\n{self.last_take_path}",
        )

    def _export(self) -> None:
        if self.recording:
            QMessageBox.information(self, "Recording", "Finish the current take first.")
            return
        if not self.last_take_path or not self.last_take_path.exists():
            QMessageBox.information(self, "No take", "Record a take before exporting.")
            return
        if not self.fbx_path:
            return

        default = Path.cwd() / "exports" / f"{self.fbx_path.stem}_mocap.fbx"
        out, _ = QFileDialog.getSaveFileName(
            self, "Export animated FBX", str(default), "FBX (*.fbx)"
        )
        if not out:
            return

        blender = find_blender()
        if not blender:
            selected, _ = QFileDialog.getOpenFileName(
                self,
                "Locate Blender",
                r"C:\Program Files\Blender Foundation",
                "Blender (blender.exe)",
            )
            if not selected:
                QMessageBox.warning(
                    self,
                    "Blender required",
                    "FBX export uses Blender in background mode. "
                    "Install Blender 4.x or select blender.exe.",
                )
                return
            blender = Path(selected)

        QApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            result = export_fbx(blender, self.fbx_path, self.last_take_path, out)
        finally:
            QApplication.restoreOverrideCursor()

        if result.returncode != 0:
            details = (result.stderr or result.stdout or "Unknown Blender error")[-5000:]
            QMessageBox.critical(self, "FBX export failed", details)
            return

        QMessageBox.information(self, "Export complete", f"Animated FBX written to:\n{out}")

    def closeEvent(self, event) -> None:
        self.player.stop()
        self._close_camera()
        self.tracker.close()
        super().closeEvent(event)


def main() -> int:
    app = QApplication(sys.argv)
    window = EasyMocapWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
