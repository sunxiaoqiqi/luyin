"""
视频口语化清理工作流

功能：
1. 从视频中提取音频
2. 使用 Whisper ASR 进行语音转文字
3. 检测口癖、重复、说错和不合理停顿
4. 生成剪辑点和清理后的字幕
5. 创建剪映草稿

依赖：
- whisper: 语音转文字
- ffmpeg-python: 音频提取
- pyJianYingDraft: 剪映草稿生成
"""

import os
import sys
import json
import re
from typing import List, Dict, Tuple, Optional

# 添加剪映工具路径
current_dir = os.path.dirname(os.path.abspath(__file__))
skill_root = os.path.dirname(current_dir)
jianying_tools_path = os.path.join(os.path.dirname(skill_root), "1-2-_capabilities-jianying-draft-tools")
references_path = os.path.join(jianying_tools_path, "references")

if references_path not in sys.path:
    sys.path.insert(0, references_path)

# 本地模型缓存路径
LOCAL_MODEL_CACHE = r"d:\开发类工具\AI模型缓存\huggingface"

# 本地 ffmpeg 路径
LOCAL_FFMPEG_PATHS = [
    r"d:\ffmpeg-master-latest-win64-gpl-shared\bin",
    r"C:\ffmpeg\bin",
    r"C:\Program Files\ffmpeg\bin",
    os.path.join(os.path.expanduser("~"), "ffmpeg", "bin"),
]


def setup_ffmpeg_path():
    """设置 ffmpeg 路径，确保 ffmpeg-python 能够找到 ffmpeg.exe"""
    for ffmpeg_path in LOCAL_FFMPEG_PATHS:
        ffmpeg_exe = os.path.join(ffmpeg_path, "ffmpeg.exe")
        if os.path.exists(ffmpeg_exe):
            # 将 ffmpeg 路径添加到系统 PATH
            if ffmpeg_path not in os.environ.get("PATH", ""):
                os.environ["PATH"] = ffmpeg_path + ";" + os.environ.get("PATH", "")
            print(f"✅ 已设置 ffmpeg 路径: {ffmpeg_path}")
            return True
    return False


try:
    import whisper
except ImportError:
    whisper = None
    print("⚠️ Warning: whisper not installed. Please install with: pip install openai-whisper")

# 设置 ffmpeg 路径后再导入
setup_ffmpeg_path()

try:
    import ffmpeg
except ImportError:
    ffmpeg = None
    print("⚠️ Warning: ffmpeg-python not installed. Please install with: pip install ffmpeg-python")

try:
    import pyJianYingDraft as draft
    from pyJianYingDraft import trange, tim
    from pyJianYingDraft.video_segment import VideoMaterial
except ImportError:
    draft = None
    print("⚠️ Warning: pyJianYingDraft not found")


class SpeechTranscriber:
    """语音转文字模块"""
    
    def __init__(self, model_name: str = "base"):
        self.model = None
        self.model_name = model_name
        self._load_model()
    
    def _find_local_model(self) -> Optional[str]:
        """查找本地缓存的模型文件"""
        model_files = {
            "tiny": "tiny.pt",
            "base": "base.pt",
            "small": "small.pt",
            "medium": "medium.pt",
            "large": "large-v2.pt",
            "large-v3": "large-v3.pt",
            "large-v3-turbo": "large-v3-turbo.pt",
            "tiny.en": "tiny.en.pt",
            "base.en": "base.en.pt",
            "small.en": "small.en.pt",
            "medium.en": "medium.en.pt"
        }
        
        cache_paths = [
            os.path.join(LOCAL_MODEL_CACHE, "models--openai--whisper-" + self.model_name),
            os.path.join(os.path.expanduser("~"), ".cache", "whisper")
        ]
        
        # 检查是否有预定义的模型文件名
        expected_file = model_files.get(self.model_name)
        
        # 如果有预定义文件名，精确查找
        if expected_file:
            for cache_path in cache_paths:
                if os.path.exists(cache_path):
                    for item in os.listdir(cache_path):
                        item_path = os.path.join(cache_path, item)
                        if os.path.isdir(item_path):
                            model_path = os.path.join(item_path, expected_file)
                            if os.path.exists(model_path):
                                return model_path
                        
                        blobs_path = os.path.join(cache_path, "blobs")
                        if os.path.exists(blobs_path):
                            for blob in os.listdir(blobs_path):
                                if blob.endswith(".bin") or blob.endswith(".pt"):
                                    return os.path.join(blobs_path, blob)
        
        # 通用搜索：查找 Hugging Face 缓存中的 whisper 模型
        for cache_path in cache_paths:
            if not os.path.exists(cache_path):
                continue
            for item in os.listdir(cache_path):
                if "whisper" in item.lower():
                    item_path = os.path.join(cache_path, item)
                    if os.path.isdir(item_path):
                        # 查找 .pt 文件 (openai-whisper 格式)
                        for f in os.listdir(item_path):
                            if f.endswith(".pt") and self.model_name in f:
                                return os.path.join(item_path, f)
                        # 查找 safetensors 文件 (faster-whisper 格式) - 返回目录
                        for root, dirs, files in os.walk(item_path):
                            if "model.safetensors" in files:
                                return root
                        # 查找 blobs 目录
                        blobs_path = os.path.join(item_path, "blobs")
                        if os.path.exists(blobs_path):
                            for blob in os.listdir(blobs_path):
                                if blob.endswith(".bin") or blob.endswith(".pt"):
                                    blob_path = os.path.join(blobs_path, blob)
                                    if self.model_name in blob or self.model_name.replace("-", "_") in blob:
                                        return blob_path
        
        return None
    
    def _load_model(self):
        """延迟加载 Whisper 模型（优先使用本地缓存和 faster-whisper）"""
        try:
            local_model_path = self._find_local_model()
            
            if local_model_path:
                # 尝试使用 faster-whisper
                try:
                    from faster_whisper import WhisperModel
                    print(f"📦 使用本地模型 (faster-whisper): {local_model_path}")
                    # 获取目录路径而不是文件路径
                    model_dir = os.path.dirname(local_model_path)
                    self.model = WhisperModel(model_dir, device="cpu", compute_type="int8")
                    self.use_faster_whisper = True
                    print(f"✅ 加载 Whisper 模型: {self.model_name}")
                    return
                except ImportError:
                    print("⚠️ faster-whisper 未安装，尝试使用 openai-whisper")
                except Exception as e:
                    print(f"⚠️ 使用 faster-whisper 失败: {e}")
            
            # 回退到 openai-whisper
            if whisper is None:
                raise ImportError("whisper 模块未安装")
            
            print(f"🌐 下载并加载模型: {self.model_name}")
            self.model = whisper.load_model(self.model_name)
            self.use_faster_whisper = False
            print(f"✅ 加载 Whisper 模型: {self.model_name}")
        except Exception as e:
            print(f"❌ 加载模型失败: {e}")
            self.model = None
            self.use_faster_whisper = False
    
    def transcribe(self, audio_path: str, word_level: bool = True) -> Dict:
        """语音转文字（支持 faster-whisper 和 openai-whisper）

        Args:
            audio_path: 音频文件路径
            word_level: 是否获取字级别时间戳（精确到每个字）
        """
        if self.model is None:
            self._load_model()
        
        try:
            if self.use_faster_whisper:
                # faster-whisper 的转录方式
                segments, info = self.model.transcribe(
                    audio_path,
                    word_timestamps=word_level
                )
                whisper_segments = []
                for seg in segments:
                    seg_data = {
                        "start": seg.start,
                        "end": seg.end,
                        "text": seg.text,
                        "id": len(whisper_segments)
                    }
                    if word_level and hasattr(seg, 'words') and seg.words:
                        seg_data["words"] = [
                            {
                                "word": word.word,
                                "start": word.start,
                                "end": word.end
                            }
                            for word in seg.words
                        ]
                    whisper_segments.append(seg_data)
                return {
                    "segments": whisper_segments,
                    "language": info.language,
                    "text": " ".join([seg["text"] for seg in whisper_segments])
                }
            else:
                # openai-whisper 的转录方式
                result = self.model.transcribe(audio_path, word_timestamps=word_level)
                return {
                    "segments": result["segments"],
                    "language": result.get("language", "zh"),
                    "text": result.get("text", "")
                }
        except Exception as e:
            print(f"❌ 转录失败: {e}")
            return {"segments": [], "language": "zh", "text": ""}
    
    @staticmethod
    def extract_audio_from_video(video_path: str, output_audio_path: str = None) -> str:
        """从视频中提取音频"""
        if ffmpeg is None:
            raise ImportError("ffmpeg-python 模块未安装")
        
        if output_audio_path is None:
            output_audio_path = os.path.splitext(video_path)[0] + "_audio.wav"
        
        try:
            (
                ffmpeg
                .input(video_path)
                .output(output_audio_path, acodec="pcm_s16le", ac=1, ar="16k")
                .run(quiet=True, overwrite_output=True)
            )
            print(f"✅ 音频提取完成: {output_audio_path}")
            return output_audio_path
        except Exception as e:
            print(f"❌ 音频提取失败: {e}")
            raise


class VerbalCleaner:
    """口语化表达清理器"""
    
    # 语气词模式库 - 增强版
    VERBAL_PATTERNS = {
        "single": [
            # 单字语气词
            r'^嗯\s*$',
            r'^啊\s*$',
            r'^哦\s*$',
            r'^呃\s*$',
            r'^额\s*$',
            r'^呀\s*$',
            r'^嘛\s*$',
            r'^呢\s*$',
            r'^吧\s*$',
            r'^哦\s*$',
            r'^哎\s*$',
            r'^唉\s*$',
            r'^哼\s*$',
            r'^哈\s*$',
            r'^嘿\s*$',
            r'^喔\s*$',
            # 开头语气词
            r'^嗯\s*',
            r'^\s*嗯',
            r'\s*啊\s*$',
            r'^\s*啊',
            r'^哦\s*',
            r'\s*哦\s*$',
            r'^呃\s*',
            r'^\s*呃',
            r'^额\s*',
            r'^\s*额',
            r'^呀\s*',
            r'^\s*呀',
            # 常用口语词汇
            r'^那个\s*',
            r'\s*那个\s*',
            r'^然后\s*',
            r'\s*然后\s*',
            r'^就是\s*',
            r'\s*就是\s*',
            r'^其实\s*',
            r'^我觉得\s*',
            r'^对吧\s*',
            r'\s*对吧\s*',
            r'^嘛\s*',
            r'^呢\s*',
            r'^吧\s*',
            r'^话说\s*',
            r'^那么\s*',
            r'^所以呢\s*',
            r'^这个\s*',
            r'^那个啊\s*',
            r'^这个嘛\s*',
            r'^怎么说呢\s*',
            r'^怎么讲\s*',
            r'^可以说\s*',
            r'^换句话说\s*',
            r'^也就是说\s*',
            r'^其实呢\s*',
            r'^其实吧\s*',
            r'^事实上\s*',
            r'^严格来说\s*',
            r'^一般来说\s*',
            r'^总的来说\s*',
            r'^基本上\s*',
            r'^本质上\s*',
            r'^简单来说\s*',
            r'^简单讲\s*',
            r'^说白了\s*',
            r'^讲真的\s*',
            r'^说实话\s*',
            r'^老实说\s*',
            r'^不瞒你说\s*',
            r'^说句实话\s*',
            r'^我跟你说\s*',
            r'^你知道吗\s*',
            r'^你明白吗\s*',
            r'^懂我的意思吗\s*',
            r'^对吧\s*',
            r'^是不是\s*',
            r'^对不对\s*',
            r'^好不好\s*',
            r'^行不行\s*',
            r'^可以吗\s*',
            r'^明白了吗\s*',
            r'^清楚了吗\s*',
            r'^懂了吗\s*',
        ],
        
        "repeats": [
            r'(\b\w+\b)\s+\1',                    # 单词重复
            r'(\b\w{2,}\b)\s+\1\s+\1',           # 三连重复
            r'(\b[\u4e00-\u9fa5]+\b)\s+\1',      # 中文词重复
            r'^([\u4e00-\u9fa5]{2,})\s+\1$',     # 整个句子重复
            r'^([\u4e00-\u9fa5]{3,}).*\1$',      # 句子前后重复
            r'(\b[\u4e00-\u9fa5]{2,}\b).*\1\b',  # 词在同一句中重复出现
            r'^我我\s*',                          # 我我
            r'^我们我们\s*',                      # 我们我们
            r'^这个这个\s*',                      # 这个这个
            r'^那个那个\s*',                      # 那个那个
            r'^然后然后\s*',                      # 然后然后
            r'^就是就是\s*',                      # 就是就是
            r'^嗯\s*嗯\s*',                       # 嗯 嗯
            r'^啊\s*啊\s*',                       # 啊 啊
        ],
        
        "pauses": [
            r'(\.{2,})',
            r'(\s{4,})',
            r'^——+$',
            r'^——\s*',
        ]
    }
    
    # 语气词列表 - 增强版
    VERBAL_WORDS = [
        # 单字语气词
        '嗯', '啊', '哦', '呃', '额', '呀', '嘛', '呢', '吧',
        '哎', '唉', '哼', '哈', '嘿', '喔',
        # 双字语气词
        '嗯哼', '啊哈', '哦哟', '哎呀', '哎哟', '哎呀',
        # 常用口语词汇
        '那个', '然后', '就是', '其实', '我觉得', '对吧',
        '这个', '那么', '所以呢', '怎么说呢', '怎么讲',
        '可以说', '换句话说', '也就是说', '其实呢', '其实吧',
        '事实上', '严格来说', '一般来说', '总的来说', '基本上',
        '本质上', '简单来说', '简单讲', '说白了', '讲真的',
        '说实话', '老实说', '不瞒你说', '说句实话', '我跟你说',
        '你知道吗', '你明白吗', '懂我的意思吗', '是不是', '对不对',
        '好不好', '行不行', '可以吗', '明白了吗', '清楚了吗', '懂了吗',
        # 重复词汇
        '那个那个', '然后然后', '就是就是', '这个这个', '我们我们',
        # 口误词汇
        '不是', '不是吧', '不对', '错了', '说错了', '搞错了',
        '重来', '等一下', '等会儿', '先等一下', '先别急',
    ]
    
    # 疑似说错的关键词
    MISTAKE_WORDS = [
        '不是', '不对', '错了', '说错了', '搞错了', '搞错',
        '重来', '等一下', '等会儿', '先等一下', '先别急',
        '不好意思', '抱歉', '那个', '那个什么', '那个啥',
        '算了', '不说了', '其实不是', '其实不对',
        '这段不要', '这段删了', '重新开始', '删掉',
        '跳过', '不讲了', '说快了', '说慢了',
    ]
    
    @classmethod
    def detect_verbal_segments(cls, segments: List[Dict]) -> List[Dict]:
        """检测包含口语化表达的片段（增强版）"""
        marked_segments = []
        
        for i, seg in enumerate(segments):
            text = seg["text"].strip()
            is_verbal, verbal_type = cls._is_verbal_segment(text)
            
            # 检测长时间停顿（片段之间的间隔）
            if i > 0:
                prev_seg = segments[i-1]
                gap = seg["start"] - prev_seg["end"]
                if gap > 1.0:  # 超过1秒的停顿
                    verbal_type = "long_pause"
                    is_verbal = True
            
            marked_segments.append({
                **seg,
                "is_verbal": is_verbal,
                "verbal_type": verbal_type,
                "cleaned_text": cls._clean_text(text) if is_verbal else text
            })
        
        return marked_segments
    
    # 单独出现的连接词
    STANDALONE_CONNECTORS = [
        '还有', '而且', '并且', '但是', '可是', '不过',
        '所以', '因此', '于是', '然后', '接着', '之后',
        '另外', '此外', '再者', '同时', '另外呢', '还有呢',
        '其实', '实际上', '事实上', '本质上', '基本上',
        '总的来说', '一般来说', '严格来说', '简单来说',
        '这个', '那个', '这些', '那些',
    ]
    
    @classmethod
    def _is_verbal_segment(cls, text: str) -> Tuple[bool, str]:
        """判断片段是否为口语化表达（增强版）"""
        text = text.strip()
        
        if not text:
            return True, "empty"
        
        # 检测单独出现的连接词
        if text in cls.STANDALONE_CONNECTORS:
            return True, "connector"
        
        # 检测重复模式
        for pattern in cls.VERBAL_PATTERNS["repeats"]:
            if re.search(pattern, text):
                return True, "repeat"
        
        # 检测语气词模式
        for pattern in cls.VERBAL_PATTERNS["single"]:
            if re.search(pattern, text, re.IGNORECASE):
                return True, "verbal"
        
        # 检测纯语气词
        if text in cls.VERBAL_WORDS:
            return True, "pure_verbal"
        
        # 检测单字语气词
        if len(text) <= 2 and text in '嗯啊哦呃额呀嘛呢吧哎唉哼哈嘿喔':
            return True, "short_verbal"
        
        # 检测疑似说错的内容
        for mistake_word in cls.MISTAKE_WORDS:
            if mistake_word in text:
                return True, "mistake"
        
        # 检测重复字符
        if re.search(r'^(\w)\1{2,}$', text):  # 连续重复3次以上
            return True, "repeat"
        
        # 检测短片段（可能是犹豫）
        if len(text) <= 3:
            # 检查是否包含语气词
            for char in text:
                if char in '嗯啊哦呃额呀嘛呢吧':
                    return True, "short_verbal"
        
        return False, "normal"
    
    @classmethod
    def _clean_text(cls, text: str) -> str:
        """清理口语化表达（增强版）"""
        cleaned = text
        
        # 移除重复模式（只处理有捕获组的模式）
        for pattern in cls.VERBAL_PATTERNS["repeats"]:
            try:
                cleaned = re.sub(pattern, r'\1', cleaned)
            except:
                cleaned = re.sub(pattern, '', cleaned)
        
        # 移除语气词模式
        for pattern in cls.VERBAL_PATTERNS["single"]:
            cleaned = re.sub(pattern, ' ', cleaned)
        
        # 移除停顿标记
        for pattern in cls.VERBAL_PATTERNS["pauses"]:
            cleaned = re.sub(pattern, '', cleaned)
        
        # 移除单独的语气词
        words = cleaned.split()
        cleaned_words = []
        for word in words:
            if word not in cls.VERBAL_WORDS:
                cleaned_words.append(word)
        cleaned = ' '.join(cleaned_words)
        
        # 清理多余空格
        cleaned = ' '.join(cleaned.split())
        
        return cleaned
    
    @classmethod
    def find_clip_points(cls, marked_segments: List[Dict], 
                        min_duration: float = 0.2) -> List[Dict]:
        """生成剪辑点（增强版）"""
        clip_points = []
        
        for seg in marked_segments:
            if seg["is_verbal"]:
                duration = seg["end"] - seg["start"]
                
                # 根据不同类型设置不同的阈值
                if seg["verbal_type"] == "long_pause":
                    # 停顿超过1秒才剪辑
                    if duration >= 1.0:
                        clip_points.append({
                            "start": seg["start"],
                            "end": seg["end"],
                            "duration": duration,
                            "reason": seg["verbal_type"],
                            "original_text": seg["text"],
                            "cleaned_text": seg.get("cleaned_text", "")
                        })
                elif seg["verbal_type"] in ["repeat", "mistake", "connector"]:
                    # 重复、错误内容和单独连接词，阈值较低
                    if duration >= 0.1:
                        clip_points.append({
                            "start": seg["start"],
                            "end": seg["end"],
                            "duration": duration,
                            "reason": seg["verbal_type"],
                            "original_text": seg["text"],
                            "cleaned_text": seg.get("cleaned_text", "")
                        })
                elif duration >= min_duration:
                    clip_points.append({
                        "start": seg["start"],
                        "end": seg["end"],
                        "duration": duration,
                        "reason": seg["verbal_type"],
                        "original_text": seg["text"],
                        "cleaned_text": seg.get("cleaned_text", "")
                    })
        
        return clip_points
    
    @classmethod
    def find_word_level_clip_points(cls, segments: List[Dict], 
                                     min_duration: float = 0.1) -> Tuple[List[Dict], List[Dict]]:
        """字级别的剪辑点生成（精确到每个字）

        Returns:
            clip_points: 需要删除的片段列表
            word_segments: 字级别的片段列表（保留用于字幕生成）
        """
        clip_points = []
        word_segments = []
        
        for seg in segments:
            if "words" not in seg or not seg["words"]:
                word_segments.append(seg)
                continue
            
            words = seg["words"]
            seg_clip_points = []
            i = 0
            
            while i < len(words):
                word = words[i]
                word_text = word["word"].strip()
                word_start = word["start"]
                word_end = word["end"]
                
                is_verbal, verbal_type = cls._is_verbal_word(word_text)
                
                if is_verbal:
                    seg_clip_points.append({
                        "start": word_start,
                        "end": word_end,
                        "text": word_text,
                        "reason": verbal_type
                    })
                else:
                    if seg_clip_points:
                        merged = cls._merge_word_clip_points(seg_clip_points, min_duration)
                        clip_points.extend(merged)
                        seg_clip_points = []
                    
                    word_segments.append({
                        "start": word_start,
                        "end": word_end,
                        "text": word_text,
                        "is_verbal": False
                    })
                
                i += 1
            
            if seg_clip_points:
                merged = cls._merge_word_clip_points(seg_clip_points, min_duration)
                clip_points.extend(merged)
        
        return clip_points, word_segments
    
    @classmethod
    def _is_verbal_word(cls, word: str) -> Tuple[bool, str]:
        """判断单个字/词是否为口语化表达"""
        word = word.strip()
        if not word:
            return False, "normal"
        
        if word in ['嗯', '啊', '哦', '呃', '额', '呀', '嘛', '呢', '吧', '哎', '唉', '哼', '哈', '嘿', '喔']:
            return True, "filler"
        
        if len(word) <= 2 and word in cls.VERBAL_WORDS:
            return True, "verbal"
        
        if len(word) <= 2 and word in cls.MISTAKE_WORDS:
            return True, "mistake"
        
        return False, "normal"
    
    @classmethod
    def _merge_word_clip_points(cls, clip_points: List[Dict], min_duration: float) -> List[Dict]:
        """合并相邻的字级别剪辑点"""
        if not clip_points:
            return []
        
        merged = []
        current = clip_points[0].copy()
        current["duration"] = current["end"] - current["start"]
        
        for point in clip_points[1:]:
            gap = point["start"] - current["end"]
            if gap < 0.1:
                current["end"] = point["end"]
                current["text"] += point["text"]
                current["duration"] = current["end"] - current["start"]
            else:
                if current["duration"] >= min_duration:
                    merged.append(current)
                current = point.copy()
                current["duration"] = current["end"] - current["start"]
        
        if current["duration"] >= min_duration:
            merged.append(current)
        
        return merged
    
    @classmethod
    def detect_long_pauses(cls, segments: List[Dict], 
                           min_pause_duration: float = 1.0,
                           total_duration: float = None) -> List[Dict]:
        """检测长时间停顿（包括视频开头和结尾的空白）

        Args:
            segments: 识别到的片段列表
            min_pause_duration: 最小停顿时长（秒）
            total_duration: 视频总时长（可选，如果不提供则使用最后一个片段的结束时间）
        """
        clip_points = []
        
        if not segments:
            return clip_points
        
        # 检测视频开头到第一个片段的空白
        first_seg = segments[0]
        start_gap = first_seg["start"] - 0.0
        if start_gap >= min_pause_duration:
            clip_points.append({
                "start": 0.0,
                "end": first_seg["start"],
                "duration": start_gap,
                "reason": "long_pause",
                "original_text": f"[开头空白 {start_gap:.1f}秒]"
            })
        
        # 检测片段之间的停顿
        for i in range(1, len(segments)):
            prev_seg = segments[i-1]
            curr_seg = segments[i]
            
            pause_start = prev_seg["end"]
            pause_end = curr_seg["start"]
            pause_duration = pause_end - pause_start
            
            if pause_duration >= min_pause_duration:
                clip_points.append({
                    "start": pause_start,
                    "end": pause_end,
                    "duration": pause_duration,
                    "reason": "long_pause",
                    "original_text": f"[停顿 {pause_duration:.1f}秒]"
                })
        
        # 检测最后一个片段到视频结尾的空白
        last_seg = segments[-1]
        if total_duration is None:
            total_duration = last_seg["end"]
        
        end_gap = total_duration - last_seg["end"]
        if end_gap >= min_pause_duration:
            clip_points.append({
                "start": last_seg["end"],
                "end": total_duration,
                "duration": end_gap,
                "reason": "long_pause",
                "original_text": f"[结尾空白 {end_gap:.1f}秒]"
            })
        
        return clip_points


class SubtitleGenerator:
    """字幕生成器（增强版）"""
    
    @staticmethod
    def format_time(seconds: float) -> str:
        """将秒转换为 SRT 时间戳格式"""
        ms = int((seconds - int(seconds)) * 1000)
        s = int(seconds) % 60
        m = (int(seconds) // 60) % 60
        h = int(seconds) // 3600
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    
    @staticmethod
    def _remove_consecutive_duplicates(segments: List[Dict]) -> List[Dict]:
        """移除连续重复的片段"""
        if not segments:
            return segments
        
        cleaned = []
        prev_text = ""
        seen_texts = set()
        
        for seg in segments:
            text = seg.get("cleaned_text", seg["text"]).strip()
            
            # 跳过空内容
            if not text:
                continue
            
            # 跳过与前一段重复的内容（忽略标点和空格差异）
            prev_clean = ''.join(prev_text.replace(' ', '').replace('，', '').replace('。', ''))
            curr_clean = ''.join(text.replace(' ', '').replace('，', '').replace('。', ''))
            
            # 跳过已见过的内容（非连续重复）
            if curr_clean in seen_texts:
                continue
            
            if curr_clean and curr_clean != prev_clean:
                cleaned.append(seg)
                prev_text = text
                seen_texts.add(curr_clean)
        
        return cleaned
    
    @staticmethod
    def _merge_short_segments(segments: List[Dict], max_gap: float = 0.3) -> List[Dict]:
        """合并短片段和时间间隔很近的片段"""
        if not segments:
            return segments
        
        merged = []
        current = segments[0].copy()
        current["text"] = current.get("cleaned_text", current["text"]).strip()
        
        for seg in segments[1:]:
            text = seg.get("cleaned_text", seg["text"]).strip()
            
            if not text:
                continue
            
            # 检查时间间隔是否足够小
            gap = seg["start"] - current["end"]
            
            if gap <= max_gap and len(current["text"]) < 50:
                # 合并到当前片段
                current["end"] = seg["end"]
                current["text"] += " " + text
            else:
                merged.append(current)
                current = seg.copy()
                current["text"] = text
        
        if current["text"]:
            merged.append(current)
        
        return merged
    
    @staticmethod
    def generate_srt(segments: List[Dict], output_path: str, 
                    clip_points: List[Dict] = None) -> bool:
        """生成 SRT 字幕文件（与视频剪辑逻辑一致）"""
        try:
            print("   📋 原始识别片段:")
            for i, seg in enumerate(segments, 1):
                text = seg.get("cleaned_text", seg["text"]).strip()
                is_verbal = seg.get("is_verbal", False)
                print(f"      [{i}] [{seg['start']:.1f}-{seg['end']:.1f}s] {'🗑️' if is_verbal else '✓'} {text[:50]}...")
            
            # 使用与视频剪辑相同的逻辑计算保留片段
            if clip_points:
                clip_points_sorted = sorted(clip_points, key=lambda x: x["start"])
                
                keep_segments = []
                last_end = 0.0
                
                for clip in clip_points_sorted:
                    if clip["start"] > last_end + 0.01:
                        keep_segments.append({
                            "start": last_end,
                            "end": clip["start"]
                        })
                    last_end = clip["end"]
                
                total_duration = max(seg["end"] for seg in segments)
                if last_end < total_duration - 0.01:
                    keep_segments.append({
                        "start": last_end,
                        "end": total_duration
                    })
                
                # 根据保留片段过滤字幕（时间轴对齐）
                filtered_segments = []
                
                # 计算任意原始时间点在新时间轴上的位置
                # 新时间 = 原始时间 - 该时间点之前所有剪辑点的总时长
                def get_new_time(original_time):
                    deleted_before_time = 0.0
                    for clip in clip_points_sorted:
                        if clip["end"] <= original_time:
                            deleted_before_time += clip["end"] - clip["start"]
                    return original_time - deleted_before_time
                
                for seg in segments:
                    if not seg.get("is_verbal", False):
                        # 检查这个字幕片段是否在任何保留范围内
                        is_in_keep_range = False
                        for keep in keep_segments:
                            if seg["end"] > keep["start"] and seg["start"] < keep["end"]:
                                is_in_keep_range = True
                                break
                        
                        if is_in_keep_range:
                            seg_copy = seg.copy()
                            seg_copy["start"] = get_new_time(seg["start"])
                            seg_copy["end"] = get_new_time(seg["end"])
                            if seg_copy["start"] >= 0 and seg_copy["end"] > seg_copy["start"]:
                                filtered_segments.append(seg_copy)
            else:
                filtered_segments = [s for s in segments if not s.get("is_verbal", False)]
            
            # 移除连续重复
            filtered_segments = SubtitleGenerator._remove_consecutive_duplicates(filtered_segments)
            
            # 合并短片段
            filtered_segments = SubtitleGenerator._merge_short_segments(filtered_segments)
            
            # 确保片段按时间顺序排列
            filtered_segments.sort(key=lambda x: x["start"])
            
            with open(output_path, 'w', encoding='utf-8-sig') as f:
                for i, seg in enumerate(filtered_segments, 1):
                    start = SubtitleGenerator.format_time(seg["start"])
                    end = SubtitleGenerator.format_time(seg["end"])
                    text = seg["text"].strip()
                    
                    if text:
                        f.write(f"{i}\n")
                        f.write(f"{start} --> {end}\n")
                        f.write(f"{text}\n\n")
            
            print(f"✅ 字幕文件已生成: {output_path}")
            print(f"   原始片段数: {len(segments)}, 清理后: {len(filtered_segments)}")
            return True
        except Exception as e:
            print(f"❌ 生成字幕失败: {e}")
            return False
    
    @staticmethod
    def generate_srt_from_words(word_segments: List[Dict], output_path: str,
                                clip_points: List[Dict] = None) -> bool:
        """从字级别片段生成 SRT 字幕文件"""
        try:
            print("   📋 字级别片段预览:")
            for i, seg in enumerate(word_segments[:10], 1):
                print(f"      [{i}] [{seg['start']:.2f}-{seg['end']:.2f}s] {seg['text']}")
            if len(word_segments) > 10:
                print(f"      ... 还有 {len(word_segments) - 10} 个片段")
            
            if clip_points:
                clip_points_sorted = sorted(clip_points, key=lambda x: x["start"])
            else:
                clip_points_sorted = []
            
            def get_new_time(original_time):
                deleted_before_time = 0.0
                for clip in clip_points_sorted:
                    if clip["end"] <= original_time:
                        deleted_before_time += clip["end"] - clip["start"]
                return original_time - deleted_before_time
            
            adjusted_segments = []
            for seg in word_segments:
                new_start = get_new_time(seg["start"])
                new_end = get_new_time(seg["end"])
                if new_start >= 0 and new_end > new_start:
                    adjusted_segments.append({
                        "start": new_start,
                        "end": new_end,
                        "text": seg["text"]
                    })
            
            merged = SubtitleGenerator._merge_word_segments(adjusted_segments)
            
            with open(output_path, 'w', encoding='utf-8-sig') as f:
                for i, seg in enumerate(merged, 1):
                    start = SubtitleGenerator.format_time(seg["start"])
                    end = SubtitleGenerator.format_time(seg["end"])
                    text = seg["text"].strip()
                    if text:
                        f.write(f"{i}\n")
                        f.write(f"{start} --> {end}\n")
                        f.write(f"{text}\n\n")
            
            print(f"✅ 字幕文件已生成: {output_path}")
            print(f"   字级别片段数: {len(word_segments)}, 合并后: {len(merged)}")
            return True
        except Exception as e:
            print(f"❌ 生成字幕失败: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    @staticmethod
    def _merge_word_segments(segments: List[Dict], max_gap: float = 0.5, 
                             max_duration: float = 8.0) -> List[Dict]:
        """合并字级别片段为字幕片段"""
        if not segments:
            return []
        
        merged = []
        current = segments[0].copy()
        current_text = current["text"]
        
        for seg in segments[1:]:
            gap = seg["start"] - current["end"]
            duration = seg["end"] - current["start"]
            
            should_merge = (gap <= max_gap and duration < max_duration)
            
            if should_merge:
                current["end"] = seg["end"]
                current_text += seg["text"]
            else:
                current["text"] = current_text
                merged.append(current)
                current = seg.copy()
                current_text = seg["text"]
        
        current["text"] = current_text
        merged.append(current)
        
        return merged


class DraftCreator:
    """剪映草稿创建器"""
    
    @staticmethod
    def get_default_drafts_root() -> str:
        """获取默认剪映草稿目录"""
        local_app_data = os.environ.get('LOCALAPPDATA')
        user_profile = os.environ.get('USERPROFILE')
        
        candidates = []
        
        custom_path = r"D:\剪映输出物\JianyingPro Drafts"
        if os.path.exists(custom_path):
            return custom_path
        
        if local_app_data:
            candidates.extend([
                os.path.join(local_app_data, r"JianyingPro\User Data\Projects\com.lveditor.draft"),
                os.path.join(local_app_data, r"CapCut\User Data\Projects\com.lveditor.draft")
            ])
        
        if user_profile:
            candidates.append(os.path.join(user_profile, r"AppData\Local\JianyingPro\User Data\Projects\com.lveditor.draft"))
        
        fallback = r"C:\Users\Administrator\AppData\Local\JianyingPro\User Data\Projects\com.lveditor.draft"
        
        for path in candidates:
            if os.path.exists(path):
                return path
        
        return custom_path
    
    @staticmethod
    def create_draft(video_path: str, clip_points: List[Dict], 
                    draft_name: str = "verbal_cleaned",
                    subtitle_path: str = None) -> str:
        """根据剪辑点创建剪映草稿（包含字幕）"""
        if draft is None:
            raise ImportError("pyJianYingDraft 模块未正确导入")
        
        df = draft.DraftFolder(DraftCreator.get_default_drafts_root())
        
        try:
            script = df.create_draft(draft_name, 1920, 1080)
        except Exception as e:
            print(f"⚠️ 创建草稿失败，尝试覆盖现有草稿: {e}")
            script = df.create_draft(draft_name, 1920, 1080, allow_replace=True)
        
        try:
            mat = draft.VideoMaterial(video_path)
            total_duration = mat.duration / 1000000
            print(f"📹 视频时长: {total_duration:.2f}s")
        except Exception as e:
            print(f"❌ 加载视频失败: {e}")
            raise
        
        clip_points.sort(key=lambda x: x["start"])
        
        # 调试信息
        print(f"🔍 视频时长: {total_duration:.2f}s")
        print(f"🔍 剪辑点: {[(c['start'], c['end']) for c in clip_points]}")
        
        keep_segments = []
        last_end = 0.0
        
        for clip in clip_points:
            # 确保剪辑点不超过视频时长
            clip_start = min(clip["start"], total_duration)
            clip_end = min(clip["end"], total_duration)
            
            if clip_start > last_end + 0.01:
                keep_segments.append({
                    "start": last_end,
                    "end": clip_start
                })
            last_end = clip_end
        
        if last_end < total_duration - 0.01:
            keep_segments.append({
                "start": last_end,
                "end": total_duration
            })
        
        print(f"📝 保留 {len(keep_segments)} 个片段: {[(s['start'], s['end']) for s in keep_segments]}")
        
        # 确保存在视频轨道
        track_name = "VideoTrack"
        try:
            script.add_track(draft.TrackType.video, track_name)
            print(f"✅ 创建视频轨道: {track_name}")
        except Exception as e:
            # 轨道可能已存在，忽略错误
            pass
        
        current_time = 0
        for i, seg in enumerate(keep_segments):
            duration = seg["end"] - seg["start"]
            print(f"🔍 片段{i}: start={seg['start']}, end={seg['end']}, duration={duration}")
            if duration > 0.01:
                source_start = int(seg["start"] * 1000000)
                source_duration = int(duration * 1000000)
                print(f"   source_timerange: start={source_start}, duration={source_duration}")
                video_seg = draft.VideoSegment(
                    mat,
                    target_timerange=trange(int(current_time * 1000000), int(duration * 1000000)),
                    source_timerange=trange(source_start, source_duration)
                )
                script.add_segment(video_seg, track_name)
                current_time += duration
        
        # 导入字幕到草稿
        if subtitle_path and os.path.exists(subtitle_path):
            DraftCreator._import_subtitles(script, subtitle_path)
        
        script.save()
        print(f"✅ 草稿已保存: {draft_name}")
        
        return draft_name
    
    @staticmethod
    def _import_subtitles(script, srt_path: str):
        """将 SRT 字幕导入到草稿中"""
        try:
            import re
            with open(srt_path, 'r', encoding='utf-8-sig') as f:
                content = f.read()
            
            pattern = re.compile(r'(\d+)\n(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})\n((?:.+\n?)+?)(?=\n\d+\n|\n?$)', re.MULTILINE)
            matches = pattern.findall(content)
            
            def srt_to_us(srt_time: str) -> int:
                h, m, s_ms = srt_time.split(':')
                s, ms = s_ms.split(',')
                return (int(h) * 3600 + int(m) * 60 + int(s)) * 1000000 + int(ms) * 1000
            
            # 确保存在文本轨道
            text_track_name = "TextTrack"
            try:
                script.add_track(draft.TrackType.text, text_track_name)
                print(f"✅ 创建文本轨道: {text_track_name}")
            except Exception as e:
                pass
            
            count = 0
            for _, start_str, end_str, text in matches:
                start_us = srt_to_us(start_str.strip())
                end_us = srt_to_us(end_str.strip())
                duration_us = end_us - start_us
                
                clean_text = text.strip()
                if clean_text:
                    # 创建文字片段
                    style = draft.TextStyle(
                        size=4.5,
                        color=(1.0, 1.0, 1.0),
                        bold=True,
                        align=1,
                        auto_wrapping=True
                    )
                    clip_settings = draft.ClipSettings(transform_y=-0.85)
                    text_seg = draft.TextSegment(
                        clean_text,
                        trange(start_us, duration_us),
                        style=style,
                        clip_settings=clip_settings
                    )
                    script.add_segment(text_seg, text_track_name)
                    count += 1
            
            print(f"✅ 导入 {count} 条字幕到草稿")
        except Exception as e:
            print(f"⚠️ 导入字幕失败: {e}")


def process_video(video_path: str, 
                 output_draft_name: str = "verbal_cleaned",
                 model_name: str = "base",
                 min_clip_duration: float = 0.2) -> Dict:
    """
    完整的视频口语化清理流程
    
    Args:
        video_path: 输入视频文件路径
        output_draft_name: 输出草稿名称
        model_name: Whisper 模型名称 (tiny/base/small/medium/large)
        min_clip_duration: 最小剪辑时长（秒）
    
    Returns:
        {
            success: bool,
            draft_name: str,
            total_clips: int,
            removed_duration: float,
            subtitle_path: str,
            clip_points: List[Dict]
        }
    """
    print(f"🎯 开始口语化处理: {video_path}")
    print(f"📋 参数: 模型={model_name}, 最小剪辑时长={min_clip_duration}s")
    
    audio_path = None
    try:
        # 1. 提取音频
        print("\n📌 步骤1: 提取音频")
        audio_path = SpeechTranscriber.extract_audio_from_video(video_path)
        
        # 获取视频总时长（用于检测开头和结尾的空白）
        video_duration = 0.0
        if draft and VideoMaterial:
            try:
                mat = VideoMaterial(video_path)
                video_duration = mat.duration / 1000000
                print(f"   📹 视频时长: {video_duration:.2f}s")
            except Exception as e:
                print(f"   ⚠️ 获取视频时长失败: {e}")
        
        # 2. 语音转文字
        print("\n📌 步骤2: 语音转文字")
        processor = SpeechTranscriber(model_name)
        result = processor.transcribe(audio_path, word_level=True)
        print(f"   识别语言: {result['language']}")
        print(f"   识别片段数: {len(result['segments'])}")
        
        segments = result["segments"]
        has_word_level = any("words" in seg and seg["words"] for seg in segments)
        print(f"   字级别时间戳: {'可用' if has_word_level else '不可用'}")
        
        print("\n📌 步骤3: 口语化检测")
        
        all_clip_points = []
        word_segments = []
        
        if has_word_level:
            print("   使用字级别精确处理...")
            word_clips, word_segments = VerbalCleaner.find_word_level_clip_points(segments, min_clip_duration)
            pause_clips = VerbalCleaner.detect_long_pauses(segments, min_pause_duration=1.0, total_duration=video_duration)
            all_clip_points = word_clips + pause_clips
            print(f"   字级别剪辑点: {len(word_clips)} 个")
            print(f"   长时间停顿: {len(pause_clips)} 个")
        else:
            print("   使用片段级别处理...")
            marked_segments = VerbalCleaner.detect_verbal_segments(segments)
            all_clip_points = VerbalCleaner.find_clip_points(marked_segments, min_clip_duration)
        
        print("\n📌 步骤4: 生成剪辑点")
        print(f"   共检测到 {len(all_clip_points)} 个需要剪辑的片段")
        
        if all_clip_points:
            for i, clip in enumerate(all_clip_points[:5], 1):
                reason = clip.get("reason", "unknown")
                text = clip.get("text", clip.get("original_text", ""))
                print(f"   {i}. [{clip['start']:.2f}s - {clip['end']:.2f}s] ({clip.get('duration', 0):.2f}s) - {reason}: {text}")
            if len(all_clip_points) > 5:
                print(f"   ... 还有 {len(all_clip_points) - 5} 个剪辑点")
        
        print("\n📌 步骤5: 生成字幕")
        subtitle_path = os.path.splitext(video_path)[0] + "_cleaned.srt"
        
        if has_word_level and word_segments:
            SubtitleGenerator.generate_srt_from_words(word_segments, subtitle_path, all_clip_points)
        else:
            marked_segments = VerbalCleaner.detect_verbal_segments(segments)
            SubtitleGenerator.generate_srt(marked_segments, subtitle_path, all_clip_points)
        
        print("\n📌 步骤6: 创建剪映草稿（包含字幕）")
        if all_clip_points:
            DraftCreator.create_draft(video_path, all_clip_points, output_draft_name, subtitle_path)
        else:
            print("⚠️ 未检测到需要剪辑的口语化片段，跳过草稿创建")
        
        removed_duration = sum(c.get("duration", c["end"] - c["start"]) for c in all_clip_points)
        
        print("\n" + "="*50)
        print("📊 处理结果报告")
        print("="*50)
        print(f"   草稿名称: {output_draft_name}")
        print(f"   剪辑片段数: {len(all_clip_points)}")
        print(f"   移除时长: {removed_duration:.2f}s")
        print(f"   字幕文件: {subtitle_path}")
        
        if all_clip_points:
            print("\n   剪辑详情:")
            for i, clip in enumerate(all_clip_points[:10], 1):
                reason = clip.get("reason", "unknown")
                text = clip.get("text", clip.get("original_text", ""))
                print(f"   {i}. [{clip['start']:.2f}s - {clip['end']:.2f}s] ({clip.get('duration', clip['end']-clip['start']):.2f}s) - {reason}")
                print(f"      {text}")
        
        return {
            "success": True,
            "draft_name": output_draft_name,
            "total_clips": len(all_clip_points),
            "removed_duration": removed_duration,
            "subtitle_path": subtitle_path,
            "clip_points": all_clip_points
        }
    
    except Exception as e:
        print(f"\n❌ 处理失败: {e}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e)
        }
    finally:
        # 清理临时音频文件
        if audio_path and os.path.exists(audio_path):
            os.remove(audio_path)
            print(f"🧹 清理临时文件: {audio_path}")


def cli():
    import argparse
    
    parser = argparse.ArgumentParser(description="视频口语化清理工具")
    parser.add_argument("--video", required=True, help="输入视频路径")
    parser.add_argument("--name", default="verbal_cleaned", help="输出草稿名称")
    parser.add_argument("--model", default="base", help="Whisper 模型名称")
    parser.add_argument("--min-duration", type=float, default=0.2, help="最小剪辑时长(秒)")
    
    args = parser.parse_args()
    
    result = process_video(
        video_path=args.video,
        output_draft_name=args.name,
        model_name=args.model,
        min_clip_duration=args.min_duration
    )
    
    if result["success"]:
        print("\n🎉 处理完成!")
        sys.exit(0)
    else:
        print(f"\n💥 处理失败: {result.get('error', '未知错误')}")
        sys.exit(1)


if __name__ == "__main__":
    cli()
