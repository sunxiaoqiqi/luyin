"""辅助函数，主要与模板模式有关"""

import inspect

from typing import Union, Type
from typing import List, Dict, Any

JsonExportable = Union[int, float, bool, str, List["JsonExportable"], Dict[str, "JsonExportable"]]

def provide_ctor_defaults(cls: Type) -> Dict[str, Any]:
    """为构造函数提供默认值，以绕开构造函数的参数限制"""

    signature = inspect.signature(cls.__init__)
    provided_defaults: Dict[str, Any] = {}

    for name, param in signature.parameters.items():
        if name == 'self': continue
        if param.default is not inspect.Parameter.empty: continue

        if param.annotation is int or param.annotation is float:
            provided_defaults[name] = 0
        elif param.annotation is str:
            provided_defaults[name] = ""
        elif param.annotation is bool:
            provided_defaults[name] = False
        else:
            raise ValueError(f"Unsupported parameter type: {param.annotation}")

    return provided_defaults

def assign_attr_with_json(obj: object, attrs: List[str], json_data: Dict[str, Any]):
    """根据json数据赋值给指定的对象属性

    若有复杂类型，则尝试调用其`import_json`方法进行构造
    """
    type_hints: Dict[str, Type] = {}
    for cls in obj.__class__.__mro__:
        # 尝试从 __dict__ 和 __annotations__ 获取类型注解
        if hasattr(cls, '__annotations__'):
            annotations = getattr(cls, '__annotations__', {})
            if annotations:
                type_hints.update(annotations)
        # 也尝试从 __dict__ 中获取（Python 3.10+ 的行为）
        if '__annotations__' in cls.__dict__:
            type_hints.update(cls.__dict__['__annotations__'])

    for attr in attrs:
        if attr not in json_data:
            # 如果 JSON 数据中没有该属性，跳过
            continue
        
        if attr not in type_hints:
            # 如果类型注解中没有该属性，直接设置值（不进行类型转换）
            obj.__setattr__(attr, json_data[attr])
            continue
            
        attr_type = type_hints[attr]
        if hasattr(attr_type, 'import_json'):
            obj.__setattr__(attr, attr_type.import_json(json_data[attr]))
        else:
            # 尝试类型转换
            try:
                obj.__setattr__(attr, attr_type(json_data[attr]))
            except (TypeError, ValueError):
                # 如果类型转换失败，直接设置值
                obj.__setattr__(attr, json_data[attr])

def export_attr_to_json(obj: object, attrs: List[str]) -> Dict[str, JsonExportable]:
    """将对象属性导出为json数据

    若有复杂类型，则尝试调用其`export_json`方法进行导出
    """
    json_data: Dict[str, Any] = {}
    for attr in attrs:
        if hasattr(getattr(obj, attr), 'export_json'):
            json_data[attr] = getattr(obj, attr).export_json()
        else:
            json_data[attr] = getattr(obj, attr)
    return json_data
