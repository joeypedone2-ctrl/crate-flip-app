"""Phase 1 proof of concept: extract features from a single audio file and
produce a heuristic genre + energy prediction. There is no trained model
yet — this bootstrap heuristic exists to get the pipeline working end to
end; it gets replaced by a scikit-learn classifier trained on swipe
corrections once enough of those exist.
"""

import argparse
import os
import subprocess
import tempfile
import time

import librosa
import numpy as np
import soundfile as sf


ANALYSIS_WINDOW_SEC = 40
ANALYSIS_OFFSET_SEC = 20  # skip a typical intro


def _probe_duration(path):
    # Best-effort, header-based only — never fall back to a full decode
    # just to report a duration; that defeats the point of windowing below
    # and can hang on files with broken/missing length metadata.
    try:
        return float(sf.info(path).duration)
    except Exception:
        return None


def _load_via_ffmpeg(path, offset, duration):
    # Some files lie about their own format (e.g. SoundCloud downloads
    # saved as .mp3 that are actually AAC/mp4 audio) and soundfile
    # correctly refuses to parse them. ffmpeg is far more tolerant of
    # content/extension mismatches, so re-encode the target window to a
    # clean temp wav and load that instead.
    fd, tmp_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        subprocess.run(
            [
                "ffmpeg", "-v", "error", "-y",
                "-ss", str(offset), "-t", str(duration),
                "-i", path,
                "-ac", "1", "-ar", "22050",
                tmp_path,
            ],
            check=True,
            capture_output=True,
        )
        return librosa.load(tmp_path, sr=22050, mono=True)
    finally:
        os.remove(tmp_path)


def _load_window(path, offset, duration):
    try:
        y, sr = librosa.load(path, sr=22050, mono=True, offset=offset, duration=duration)
        if len(y) > 0:
            return y, sr
    except Exception:
        pass
    return _load_via_ffmpeg(path, offset, duration)


def extract_features(path):
    # Load a fixed-size window at a fixed offset rather than probing the
    # file's total duration first — probing can force a full decode on
    # files with bad VBR/length headers, which showed up in practice as a
    # single mp3 hanging a worker for 30+ minutes. Loading with an explicit
    # offset/duration bounds the decode cost regardless of the source
    # file's real length or how broken its metadata is.
    y, sr = _load_window(path, ANALYSIS_OFFSET_SEC, ANALYSIS_WINDOW_SEC)
    if len(y) == 0:
        # Shorter than the offset — fall back to analyzing from the start.
        y, sr = _load_window(path, 0, ANALYSIS_WINDOW_SEC)
    if len(y) == 0:
        raise ValueError("no audio data could be decoded from this file")

    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    tempo = float(np.atleast_1d(tempo)[0])

    harmonic, percussive = librosa.effects.hpss(y)
    harmonic_energy = float(np.sum(harmonic**2))
    percussive_energy = float(np.sum(percussive**2))
    harmonic_ratio = harmonic_energy / (harmonic_energy + percussive_energy + 1e-9)

    rms = float(np.mean(librosa.feature.rms(y=y)))
    onset_strength = float(np.mean(librosa.onset.onset_strength(y=y, sr=sr)))
    spectral_centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))

    return {
        "tempo": tempo,
        "harmonic_ratio": harmonic_ratio,
        "rms": rms,
        "onset_strength": onset_strength,
        "spectral_centroid": spectral_centroid,
        "file_duration_sec": _probe_duration(path),
        "analyzed_duration_sec": len(y) / sr,
    }


def predict_genre(features):
    tempo = features["tempo"]
    harmonic_ratio = features["harmonic_ratio"]

    # librosa's beat tracker commonly reports half or double the true
    # tempo; fold it back into the range EDM subgenres actually live in.
    while tempo < 100:
        tempo *= 2
    while tempo > 190:
        tempo /= 2

    if tempo >= 155:
        return "drum_and_bass"
    if tempo >= 136:
        return "dubstep"
    if tempo >= 128:
        return "trance" if harmonic_ratio > 0.55 else "techno"
    if tempo >= 118:
        return "trance" if harmonic_ratio > 0.6 else "house"
    return "house"


def predict_energy(features):
    # Crude 1-10 scale from loudness + percussive density + tempo, each
    # normalized against rough real-world ranges. Gets replaced by a
    # library-relative percentile score once there's a folder of tracks
    # to compare against (Phase 2+).
    rms_score = np.clip(features["rms"] / 0.3, 0, 1)
    onset_score = np.clip(features["onset_strength"] / 3.0, 0, 1)
    tempo_score = np.clip((features["tempo"] - 100) / 90, 0, 1)

    raw = 0.5 * rms_score + 0.35 * onset_score + 0.15 * tempo_score
    return int(round(1 + raw * 9))


def analyze(path):
    start = time.perf_counter()
    features = extract_features(path)
    genre = predict_genre(features)
    energy = predict_energy(features)
    elapsed = time.perf_counter() - start

    return {
        "genre": genre,
        "energy": energy,
        "features": features,
        "elapsed_sec": elapsed,
    }


def main():
    parser = argparse.ArgumentParser(description="Analyze a single audio file (Phase 1 POC)")
    parser.add_argument("path", help="Path to an audio file")
    args = parser.parse_args()

    result = analyze(args.path)

    print(f"File: {args.path}")
    print(f"Predicted genre: {result['genre']}")
    print(f"Predicted energy: {result['energy']}/10")
    print(f"Processing time: {result['elapsed_sec']:.2f}s")
    print("Raw features:")
    for key, value in result["features"].items():
        formatted = f"{value:.3f}" if isinstance(value, float) else value
        print(f"  {key}: {formatted}")


if __name__ == "__main__":
    main()
