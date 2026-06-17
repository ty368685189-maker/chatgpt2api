from __future__ import annotations

import base64
import io
import random
from PIL import Image, ImageDraw, ImageFont


def generate_captcha() -> tuple[str, str]:
    """
    生成图形验证码
    返回：(验证码文本, Base64 图片 DataURL)
    """
    # 随机生成 4 位数字验证码
    code = "".join(random.choices("0123456789", k=4))

    # 创建画布
    width, height = 120, 45
    image = Image.new("RGB", (width, height), color=(245, 245, 243))
    draw = ImageDraw.Draw(image)

    # 绘制干扰线
    for _ in range(5):
        x1 = random.randint(0, width)
        y1 = random.randint(0, height)
        x2 = random.randint(0, width)
        y2 = random.randint(0, height)
        draw.line((x1, y1, x2, y2), fill=(200, 200, 200), width=1)

    # 绘制干扰点
    for _ in range(50):
        draw.point((random.randint(0, width), random.randint(0, height)), fill=(180, 180, 180))

    # 载入默认字体
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None

    # 绘制字符
    for i, char in enumerate(code):
        x = 15 + i * 25 + random.randint(-3, 3)
        y = 12 + random.randint(-4, 4)
        fill = (random.randint(20, 80), random.randint(20, 80), random.randint(20, 80))
        # 简单绘制多次模拟加粗，因为 load_default 字体较细
        draw.text((x, y), char, fill=fill, font=font)
        draw.text((x + 1, y), char, fill=fill, font=font)
        draw.text((x, y + 1), char, fill=fill, font=font)

    # 保存为 PNG 并转为 base64
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    img_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

    return code, f"data:image/png;base64,{img_b64}"
