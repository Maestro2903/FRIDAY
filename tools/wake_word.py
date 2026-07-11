"""Local "Hey Jarvis" wake-word detector (openWakeWord).

Fully on-device, free, no API key. Uses openWakeWord's pretrained ``hey_jarvis``
model over a 16 kHz mic stream and fires a callback when the phrase is heard.

This module is deliberately self-contained and dependency-guarded so importing it
never breaks a install that lacks the optional packages. Enable it by installing
the extras and running the listener::

    pip install openwakeword sounddevice numpy
    python -m tools.wake_word            # prints when it hears "Hey Jarvis"

Wiring it into the desktop app: run ``listen(...)`` on a background thread and, in
the callback, POST to the desktop's local control endpoint (or emit a gateway
``wake.detected`` event) so the renderer calls ``window.hermesDesktop.notch.open()``
to summon Jarvis — the same action as the ⌥Space global hotkey.

Config (``~/.hermes/config.yaml``)::

    voice:
      wake_word:
        enabled: true
        model: hey_jarvis          # openWakeWord pretrained model name
        threshold: 0.5             # 0..1; raise to cut false triggers
        cooldown_seconds: 2.0      # ignore repeat hits within this window
"""

from __future__ import annotations

import logging
import time
from typing import Callable, Optional

logger = logging.getLogger(__name__)

# openWakeWord runs models at 16 kHz on 80 ms (1280-sample) frames.
SAMPLE_RATE = 16_000
FRAME_SAMPLES = 1280
DEFAULT_MODEL = "hey_jarvis"
DEFAULT_THRESHOLD = 0.5
DEFAULT_COOLDOWN_SECONDS = 2.0


class WakeWordUnavailable(RuntimeError):
    """Raised when the optional wake-word dependencies aren't installed."""


def _load_model(model: str):
    """Build an openWakeWord model, raising WakeWordUnavailable if the package
    (or its ONNX runtime) isn't installed."""
    try:
        from openwakeword.model import Model  # type: ignore
    except Exception as exc:  # pragma: no cover - optional dep
        raise WakeWordUnavailable(
            "openWakeWord is not installed. Run: pip install openwakeword"
        ) from exc

    try:
        # Ensure the pretrained models are present (first run downloads them).
        try:
            import openwakeword  # type: ignore

            openwakeword.utils.download_models([model])
        except Exception:
            # Older/newer versions may not expose download_models the same way;
            # Model() will still resolve bundled models. Best effort.
            pass
        return Model(wakeword_models=[model])
    except Exception as exc:  # pragma: no cover - optional dep
        raise WakeWordUnavailable(f"Could not load wake-word model '{model}': {exc}") from exc


def is_available() -> bool:
    """True when openWakeWord + sounddevice can be imported."""
    try:
        import numpy  # noqa: F401
        import sounddevice  # noqa: F401
        from openwakeword.model import Model  # noqa: F401  # type: ignore

        return True
    except Exception:
        return False


def listen(
    on_wake: Callable[[float], None],
    *,
    model: str = DEFAULT_MODEL,
    threshold: float = DEFAULT_THRESHOLD,
    cooldown_seconds: float = DEFAULT_COOLDOWN_SECONDS,
    should_stop: Optional[Callable[[], bool]] = None,
) -> None:
    """Block, listening on the default mic, invoking ``on_wake(score)`` each time
    the wake phrase is detected above ``threshold`` (respecting a cooldown).

    Runs until ``should_stop()`` returns True (checked each frame) or the process
    is interrupted. Intended to be run on a background thread.

    Raises WakeWordUnavailable if the optional deps are missing.
    """
    try:
        import numpy as np
        import sounddevice as sd
    except Exception as exc:  # pragma: no cover - optional dep
        raise WakeWordUnavailable(
            "sounddevice/numpy are not installed. Run: pip install sounddevice numpy"
        ) from exc

    oww = _load_model(model)
    last_fire = 0.0

    logger.info("Wake word listening for '%s' (threshold=%.2f)", model, threshold)

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=FRAME_SAMPLES) as stream:
        while True:
            if should_stop is not None and should_stop():
                return

            frame, _overflow = stream.read(FRAME_SAMPLES)
            audio = np.frombuffer(frame, dtype=np.int16)

            scores = oww.predict(audio)
            score = float(scores.get(model, 0.0)) if isinstance(scores, dict) else 0.0

            if score >= threshold:
                now = time.monotonic()
                if now - last_fire >= cooldown_seconds:
                    last_fire = now
                    try:
                        on_wake(score)
                    except Exception:  # never let a callback kill the loop
                        logger.exception("wake-word callback failed")


def _main() -> int:  # pragma: no cover - manual/demo entry point
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    if not is_available():
        print("Wake word unavailable. Install with: pip install openwakeword sounddevice numpy")
        return 1

    print("Listening for 'Hey Jarvis' — say it near your mic (Ctrl-C to stop).")

    def _on_wake(score: float) -> None:
        print(f"  ✅ Heard 'Hey Jarvis' (confidence {score:.2f})")

    try:
        listen(_on_wake)
    except KeyboardInterrupt:
        print("\nStopped.")
        return 0
    except WakeWordUnavailable as exc:
        print(f"Wake word unavailable: {exc}")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
