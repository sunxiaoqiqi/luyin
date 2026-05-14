import argparse
import importlib.util
import json
import os
import sys

if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


def load_workflow(script_path):
    spec = importlib.util.spec_from_file_location("verbal_cleaner_workflow", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load workflow script: {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description="Run verbal cleaner workflow with app settings.")
    parser.add_argument("--mode", choices=["analyze", "draft"], default="analyze", help="Workflow mode")
    parser.add_argument("--script", required=True, help="verbal_cleaner_workflow.py path")
    parser.add_argument("--video", required=True, help="Input video path")
    parser.add_argument("--name", required=True, help="Output draft name")
    parser.add_argument("--model", default="base", help="Whisper model name")
    parser.add_argument("--min-duration", type=float, default=0.2, help="Minimum clip duration")
    parser.add_argument("--output-dir", default="", help="Directory for analysis sidecar outputs")
    parser.add_argument("--result-json", required=True, help="Path to write workflow result JSON")
    args = parser.parse_args()

    module = load_workflow(args.script)
    drafts_root = os.environ.get("JIANYING_DRAFTS_ROOT")
    if drafts_root and hasattr(module, "DraftCreator"):
        module.DraftCreator.get_default_drafts_root = staticmethod(lambda: drafts_root)

    if args.mode == "draft":
        result = module.process_video(
            video_path=args.video,
            output_draft_name=args.name,
            model_name=args.model,
            min_clip_duration=args.min_duration,
        )
    else:
        result = analyze_video(module, args.video, args.model, args.min_duration, args.output_dir)

    with open(args.result_json, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    if not result.get("success"):
        return 1
    return 0


def analyze_video(module, video_path, model_name, min_duration, output_dir):
    audio_path = None
    try:
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)

        if not has_audio_stream(module, video_path):
            return {
                "success": True,
                "video_path": video_path,
                "language": "",
                "total_clips": 0,
                "removed_duration": 0,
                "subtitle_path": "",
                "clip_points": [],
                "transcript_segments": [],
                "warning": "no_audio_stream",
                "message": "视频没有音频流，已跳过去口癖检测。"
            }

        audio_path = module.SpeechTranscriber.extract_audio_from_video(video_path)
        video_duration = 0.0
        if getattr(module, "draft", None) and getattr(module, "VideoMaterial", None):
            try:
                video_duration = module.VideoMaterial(video_path).duration / 1000000
            except Exception:
                video_duration = 0.0

        processor = module.SpeechTranscriber(model_name)
        transcript = processor.transcribe(audio_path, word_level=True)
        segments = transcript.get("segments", [])
        has_word_level = any("words" in seg and seg["words"] for seg in segments)

        if has_word_level:
            word_clips, word_segments = module.VerbalCleaner.find_word_level_clip_points(segments, min_duration)
            pause_clips = module.VerbalCleaner.detect_long_pauses(
                segments,
                min_pause_duration=1.0,
                total_duration=video_duration,
            )
            clip_points = word_clips + pause_clips
            subtitle_source = word_segments
        else:
            marked_segments = module.VerbalCleaner.detect_verbal_segments(segments)
            clip_points = module.VerbalCleaner.find_clip_points(marked_segments, min_duration)
            subtitle_source = marked_segments

        subtitle_path = ""
        if output_dir:
            base_name = os.path.splitext(os.path.basename(video_path))[0]
            subtitle_path = os.path.join(output_dir, f"{base_name}_cleaned.srt")
            if has_word_level:
                module.SubtitleGenerator.generate_srt_from_words(subtitle_source, subtitle_path, clip_points)
            else:
                module.SubtitleGenerator.generate_srt(subtitle_source, subtitle_path, clip_points)

        removed_duration = sum(c.get("duration", c["end"] - c["start"]) for c in clip_points)
        return {
            "success": True,
            "video_path": video_path,
            "language": transcript.get("language", ""),
            "total_clips": len(clip_points),
            "removed_duration": removed_duration,
            "subtitle_path": subtitle_path,
            "clip_points": clip_points,
            "transcript_segments": segments,
        }
    except Exception as exc:
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "video_path": video_path,
            "error": str(exc),
        }
    finally:
        if audio_path and os.path.exists(audio_path):
            os.remove(audio_path)


def has_audio_stream(module, video_path):
    ffmpeg_module = getattr(module, "ffmpeg", None)
    if ffmpeg_module is None:
      return True

    try:
        probe = ffmpeg_module.probe(video_path)
    except Exception:
        return True

    return any(stream.get("codec_type") == "audio" for stream in probe.get("streams", []))


if __name__ == "__main__":
    sys.exit(main())
