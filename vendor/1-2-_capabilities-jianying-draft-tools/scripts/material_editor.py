#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
素材编排编辑器
根据项目配置文件，将字幕和素材关联后自动生成剪映草稿
"""

import os
import json
import sys
from typing import Dict, List, Any

# 导入 jy_wrapper
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from jy_wrapper import JyProject, tim, trange
import pyJianYingDraft as draft

class MaterialEditor:
    """素材编排编辑器"""
    
    def __init__(self, project_config_path: str, template_path: str = None):
        """
        初始化编辑器
        
        Args:
            project_config_path: 项目配置文件路径（JSON格式）
            template_path: 模板文件路径（可选），如果项目配置中指定了template，会优先使用项目配置中的
        """
        self.config_path = project_config_path
        with open(project_config_path, 'r', encoding='utf-8') as f:
            self.config = json.load(f)
        
        # 加载模板（如果指定）
        self.template = None
        template_to_load = template_path or self.config.get('template')
        if template_to_load:
            self.template = self._load_template(template_to_load, project_config_path)
            if self.template:
                print(f"✅ 已加载模板: {self.template.get('template_name', '未知模板')}")
                self._apply_template()
        
        # 初始化剪映项目（使用模板或配置中的分辨率）
        project_name = self.config.get('project_name', f'素材编排_{os.path.basename(project_config_path).replace(".json", "")}')
        
        # 优先使用模板中的分辨率，其次使用配置中的
        resolution = self.config.get('resolution', {})
        if self.template and self.template.get('resolution'):
            resolution = self.template['resolution']
        
        width = resolution.get('width', 1920)
        height = resolution.get('height', 1080)
        
        self.project = JyProject(
            project_name,
            width=width,
            height=height,
            overwrite=True
        )
        
        self.materials_folder = self.config.get('materials_folder', '.')
        if not os.path.isabs(self.materials_folder):
            # 相对路径，相对于配置文件所在目录
            config_dir = os.path.dirname(os.path.abspath(project_config_path))
            self.materials_folder = os.path.join(config_dir, self.materials_folder)
    
    def _load_template(self, template_path: str, project_config_path: str) -> Dict:
        """
        加载模板文件
        
        Args:
            template_path: 模板文件路径（可以是相对路径或绝对路径）
            project_config_path: 项目配置文件路径，用于解析相对路径
        
        Returns:
            模板配置字典，如果加载失败返回None
        """
        try:
            # 如果是相对路径，相对于项目配置文件所在目录
            if not os.path.isabs(template_path):
                config_dir = os.path.dirname(os.path.abspath(project_config_path))
                template_path = os.path.join(config_dir, template_path)
            
            if not os.path.exists(template_path):
                print(f"⚠️ 模板文件不存在: {template_path}")
                return None
            
            with open(template_path, 'r', encoding='utf-8') as f:
                template = json.load(f)
            return template
        except Exception as e:
            print(f"⚠️ 加载模板失败: {e}")
            return None
    
    def _apply_template(self):
        """应用模板到项目配置"""
        if not self.template:
            return
        
        # 合并 default_effects（模板优先级更高，但项目配置可以覆盖）
        template_effects = self.template.get('default_effects', {})
        config_effects = self.config.get('default_effects', {})
        
        # 深度合并 subtitle_style
        if 'subtitle_style' in template_effects:
            if 'subtitle_style' not in config_effects:
                config_effects['subtitle_style'] = {}
            # 模板值作为默认值，项目配置可以覆盖
            for key, value in template_effects['subtitle_style'].items():
                if key not in config_effects['subtitle_style']:
                    config_effects['subtitle_style'][key] = value
        
        # 合并其他 default_effects
        for key, value in template_effects.items():
            if key != 'subtitle_style' and key not in config_effects:
                config_effects[key] = value
        
        self.config['default_effects'] = config_effects
        
        # 应用分辨率（如果项目配置中没有）
        if 'resolution' not in self.config and 'resolution' in self.template:
            self.config['resolution'] = self.template['resolution']
        
        # 保存模板引用到配置中（用于调试）
        self.config['_template_applied'] = self.template.get('template_name', '未知模板')
    
    def process_associations(self, auto_save: bool = True):
        """
        处理所有关联关系，生成剪映草稿
        
        Args:
            auto_save: 是否自动保存草稿，默认为True。如果为False，需要手动调用save()方法
        """
        print("=" * 60)
        print(f"开始处理素材关联...")
        project_name = self.config.get('project_name', f'素材编排_{os.path.basename(self.config_path).replace(".json", "")}')
        print(f"项目名称: {project_name}")
        
        # 确保 associations 按时间排序
        associations = self.config.get('associations', [])
        if associations:
            # 按开始时间排序
            associations.sort(key=lambda x: self._srt_time_to_seconds(x.get('subtitle_start', '00:00:00,000')))
            print(f"✅ 已按时间顺序排序 {len(associations)} 个字幕")
        
        print(f"字幕数量: {len(associations)}")
        print("=" * 60)
        
        # 添加标题（如果配置中有且模板支持）
        video_title = self.config.get('video_title', '')
        if video_title and self.template:
            title_template = self.template.get('title_template', {})
            if title_template.get('enabled', False):
                self._add_title(video_title, title_template)
        
        # 初始化片段列表和转场状态
        self._last_segments = []
        self._pending_transition_in = None
        
        for idx, assoc in enumerate(associations, 1):
            print(f"\n处理字幕 {idx}/{len(associations)}: {assoc['subtitle_text'][:30]}...")
            
            # 计算开始时间（使用字幕的开始时间，转换为微秒）
            start_time_seconds = self._srt_time_to_seconds(assoc['subtitle_start'])
            start_time = start_time_seconds  # 保持为秒，jy_wrapper会处理
            duration = assoc['subtitle_duration']
            
            # 处理每个素材
            materials = assoc.get('materials', [])
            
            # 应用待处理的入场转场
            if self._pending_transition_in and self._last_segments:
                self._apply_transition(self._last_segments[-1], self._pending_transition_in, 'in')
                self._pending_transition_in = None
            
            if not materials:
                print(f"  ⚠️ 字幕 {idx} 没有关联素材，跳过")
                # 即使没有素材，也要添加字幕
                self._add_subtitle(assoc, start_time, duration)
                continue
            
            # 根据布局模式处理素材
            layout_mode = materials[0].get('layout', {}).get('mode', 'single')
            
            if layout_mode == 'single':
                # 单素材模式
                if len(materials) == 1:
                    # 一个素材对应一个字幕
                    self._add_single_material(materials[0], start_time, duration, assoc)
                else:
                    # 多个素材对应一个字幕，按顺序显示
                    self._add_multiple_materials_sequential(materials, start_time, duration, assoc)
            else:
                # 多素材模式（画中画、分屏等）
                self._add_multiple_materials_parallel(materials, start_time, duration, assoc)
            
            # 添加字幕
            self._add_subtitle(assoc, start_time, duration)
            
            # 添加特效（如果有配置）
            if assoc.get('effects'):
                self._add_effects(assoc['effects'], start_time, duration)
        
        # 保存草稿（如果启用自动保存）
        if auto_save:
            print("\n" + "=" * 60)
            print("保存剪映草稿...")
            self.project.save()
            print("✅ 草稿生成完成！")
            print("=" * 60)
        else:
            print("\n" + "=" * 60)
            print("✅ 素材关联处理完成（未自动保存，请手动调用save()方法）")
            print("=" * 60)
    
    def add_background_audio(self, audio_path: str, start_time: str = "0s", track_name: str = "BackgroundAudio"):
        """
        添加背景音频
        
        Args:
            audio_path: 音频文件路径
            start_time: 开始时间，默认为"0s"
            track_name: 音频轨道名称，默认为"BackgroundAudio"
        
        Returns:
            成功返回True，失败返回False
        """
        if not os.path.exists(audio_path):
            print(f"⚠️ 音频文件不存在: {audio_path}")
            return False
        
        try:
            print(f"🎵 添加背景音频: {os.path.basename(audio_path)}")
            self.project.add_audio_safe(
                audio_path,
                start_time=start_time,
                duration=None,  # 使用完整音频长度
                track_name=track_name
            )
            print(f"✅ 已添加背景音频")
            return True
        except Exception as e:
            print(f"⚠️ 添加音频失败: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def save(self):
        """保存草稿"""
        print("\n" + "=" * 60)
        print("保存剪映草稿...")
        self.project.save()
        print("✅ 草稿生成完成！")
        print("=" * 60)
    
    def _add_single_material(self, material: Dict, start_time: float, duration: float, assoc: Dict):
        """添加单个素材"""
        file_path = os.path.join(self.materials_folder, material['file'])
        
        if not os.path.exists(file_path):
            print(f"  ❌ 素材文件不存在: {file_path}")
            return
        
        print(f"  📹 添加素材: {material['file']}")
        
        # 应用模板的媒体布局设置（如果模板中有）
        media_layout = None
        if self.template and self.template.get('media_layout'):
            media_layout = self.template['media_layout']
        
        # 准备clip_settings（如果有媒体布局）
        clip_settings = None
        if media_layout:
            try:
                from pyJianYingDraft import ClipSettings
                transform_y = media_layout.get('transform_y', 0)
                clip_settings = ClipSettings(transform_y=transform_y)
                scale = media_layout.get('scale', 1.0)
                print(f"  📐 应用布局: 居中, Y偏移={transform_y}, 缩放={scale}")
            except Exception as e:
                print(f"  ⚠️ 创建布局设置失败: {e}")
        
        # 添加视频/图片
        # 注意：start_time 可以是秒数（浮点数）或时间字符串
        if material['type'] == 'video':
            seg = self.project.add_media_safe(
                file_path,
                start_time=f"{start_time:.3f}s" if isinstance(start_time, float) else start_time,
                duration=f"{duration:.3f}s"
            )
            
            # 应用智能缩放（如果有events.json）
            if material.get('events_json'):
                events_path = os.path.join(self.materials_folder, material['events_json'])
                if os.path.exists(events_path):
                    print(f"  🎯 应用智能缩放: {material['events_json']}")
                    self.project.apply_smart_zoom(seg, events_path, zoom_scale=150)
        else:
            # 图片
            seg = self.project.add_media_safe(
                file_path,
                start_time=f"{start_time:.3f}s" if isinstance(start_time, float) else start_time,
                duration=f"{duration:.3f}s"
            )
        
        # 应用媒体布局（居中、缩放等）
        if media_layout and seg and clip_settings:
            try:
                if hasattr(seg, 'clip_settings'):
                    seg.clip_settings = clip_settings
                elif hasattr(seg, 'set_clip_settings'):
                    seg.set_clip_settings(clip_settings)
                else:
                    # 尝试直接设置属性
                    seg.clip_settings = clip_settings
            except Exception as e:
                print(f"  ⚠️ 应用布局失败: {e}")
        
        # 保存片段引用，用于后续添加转场
        current_material_type = material['type']
        prev_material_type = None
        if len(self._last_segments) > 0:
            # 获取上一个素材的类型（需要从上下文推断）
            prev_material_type = getattr(self, '_last_material_type', None)
        
        self._last_material_type = current_material_type
        
        # 应用转场效果（优先使用素材配置，其次使用模板规则）
        transition_in = material.get('transition_in')
        if not transition_in and self.template:
            # 从模板获取转场规则
            transition_template = self.template.get('transition_template', {})
            if prev_material_type and current_material_type:
                transition_key = f"{prev_material_type}_to_{current_material_type}"
                transition_in = transition_template.get(transition_key) or transition_template.get('default')
        
        if transition_in:
            # 入场转场：添加到前一个片段（如果有）
            if len(self._last_segments) > 0:
                prev_seg = self._last_segments[-1]
                self._apply_transition(prev_seg, transition_in, 'in')
            else:
                # 第一个片段，保存待处理
                self._pending_transition_in = transition_in
        
        transition_out = material.get('transition_out')
        if not transition_out and self.template:
            # 从模板获取默认转场
            transition_template = self.template.get('transition_template', {})
            transition_out = transition_template.get('default')
        
        if transition_out:
            # 出场转场：添加到当前片段
            self._apply_transition(seg, transition_out, 'out')
        
        self._last_segments.append(seg)
    
    def _add_multiple_materials_sequential(self, materials: List[Dict], start_time: float, total_duration: float, assoc: Dict):
        """添加多个素材（顺序显示）"""
        # 平均分配时长
        duration_per_material = total_duration / len(materials)
        current_start = start_time
        
        for i, material in enumerate(materials):
            self._add_single_material(material, current_start, duration_per_material, assoc)
            current_start += duration_per_material
    
    def _add_multiple_materials_parallel(self, materials: List[Dict], start_time: float, duration: float, assoc: Dict):
        """添加多个素材（并行显示，画中画/分屏）"""
        # TODO: 实现多素材并行布局
        # 目前先按顺序添加，后续可以扩展为真正的并行布局
        print(f"  ⚠️ 多素材并行布局暂未实现，使用顺序布局")
        self._add_multiple_materials_sequential(materials, start_time, duration, assoc)
    
    def _add_title(self, title_text: str, title_template: Dict):
        """添加标题"""
        if not title_text or not title_template.get('enabled', False):
            return
        
        try:
            from pyJianYingDraft import TextStyle, ClipSettings, trange, tim
            from pyJianYingDraft import TextIntro, TextBorder
            
            # 确保文本轨道存在
            self.project._ensure_track(draft.TrackType.text, "TitleTrack")
            
            # 获取样式配置
            style_config = title_template.get('style', {})
            font_size = style_config.get('size', 32)
            color_rgb = self._hex_to_rgb(style_config.get('color', '#FFFFFF'))
            bold = style_config.get('bold', True)
            align = style_config.get('align', 1)
            border_color = self._hex_to_rgb(style_config.get('border_color', '#000000'))
            border_width = style_config.get('border_width', 20.0)
            
            # 创建样式
            style = TextStyle(
                size=font_size,
                color=color_rgb,
                bold=bold,
                align=align,
                auto_wrapping=True
            )
            
            # 位置在画面上方
            transform_y = title_template.get('transform_y', 0.85)
            clip = ClipSettings(transform_y=transform_y)
            
            # 计算时长（如果duration为0，则使用视频总时长）
            duration = title_template.get('duration', 0)
            if duration <= 0:
                # 计算总时长
                associations = self.config.get('associations', [])
                if associations:
                    last_assoc = max(associations, key=lambda x: self._srt_time_to_seconds(x.get('subtitle_end', '00:00:00,000')))
                    duration = self._srt_time_to_seconds(last_assoc.get('subtitle_end', '00:00:00,000'))
                else:
                    duration = 10.0  # 默认10秒
            
            # 创建文本片段
            start_us = tim("0s")
            dur_us = tim(f"{duration:.3f}s")
            seg = draft.TextSegment(
                title_text,
                trange(start_us, dur_us),
                style=style,
                clip_settings=clip
            )
            
            # 添加描边
            try:
                border = TextBorder(
                    color=border_color,
                    width=border_width,
                    alpha=1.0
                )
                seg.border = border
            except Exception as e:
                print(f"  ⚠️ 设置标题描边失败: {e}")
            
            # 添加入场动画
            anim_name = style_config.get('anim_in')
            if anim_name:
                try:
                    from jy_wrapper import _resolve_enum
                    anim = _resolve_enum(TextIntro, anim_name)
                    if anim:
                        seg.add_animation(anim)
                except Exception as e:
                    print(f"  ⚠️ 添加标题动画失败: {e}")
            
            # 添加到标题轨道
            self.project.script.add_segment(seg, "TitleTrack")
            print(f"  📝 已添加标题: {title_text}")
        except Exception as e:
            print(f"  ⚠️ 添加标题失败: {e}")
            import traceback
            traceback.print_exc()
    
    def _add_subtitle(self, assoc: Dict, start_time: float, duration: float):
        """添加字幕（带背景和描边，确保清晰可见）"""
        subtitle_style = self.config.get('default_effects', {}).get('subtitle_style', {})
        
        # 转换时间为字符串格式
        start_time_str = f"{start_time:.3f}s" if isinstance(start_time, float) else start_time
        duration_str = f"{duration:.3f}s"
        
        # 使用增强的字幕添加方法
        self._add_subtitle_enhanced(
            assoc['subtitle_text'],
            start_time_str,
            duration_str,
            subtitle_style
        )
    
    def _add_subtitle_enhanced(self, text: str, start_time: str, duration: str, style_config: Dict):
        """添加增强字幕（带背景、描边、阴影）"""
        from pyJianYingDraft import TextStyle, TextBorder, ClipSettings
        from pyJianYingDraft import trange, tim
        
        # 确保文本轨道存在
        self.project._ensure_track(draft.TrackType.text, "TextTrack")
        
        # 获取样式配置（优先使用模板中的subtitle_template）
        transform_y = -0.85  # 默认值
        if self.template and self.template.get('subtitle_template'):
            template_subtitle = self.template['subtitle_template']
            # 合并模板和配置的样式（配置优先级更高）
            template_style = template_subtitle.get('style', {})
            for key, value in template_style.items():
                if key not in style_config:
                    style_config[key] = value
            # 从模板获取位置
            template_transform_y = template_subtitle.get('transform_y')
            if template_transform_y is not None:
                transform_y = template_transform_y
        
        font_size = style_config.get('size', 5)  # 默认字体大小5（根据用户要求）
        color_rgb = self._hex_to_rgb(style_config.get('color', '#FFFFFF'))
        bold = style_config.get('bold', True)  # 默认加粗
        align = style_config.get('align', 1)  # 1=居中
        
        # 创建描边（黑色描边，确保字幕清晰可见）
        border_color = self._hex_to_rgb(style_config.get('border_color', '#000000'))
        border_width = style_config.get('border_width', 15.0)  # 描边宽度（0-100范围，默认15，更合理）
        
        try:
            border = TextBorder(
                color=border_color,
                width=border_width,
                alpha=1.0
            )
        except Exception as e:
            print(f"  ⚠️ 创建描边失败: {e}，使用默认样式")
            border = None
        
        # 创建TextStyle（不带border参数，因为TextStyle不支持）
        style = TextStyle(
            size=font_size,
            color=color_rgb,
            bold=bold,
            align=align,
            auto_wrapping=True
        )
        
        # 位置在画面下方（从模板或配置中获取）
        clip = ClipSettings(transform_y=transform_y)
        
        # 创建文本片段
        start_us = tim(start_time)
        dur_us = tim(duration)
        seg = draft.TextSegment(
            text,
            trange(start_us, dur_us),
            style=style,
            clip_settings=clip
        )
        
        # 添加描边（在创建片段后设置）
        if border:
            try:
                seg.border = border
                print(f"  ✏️ 添加描边: 宽度{border_width}")
            except Exception as e:
                print(f"  ⚠️ 设置描边失败: {e}")
        
        # 添加入场动画（可选，默认使用渐显）
        anim_name = style_config.get('anim_in', '渐显')
        if anim_name:
            try:
                from jy_wrapper import _resolve_enum
                from pyJianYingDraft import TextIntro
                anim = _resolve_enum(TextIntro, anim_name)
                if anim:
                    seg.add_animation(anim)
                    print(f"  🎬 添加字幕动画: {anim_name}")
            except Exception as e:
                print(f"  ⚠️ 添加字幕动画失败: {e}")
        
        # 添加到文本轨道
        self.project.script.add_segment(seg, "TextTrack")
    
    def _apply_transition(self, segment, transition_type: str, direction: str):
        """应用转场效果"""
        if not segment:
            return
        
        try:
            from jy_wrapper import _resolve_enum
            from pyJianYingDraft import TransitionType
            
            # 解析转场类型
            trans_enum = _resolve_enum(TransitionType, transition_type)
            if not trans_enum:
                print(f"  ⚠️ 转场类型 '{transition_type}' 未找到，跳过")
                return
            
            # 转场时长（默认0.5秒）
            duration = "0.5s"
            
            # 添加转场（转场应该添加在前面的片段上）
            if direction == 'out':
                segment.add_transition(trans_enum, duration=duration)
                print(f"  🔗 添加转场: {transition_type} (出场)")
            elif direction == 'in':
                # 入场转场需要添加到前一个片段
                if hasattr(self, '_last_segments') and len(self._last_segments) > 1:
                    prev_seg = self._last_segments[-2]
                    prev_seg.add_transition(trans_enum, duration=duration)
                    print(f"  🔗 添加转场: {transition_type} (入场)")
        except Exception as e:
            print(f"  ⚠️ 添加转场失败: {e}")
    
    def _srt_time_to_seconds(self, srt_time: str) -> float:
        """将SRT时间格式转换为秒数"""
        # 格式: 00:00:00,000 或 00:00:00.000
        srt_time = srt_time.replace(',', '.')
        time_part, ms_part = srt_time.split('.')
        h, m, s = map(int, time_part.split(':'))
        ms = int(ms_part)
        return h * 3600 + m * 60 + s + ms / 1000.0
    
    def _add_effects(self, effects: List[str], start_time: float, duration: float):
        """添加特效"""
        for effect_name in effects:
            try:
                start_time_str = f"{start_time:.3f}s" if isinstance(start_time, float) else start_time
                duration_str = f"{duration:.3f}s"
                
                self.project.add_effect_simple(
                    effect_name,
                    start_time=start_time_str,
                    duration=duration_str
                )
                print(f"  ✨ 添加特效: {effect_name}")
            except Exception as e:
                print(f"  ⚠️ 添加特效失败 {effect_name}: {e}")
    
    def _hex_to_rgb(self, hex_color: str) -> tuple:
        """将十六进制颜色转换为RGB元组（0-1范围）"""
        hex_color = hex_color.lstrip('#')
        if len(hex_color) != 6:
            return (1.0, 1.0, 1.0)  # 默认白色
        r = int(hex_color[0:2], 16) / 255.0
        g = int(hex_color[2:4], 16) / 255.0
        b = int(hex_color[4:6], 16) / 255.0
        return (r, g, b)


def main():
    """命令行入口"""
    import argparse
    
    parser = argparse.ArgumentParser(description="素材编排编辑器 - 根据配置文件生成剪映草稿")
    parser.add_argument("config", help="项目配置文件路径（JSON格式）")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.config):
        print(f"❌ 配置文件不存在: {args.config}")
        sys.exit(1)
    
    try:
        editor = MaterialEditor(args.config)
        editor.process_associations()
    except Exception as e:
        print(f"❌ 处理失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

