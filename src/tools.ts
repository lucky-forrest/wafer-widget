// 默认颜色（灰色）
const DEFAULT_COLOR: [number, number, number, number] = [0.5, 0.5, 0.5, 1];

export function colorToHex(color: string) {
  // 创建一个临时div元素，用于计算颜色
  const tempDiv = document.createElement('div');
  tempDiv.style.color = color;
  document.body.append(tempDiv);

  // 获取计算后的颜色值
  const computedColor = window.getComputedStyle(tempDiv).color;

  // 移除临时div
  tempDiv.remove();

  // 将rgb/rgba颜色转换为十六进制
  const rgbMatch = computedColor.match(
    /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)$/i,
  );
  if (rgbMatch && rgbMatch.length >= 4) {
    const r = Number.parseInt(rgbMatch[1] as string)
      .toString(16)
      .padStart(2, '0');
    const g = Number.parseInt(rgbMatch[2] as string)
      .toString(16)
      .padStart(2, '0');
    const b = Number.parseInt(rgbMatch[3] as string)
      .toString(16)
      .padStart(2, '0');
    return `#${r}${g}${b}`.toLowerCase();
  }

  // 如果已经是十六进制颜色，直接返回
  const hexMatch = computedColor.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    return computedColor.toLowerCase();
  }

  // 如果无法解析，返回默认黑色
  return '#000000';
}

export function createFunction<T>(
  content: string,
  describe: string = '自定义方法内部异常',
): (arg: unknown) => T {
  try {
    return new Function('params', `${content}`) as any;
    //     const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    // return new AsyncFunction('params', `${content}`);
  } catch (error) {
    console.info(
      `%c创建自定义方法【${describe}】发生错误！`,
      'color: white; font-size: 12px; background: red;',
    );
    console.log(error);
    return (() => {}) as any;
  }
}

// 颜色插值函数（支持多色渐变）
export function getInterpolatedColor(ratio: number, colors: string[]) {
  const segments = colors.length - 1;
  const segment = Math.min(Math.floor(ratio * segments), segments - 1);
  const segRatio = ratio * segments - segment;

  const c1 = hexToRgb(colors[segment] as string);
  const c2 = hexToRgb(colors[segment + 1] as string);

  const r = c1.r + (c2.r - c1.r) * segRatio;
  const g = c1.g + (c2.g - c1.g) * segRatio;
  const b = c1.b + (c2.b - c1.b) * segRatio;

  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

// 十六进制转RGB
export function hexToRgb(hex: string) {
  const bigint = Number.parseInt(hex.slice(1), 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

/**
 * 将颜色字符串转换为WebGL格式的颜色数组
 * @param color 支持的颜色格式: #RGB, #RRGGBB, CSS颜色名称, rgb(), rgba()
 * @param alpha 可选透明度 (0.0-1.0)，默认1.0
 * @returns WebGL格式的颜色数组 [r, g, b, a]，范围0.0-1.0
 * @throws 如果颜色格式无效
 */
export function hexToWebGLColor(
  color: string,
  alpha: number = 1,
): [number, number, number, number] {
  // 规范化alpha值
  const normalizedAlpha = Math.min(1, Math.max(0, alpha));

  // 创建临时canvas用于颜色解析（仅当缓存未命中时执行）
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return DEFAULT_COLOR;
  }

  try {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const pixel: [number, number, number] = ctx.getImageData(0, 0, 1, 1)
      .data as any as [number, number, number];

    // 计算并缓存结果
    const result: [number, number, number, number] = [
      pixel[0] / 255,
      pixel[1] / 255,
      pixel[2] / 255,
      normalizedAlpha,
    ];

    return result;
  } catch {
    return DEFAULT_COLOR;
  }
}

export function createUuid(): string {
  const s: any[] = [];
  const hexDigits = "0123456789abcdef";
  for (let i = 0; i < 36; i++) {
    const m = Math.floor(Math.random() * 0x10);
    s[i] = hexDigits.slice(m, m + 1);
  }
  s[14] = "4";
  const n = (s[19] & 0x3) | 0x8;
  s[19] = hexDigits.slice(n, n + 1);
  s[8] = s[13] = s[18] = s[23] = "-";
  const uuid = s.join("");
  return uuid;
}