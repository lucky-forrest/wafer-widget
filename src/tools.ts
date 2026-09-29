// 默认颜色（灰色）
const DEFAULT_COLOR: [number, number, number, number] = [0.5, 0.5, 0.5, 1];

// 颜色换算缓存（热循环中颜色值高度重复，缓存可显著减少 canvas 取像素次数）
const hexColorCache = new Map<string, number[]>();
const gradientColorCache = new Map<string, Map<number, number[]>>();

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

  // 生成缓存键
  const cacheKey = `${alpha}_${color}`;

  // 检查缓存
  const cached = hexColorCache.get(cacheKey);
  if (cached) {
    return cached as [number, number, number, number];
  }

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

    hexColorCache.set(cacheKey, result);
    canvas.remove();
    return result;
  } catch {
    canvas.remove();
    return DEFAULT_COLOR;
  }
}

// RGB对象转十六进制
export function rgbToHex({ r, g, b }: { r: number; g: number; b: number }) {
  const toHex = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// 颜色插值（支持多色渐变）
function interpolateColor(
  color1: { r: number; g: number; b: number },
  color2: { r: number; g: number; b: number },
  factor: number,
): { r: number; g: number; b: number } {
  return {
    r: color1.r + (color2.r - color1.r) * factor,
    g: color1.g + (color2.g - color1.g) * factor,
    b: color1.b + (color2.b - color1.b) * factor,
  };
}

/**
 * 生成 0-100 渐变色映射（WebGL 颜色数组），结果按颜色列表与透明度缓存。
 */
export function generateGradientMap(
  colors: string[],
  alpha: number = 1,
): Map<number, number[]> {
  // 生成缓存键
  const cacheKey = `${alpha}_${colors.join(',')}`;

  // 检查缓存
  if (gradientColorCache.has(cacheKey)) {
    return gradientColorCache.get(cacheKey) as Map<number, number[]>;
  }
  if (colors.length < 2) {
    throw new Error('At least two colors are required');
  }

  // 将十六进制颜色转换为RGB
  const rgbColors = colors.map((color) => hexToRgb(color));
  const gradientMap = new Map<number, number[]>();

  // 计算每个颜色区间的长度
  const segmentLength = 100 / (rgbColors.length - 1);

  for (let i = 0; i <= 100; i++) {
    // 确定当前百分比落在哪个颜色区间
    const segmentIndex = Math.min(
      Math.floor(i / segmentLength),
      rgbColors.length - 2,
    );

    // 计算在当前区间内的位置因子 (0-1)
    const factor = (i - segmentIndex * segmentLength) / segmentLength;

    // 插值计算当前颜色
    const interpolatedColor = interpolateColor(
      rgbColors[segmentIndex] as any,
      rgbColors[segmentIndex + 1] as any,
      factor,
    );

    // 转换为十六进制并存入映射
    gradientMap.set(i, hexToWebGLColor(rgbToHex(interpolatedColor), alpha));
  }
  // 存入缓存
  gradientColorCache.set(cacheKey, gradientMap);
  return gradientMap;
}

type HeatmapHslColor = { h: number; s: number; l: number };

function normalizeHeatmapHexColor(color: string): string | undefined {
  const value = color.replace('#', '');
  const normalized =
    value.length === 3
      ? [...value].map((item) => `${item}${item}`).join('')
      : value;
  return /^[\da-f]{6}$/i.test(normalized) ? normalized : undefined;
}

function heatmapHexToHsl(color: string): HeatmapHslColor | undefined {
  const value = normalizeHeatmapHexColor(color);
  if (!value) return undefined;
  const red = Number.parseInt(value.slice(0, 2), 16) / 255;
  const green = Number.parseInt(value.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l: lightness };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }
  hue *= 60;
  if (hue < 0) hue += 360;
  return { h: hue, s: saturation, l: lightness };
}

function heatmapHslToHex({ h, s, l }: HeatmapHslColor): string {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const hue = ((h % 360) + 360) % 360;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  let match: number[];
  if (hue < 60) {
    match = [chroma, x, 0];
  } else if (hue < 120) {
    match = [x, chroma, 0];
  } else if (hue < 180) {
    match = [0, chroma, x];
  } else if (hue < 240) {
    match = [0, x, chroma];
  } else if (hue < 300) {
    match = [x, 0, chroma];
  } else {
    match = [chroma, 0, x];
  }
  const lightnessOffset = l - chroma / 2;
  return `#${match
    .map((channel) =>
      Math.round((channel + lightnessOffset) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function interpolateHeatmapHexColor(colors: string[], ratio: number): string {
  const position = Math.min(1, Math.max(0, ratio)) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(position));
  const factor = position - index;
  const from = normalizeHeatmapHexColor(colors[index] as string);
  const to = normalizeHeatmapHexColor(colors[index + 1] as string);
  if (!from || !to) return '#000000';
  const channel = (offset: number) =>
    Math.round(
      Number.parseInt(from.slice(offset, offset + 2), 16) * (1 - factor) +
        Number.parseInt(to.slice(offset, offset + 2), 16) * factor,
    )
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/**
 * 生成区间图例使用的离散颜色。返回顺序为最大值区间到最小值区间，
 * 与图例展示及区间模式下 Wafer 的颜色映射保持一致。
 */
export function generateDistinctHeatmapIntervalColors(
  colors: string[],
  count: number,
): string[] {
  const palette = colors.filter(Boolean);
  const safeColors =
    palette.length > 1 ? palette : ['#0000FF', '#00FF00', '#FF0000'];
  const safeCount = Number.isInteger(count)
    ? Math.min(20, Math.max(2, count))
    : 10;
  const hslColors = safeColors.map((color) => heatmapHexToHsl(color));
  const canUseHsl = hslColors.every((color) => color !== undefined);
  return Array.from({ length: safeCount }, (_, displayIndex) => {
    const ratio = (displayIndex + 0.5) / safeCount;
    if (!canUseHsl) {
      return interpolateHeatmapHexColor(safeColors, ratio);
    }
    const position = ratio * (hslColors.length - 1);
    const index = Math.min(hslColors.length - 2, Math.floor(position));
    const factor = position - index;
    const from = hslColors[index] as HeatmapHslColor;
    const to = hslColors[index + 1] as HeatmapHslColor;
    let hueDelta = to.h - from.h;
    if (hueDelta > 180) hueDelta -= 360;
    if (hueDelta < -180) hueDelta += 360;
    const lightnessOffset = Math.min(0.12, 1.2 / safeCount);
    return heatmapHslToHex({
      h: from.h + hueDelta * factor,
      s: from.s + (to.s - from.s) * factor,
      l: Math.min(
        0.88,
        Math.max(
          0.12,
          from.l +
            (to.l - from.l) * factor +
            (displayIndex % 2 === 0 ? lightnessOffset : -lightnessOffset),
        ),
      ),
    });
  });
}

/** 清空颜色换算缓存（长生命周期页面可定期调用释放内存） */
export function clearColorCache() {
  gradientColorCache.clear();
  hexColorCache.clear();
}

/**
 * 线性映射函数，支持将源范围的值映射到目标范围
 */
export function linearMap(
  value: number,
  sourceMin: number,
  sourceMax: number,
  targetMin: number = 0,
  targetMax: number = 100,
  clamp: boolean = true,
): number {
  // 参数验证
  if (sourceMin >= sourceMax) {
    sourceMin -= 0;
    sourceMax += 1;
    console.error(
      `Invalid source range: sourceMin (${sourceMin}) must be less than sourceMax (${sourceMax})`,
    );
  }

  if (targetMin >= targetMax) {
    sourceMin -= 0;
    sourceMax += 1;
    console.error(
      `Invalid target range: targetMin (${targetMin}) must be less than targetMax (${targetMax})`,
    );
  }

  // 处理特殊情况：源范围为零宽度
  if (Math.abs(sourceMax - sourceMin) < Number.EPSILON) {
    return value <= sourceMin ? targetMin : targetMax;
  }

  // 线性映射公式: y = y1 + (x - x1) * (y2 - y1) / (x2 - x1)
  const mapped =
    targetMin +
    ((value - sourceMin) * (targetMax - targetMin)) / (sourceMax - sourceMin);

  // 可选的范围限制
  if (clamp) {
    return Math.min(targetMax, Math.max(targetMin, mapped));
  }

  return mapped;
}

/**
 * 专为wafer热力图图例设计的映射函数，将值映射到0-100的整数
 */
export function mapToRange(value: number, min: number, max: number): number {
  // 调用通用线性映射函数，保持原有接口兼容性
  const mapped = linearMap(value, min, max, 0, 100, true);
  return Math.round(mapped);
}

function trimExponential(value: string): string {
  const parts = value.split('e');
  const coefficient = parts[0];
  const exponent = parts[1];

  if (!coefficient) {
    return value;
  }

  const trimmedCoefficient = coefficient.includes('.')
    ? coefficient.replace(/\.?0+$/, '')
    : coefficient;

  return exponent === undefined
    ? trimmedCoefficient
    : `${trimmedCoefficient}e${exponent}`;
}

function formatDecimal(value: number, decimals: number): string {
  return new Intl.NumberFormat('en-US', {
    useGrouping: false,
    maximumFractionDigits: decimals,
  }).format(value);
}

function countSignificantDigits(value: string): number {
  return value.replace('-', '').replace('.', '').replace(/^0+/, '').length;
}

/**
 * 数值显示格式化：超长/极小数值自动转科学计数法，普通数值保留有效小数。
 */
export function formatNumber(
  value: null | number | string | undefined,
  options: {
    decimals?: number;
    autoSci?: boolean;
    maxLength?: number;
    sciUpper?: number;
    sciLower?: number;
    minSignificantDigits?: number;
  } = {},
): string {
  if (value === null || value === undefined) return '-';

  const rawValue = typeof value === 'string' ? value.trim() : String(value);
  if (rawValue === '') return '-';

  const {
    decimals = 6,
    autoSci = true,
    maxLength = 10,
    sciUpper = 1e9,
    sciLower = 1e-5,
    minSignificantDigits = 3,
  } = options;

  const num = Number(rawValue);

  if (!Number.isFinite(num)) return rawValue;
  if (num === 0) return '0';

  const absNum = Math.abs(num);

  const scientific = () => {
    return trimExponential(num.toExponential(decimals));
  };

  // 数量级过大或过小，直接使用科学计数法
  if (autoSci && (absNum >= sciUpper || absNum < sciLower)) {
    return scientific();
  }

  // 普通小数格式化
  let normalValue = formatDecimal(num, decimals);

  if (normalValue === '-0') {
    normalValue = '0';
  }

  // 判断普通格式化后是否发生精度损失
  const roundedNum = Number(normalValue);
  const hasRoundingLoss = roundedNum !== num;

  // 对于小数，如果舍入后只剩很少有效数字，则使用科学计数法
  if (
    autoSci &&
    absNum < 1 &&
    hasRoundingLoss &&
    countSignificantDigits(normalValue) < minSignificantDigits
  ) {
    return scientific();
  }

  // 普通显示过长，则使用科学计数法
  const displayLength = normalValue.startsWith('-')
    ? normalValue.length - 1
    : normalValue.length;

  if (autoSci && displayLength > maxLength) {
    return scientific();
  }

  return normalValue;
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