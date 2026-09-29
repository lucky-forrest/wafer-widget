import {
  colorToHex,
  createFunction,
  formatNumber,
  generateDistinctHeatmapIntervalColors,
  generateGradientMap,
  getInterpolatedColor,
  hexToWebGLColor,
  linearMap,
  mapToRange,
} from './tools';
import { cloneDeep, debounce, merge, orderBy } from 'lodash-es';
import ClickSelect from './shape/click-select';
import QuickFind from './shape/quick-find';
import Polygon from './shape/polygon';
import Circle from './shape/circle';
import Rect from './shape/rect';
import Line from './shape/line';
import Grid from './shape/grid';
import Dot from './shape/dot';
import EventBus from './event-bus';
import Big from 'big.js';
import type { DebouncedFunc } from 'lodash-es';
import { waferRenderQueue } from './render-queue';
import {
  createWaferCoordinateCompression,
  mapWaferDieCoordinate,
  mapWaferOverlayCoordinate,
  mapWaferOverlaySpan,
} from './coordinate-compression';
import type { WaferCoordinateCompression } from './coordinate-compression';

type BigNumber = InstanceType<typeof Big>;

const MAX_SAFE_WEBGL_RENDER_SIZE = 4096;
const WEBGL_RENDER_CHUNK_SIZE = 50_000;
const LARGE_DATA_RENDER_THRESHOLD = WEBGL_RENDER_CHUNK_SIZE;
let cachedWebGLRenderSize: null | number = null;

function throwIfRenderAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('晶圆绘制已取消', 'AbortError');
  }
}

function getSafeWebGLRenderSize(): number {
  if (cachedWebGLRenderSize !== null) {
    return cachedWebGLRenderSize;
  }
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl');
  if (!gl) {
    cachedWebGLRenderSize = MAX_SAFE_WEBGL_RENDER_SIZE;
    canvas.remove();
    return cachedWebGLRenderSize;
  }
  const viewportDimensions = gl.getParameter(
    gl.MAX_VIEWPORT_DIMS,
  ) as Int32Array;
  cachedWebGLRenderSize = Math.min(
    MAX_SAFE_WEBGL_RENDER_SIZE,
    Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)),
    Number(viewportDimensions[0]),
    Number(viewportDimensions[1]),
  );
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  canvas.remove();
  return cachedWebGLRenderSize;
}

enum Layer {
  map,
  defect,
}

/**
 * 旋转/镜像方向。
 * 同一方向保留 Notch* 与旧版中文两套键名，取值一致，旧代码可直接迁移。
 */
enum WaferRotate {
  'Notch-X镜像' = 'xMirror',
  'Notch-Y镜像' = 'yMirror',
  'Notch向上' = 'rotate180',
  'Notch向下' = 'rotate0',
  'Notch向右' = 'rotate270',
  'Notch向左' = 'rotate90',
  /* 兼容旧版命名 */
  X镜像 = 'xMirror',
  Y镜像 = 'yMirror',
  '旋转90°' = 'rotate90',
  '旋转180°' = 'rotate180',
  '旋转270°' = 'rotate270',
  重置 = 'rotate0',
}

export interface WaferOptionShowInfo {
  title: string;
  content: string;
}

export interface WaferBackgroundSetting {
  imageUrl: string;
  brightness: number;
  contrast: number;
  saturation: number;
  rotate: number;
}

export type HeatmapLegendIntervalKind = 'above' | 'below' | 'normal';

export interface HeatmapLegendInterval {
  includeMax: boolean;
  includeMin: boolean;
  key: string;
  kind: HeatmapLegendIntervalKind;
  max: number;
  min: number;
}

export type HeatmapLegendMode = 'interval' | 'slider';

export type WaferChartType = 'contourmap' | 'heatmap' | 'wafermap';

export interface WaferMap {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** 水平方向 die 总数（新数据格式） */
  xCount?: number;
  /** 垂直方向 die 总数（新数据格式） */
  yCount?: number;
  /** 兼容旧数据格式：水平方向跨度，内部按 +1 处理为总数 */
  xDieCount?: number;
  yDieCount?: number;
  minValue: number;
  maxValue: number;
  heatmapMinValue?: number;
  heatmapMaxValue?: number;
  heatmapMinColor?: string;
  heatmapMaxColor?: string;
  dataList: Record<string, any>[];
  legendList: Record<string, any>[];
}

export interface WaferParams {
  waferSummary?: Record<string, any>;
  waferMap?: WaferMap;
  defect?: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    xCount?: number;
    yCount?: number;
    minValue?: number;
    maxValue?: number;
    filePath?: string;
    dataList: Record<string, any>[];
    legendList: Record<string, any>[];
  };
  shot?: {
    dataList: Record<string, any>[];
  };
  zone?: {
    dataList: Record<string, any>[];
  };
}

type EventNode = {
  children?: EventNode[];
  config: {
    [key: string]: any;
    actionType: string;
  };
  content?: string;
  id: string;
  title: string;
  type: 'condition' | 'end' | 'fail' | 'normal' | 'start' | 'success';
  debugger?: boolean;
  disabled?: boolean;
  describe?: string;
  [key: string]: any;
};

interface EventType {
  key: string;
  name: string;
  description?: string;
}

interface EventFlowType extends EventType {
  actions: EventNode[];
}

type CustomBtnConfig = Pick<EventFlowType, 'actions' | 'key' | 'name'>;

export interface WaferWidgetOptions {
  backgroundColor: string;
  isShowGrid: boolean;
  /** 是否以背景图片模式渲染（waferscan 图片叠加） */
  isBackgroundImage?: boolean;
  /** 是否绘制晶圆外轮廓圆，缺省时在 waferMap 不可见时绘制（旧版行为） */
  isShowWaferOutline?: boolean;
  /** 轮廓圆半径缩减比例（相对一个 die 宽度） */
  redueOutlineRadius?: number;
  /** 是否将绘制区域裁剪到轮廓圆内 */
  isClipByWaferOutline?: boolean;
  /** waferSummary 中背景图地址字段名 */
  bgUrlField?: string;
  basicConfig: {
    size: string;
    isMeasure: boolean;
    isFullscreen: boolean;
    /** 兼容旧拼写 */
    isReturnDataInatches?: boolean;
    isReturnDataInBatches?: boolean;
    /** 点选结果模式：multiple 叠加 / single 单选 */
    dotSelectionMode?: 'multiple' | 'single';
    /** 数据加载后的默认 Notch 方向 */
    defaultRotate?:
      | 'rotate0'
      | 'rotate180'
      | 'rotate270'
      | 'rotate90'
      | 'xMirror'
      | 'yMirror';
    isRotate: boolean;
    isQuickFind: boolean;
    /** 画布尺寸是否跟随容器（clientWidth） */
    isAdaptiveSize?: boolean;
    /** 稀疏 waferMap 压缩空行列（性能优化） */
    compressEmptyRowsColumns?: boolean;
    /** 图表类型；缺省时由 wmConfig.isHeatmap 推断（旧版行为） */
    chartType?: WaferChartType;
    /** 背景图参数（亮度/饱和度/对比度/旋转） */
    backgroundSetting?: WaferBackgroundSetting;
    wsConfig: {
      visible: boolean;
      position: 'leftBottom' | 'leftTop' | 'rightBottom' | 'rightTop';
      data: WaferOptionShowInfo[];
      wsDataSet?: Record<string, any>;
      wsConfig?: Record<string, any>;
    };
    defectConfig: {
      visible: boolean;
      isSystemColor: boolean;
      position: { x: string; y: string };
      value: string;
      defectDataSet?: Record<string, any>;
      isShowLegend: boolean;
      legendLayout?: 'horizontal' | 'vertical';
      legendDataSet?: Record<string, any>;
      data: WaferOptionShowInfo[];
      isSelection: boolean;
      isQuickFind: boolean;
      legendShape: WaferOptionShowInfo[];
      legendSize: { title: number; content: string }[];
      legendName: string;
      legendValue: string;
      legendColor: string;
      legendStatistic: string;
      transparency: number;
    };
    wmConfig: {
      visible: boolean;
      isSystemColor: boolean;
      /** 旧版热力图开关；chartType 缺省时仍然生效 */
      isHeatmap?: boolean;
      /** die 着色绘制方式：whole 单色 / lbTort、ltTorb 双色对角 */
      drawType?: 'lbTort' | 'ltTorb' | 'whole';
      position: { x: string; y: string };
      value: string;
      /** 数值文本展示字段，缺省用 value */
      label?: string;
      addedValue?: string;
      hightlight: string;
      shadow: string;
      border: string;
      data: WaferOptionShowInfo[];
      wmDataSet?: Record<string, any>;
      isSelection: boolean;
      isRotate: boolean;
      isQuickFind: boolean;
      isShowLegendValue: boolean;
      isShowLegend: boolean;
      legendLayout?: 'horizontal' | 'vertical';
      legendDataSet?: Record<string, any>;
      legendName: string;
      legendValue: string;
      legendColor: string;
      legendStatistic: string;
      transparency: number;
      /** 热力图渐变色板 */
      heatmapColorList?: string[];
      heatmapMinColor?: string;
      heatmapMaxColor?: string;
      /** 热力图图例模式：slider 连续 / interval 离散区间 */
      heatmapLegendMode?: HeatmapLegendMode;
      heatmapLegendIntervalCount?: number;
    };
    /** 等高线图配置 */
    contourMapConfig?: {
      dimension: 'defect' | 'die';
      power: number;
      lines: number;
      size: number;
      gridSize: number;
      valueRange: [number, number];
    };
    shotConfig: {
      visible: boolean;
      color: string;
      position: { x: string; y: string };
      offsetX: string;
      offsetY: string;
    };
  };
  customBtns: CustomBtnConfig[];
}

export type Point = { x: number; y: number };
export type NumberTuple = [number, number];
export type AllShape =
  | Circle
  | ClickSelect
  | Dot
  | Grid
  | Line
  | Polygon
  | QuickFind
  | Rect;
export type HoverParams = {
  x: number;
  y: number;
  dieData?: Record<string, any>;
  defectData?: Record<string, any>;
};

type CellSize = {
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  borderWidth: number;
  borderHeight: number;
};

type WebGLRenderLayer = 'border' | 'glow' | 'mask' | 'rect';

type LocalZoomTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

type LocalZoomRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

enum Shape {
  None,
  Rect,
  Polygon,
  Dot,
  Line,
  Circle,
  Grid,
  ClickSelect,
  QuickFind,
}

// 等高线控制点：存储原始相对坐标(0-1)与当前实际坐标
type ControlPoint = {
  originalX: number;
  originalY: number;
  x: number;
  y: number;
  height: number;
};

type ContourGridPoint = {
  x: number;
  y: number;
  height: number;
  col: number;
  row: number;
};

function createFirstMatchingTitle(
  jsonData: (WaferOptionShowInfo | { title: number; content: string })[],
): (row: Record<string, any>) => null | number | string {
  const preprocessedData = jsonData.map((item) => {
    return {
      title: item.title,
      conditionFn: createFunction<boolean>(item.content, '获取图例颜色'),
    };
  });
  return (row: Record<string, any> = {}) => {
    for (const item of preprocessedData) {
      // 执行缓存的函数
      if (item.conditionFn({ row })) {
        return item.title;
      }
    }
    return null;
  };
}

export default class WaferWidget extends EventBus {
  /** 图层枚举（Layer） */
  static Layer = Layer;
  /** 旋转/镜像方向枚举（WaferRotate） */
  static WaferRotate = WaferRotate;
  /** 标注形状类型枚举（Shape） */
  static Shape = Shape;

  options: WaferWidgetOptions;
  waferData: WaferParams = {};
  /** 只读模式，画布不允许任何交互 */
  lock: boolean = false;
  /** 只读模式，仅支持查看 */
  readonly: boolean = false;
  /** 是否正在绘图 */
  isDrawing: boolean = false;
  /** 最小矩形宽度 */
  MIN_WIDTH = 10;
  /** 最小矩形高度 */
  MIN_HEIGHT = 10;
  /** 最小圆形半径 */
  MIN_RADIUS = 5;
  /** 边线颜色 */
  strokeStyle = '#0f0';
  /** 填充颜色 */
  fillStyle = 'rgba(0, 0, 255, 0.1)';
  /** 边线宽度 */
  lineWidth = 3;
  /** 当前选中的标注边线颜色 */
  activeStrokeStyle = '#f00';
  /** 当前选中的标注填充颜色 */
  activeFillStyle = 'rgba(255, 0, 0, 0.1)';
  /** 控制点边线颜色 */
  ctrlStrokeStyle = '#000';
  /** 控制点填充颜色 */
  ctrlFillStyle = '#fff';
  /** 控制点半径 */
  ctrlRadius = 3;
  /** 是否隐藏标签 */
  hideLabel = false;
  /** 标签背景填充颜色 */
  labelFillStyle = '#fff';
  /** 标签字体 */
  labelFont = '10px sans-serif';
  /** 标签文字颜色 */
  textFillStyle = '#000';
  /** 标签字符最大长度，超出使用省略号 */
  labelMaxLen = 10;
  /** 画布宽度 */
  WIDTH = 0;
  /** 画布高度 */
  HEIGHT = 0;

  canvas: HTMLCanvasElement | undefined;

  ctx: CanvasRenderingContext2D | null | undefined;
  /** 所有标注数据 */
  dataset: AllShape[] = [];

  offScreen: HTMLCanvasElement | undefined;
  offscreenCtx: CanvasRenderingContext2D | null | undefined;

  // Wafer相关配置
  waferCanvas: HTMLCanvasElement | undefined;
  waferCtx: CanvasRenderingContext2D | null | undefined;

  // 放大镜相关配置
  magnifierCanvas: HTMLCanvasElement | undefined;
  magnifierCtx: CanvasRenderingContext2D | null | undefined;

  // 默认展示放大镜
  isMagnifierVisible: boolean = true;
  // 放大镜位置，默认跟随鼠标
  magnifierPosition: 'auto' | NumberTuple = 'auto';

  /** 局部放大工具状态 */
  private localZoomTransform: LocalZoomTransform = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
  private localZoomMode = false;
  private localZoomStart: null | Point = null;
  private localZoomCurrent: null | Point = null;
  private clickSelectStart: null | Point = null;
  private clickSelectCurrent: null | Point = null;
  private clickSelectDragging = false;

  /** 记录锚点距离 */
  remember: NumberTuple[] = [];
  /** 记录鼠标位置 */
  mouse: Point = { x: 0, y: 0 };
  /** 记录背景图鼠标位移 */
  rememberOrigin: number[] = [0, 0];
  /** 0 不创建，1 矩形，2 多边形，3 点，4 折线，5 圆，6 网格 */
  createType: Shape = Shape.None;
  /** 控制点索引 */
  ctrlIndex = -1;
  /** 背景图片 */
  image: HTMLImageElement = new Image();

  /** 背景图片参数 */
  private backgroundParams: {
    brightness: number;
    saturation: number;
    contrast: number;
    rotate: number;
    imageUrl: string;
    currentImageUrl: string;
  } = {
    brightness: 100,
    saturation: 100,
    contrast: 100,
    rotate: 0,
    imageUrl: '',
    currentImageUrl: '',
  };

  /** 缓存的背景图片 */
  private cachedBackgroundImage: HTMLImageElement | null = null;

  /** 图片原始宽度 */
  IMAGE_ORIGIN_HEIGHT = 0;
  /** 图片原始高度 */
  IMAGE_ORIGIN_WIDTH = 0;
  /** 图片缩放宽度 */
  IMAGE_WIDTH = 0;
  /** 图片缩放高度 */
  IMAGE_HEIGHT = 0;
  //  wafer图偏移信息
  origin: Point = { x: 0, y: 0 };
  /** 缩放步长 */
  private scaleStep = 0;
  /** 滚动缩放 */
  scrollZoom = true;

  private timer: any = null;
  private updateResolve: (() => void) | null = null;
  /** 最小touch双击时间 */
  dblTouch = 300;
  /** 记录touch双击开始时间 */
  dblTouchStore = 0;
  /** 这个选项可以帮助浏览器进行内部优化 */
  alpha = true;
  /** 专注模式 */
  focusMode = false;
  /** 触控缩放时记录上一次两点距离 */
  scaleTouchStore = 0;
  /** 当前是否为双指触控 */
  isTouch2 = false;
  isMobile = navigator.userAgent.includes('Mobile');
  /** 向上展示label */
  labelUp = false;
  private isCtrlKey = false;
  /** 自定义ctrl快捷键 KeyboardEvent.code */
  ctrlCode = 'ControlLeft';
  /** 网格右键菜单 */
  gridMenuEnable = true;
  /** 网格选中背景填充颜色 */
  gridSelectedFillStyle = 'rgba(255, 255, 0, 0.6)';

  // 水平方向最多die的数量
  xCount = 30;
  // 垂直方向最多die数量
  yCount = 30;

  private gridItemWidth = 0;
  private gridItemHeight = 0;
  private radius = 0;
  private centerPoint: Point = { x: 0, y: 0 };
  // 重新绘制wafer图（缩放后高清重绘；上下文复用后单次重绘开销低，防抖可更短以保证跟手性）
  private debounceRedrawWafer: DebouncedFunc<() => void> = debounce(
    () => this.drawWafer(undefined, false),
    400,
  );
  private drawTask: null | Promise<void> = null;
  private drawRequested = false;
  private drawInitLoadRequested = false;
  private resizeRequested = false;
  private pendingCanvasSize?: number;
  private destroyed = false;
  private renderingPaused = false;
  private exportDepth = 0;
  private renderVersion = 0;
  private drawError: unknown;
  private updateTask: null | Promise<void> = null;
  private viewUpdatePending = false;
  private pendingViewImage?: CanvasImageSource | null;
  private drawController: AbortController | null = null;
  // 记录当前热力图筛选的数值区间
  private mapHeatmapValue: [number, number] = [0, Number.MAX_SAFE_INTEGER];
  // 当前热力图颜色重新分配所使用的数值域，不写回绑定数据
  private heatmapColorRange: [number, number] = [0, 100];
  private hasHeatmapRangeOverride = false;
  private heatmapIntervalSelection: HeatmapLegendInterval[] = [];
  private mapLegendValues: (number | string)[] = [];
  private defectLegendValues: (number | string)[] = [];
  get selectedDefectLegendValues() {
    return this.defectLegendValues;
  }
  // die及defect图例颜色映射对象
  private dieLegendMap = new Map();
  private defectLegendMap = new Map();
  // wafer 边界信息（旋转/压缩换算的原始基准）
  private waferBoundary: null | Omit<WaferMap, 'dataList' | 'legendList'> =
    null;
  private compressEmptyRowsColumns = false;
  private coordinateCompression: null | WaferCoordinateCompression = null;
  private diePositionReader?: {
    x: string;
    y: string;
    compression: null | WaferCoordinateCompression;
    read: (point: Record<string, any>) => null | Point;
  };
  private currentRotate: WaferRotate = WaferRotate['Notch向下'];
  private quickFindPoint: null | Point = null;

  // 默认颜色值
  private readonly DEFAULT_MIN_COLOR = '#000000';
  private readonly DEFAULT_MAX_COLOR = '#000000';

  // WebGL相关常量
  private readonly RECT_VERTICES = 6; // 每个矩形6个顶点(2个三角形)
  private readonly BORDER_VERTICES = 24; // 每个边框24个顶点
  private readonly GLOW_VERTICES = 24; // 每个发光边框24个顶点

  private controlPoints: ControlPoint[] = [];
  private contourGridPoints: ContourGridPoint[] = [];
  /** 等高线高度场是否需要重算（控制点集 / 配置变化时置脏；缩放与重绘只重排坐标） */
  private contourFieldDirty = true;
  /** 控制点空间分桶，K 近邻 IDW 加速用；cellSize 随画布尺寸在重建时确定 */
  private contourBuckets: {
    cellWidth: number;
    cellHeight: number;
    cols: number;
    rows: number;
    buckets: ControlPoint[][];
  } | null = null;

  // 等高线图默认参数
  private CONTOUR_DIMENSION = 'die'; // 等高线维度
  private CONTOUR_POWER = 2; // 反距离加权幂指数
  private CONTOUR_LINES = 8; // 等高线数量
  private CONTOUR_GRID_SIZE = 90; // 等高线网点密度
  private CONTOUR_POINT_SIZE = 5; // 控制点显示大小
  private CONTORU_MIN_HEIGHT = 0; // 最小高度值
  private CONTORU_MAX_HEIGHT = 100; // 最大高度值

  private vsSource = `
                attribute vec2 aPosition;
                attribute vec4 aColor;
                varying vec4 vColor;
                void main() {
                    gl_Position = vec4(aPosition, 0.0, 1.0);
                    vColor = aColor;
                }
            `;

  private fsSource = `
                precision highp float;
                varying vec4 vColor;
                void main() {
                    gl_FragColor = vColor;
                }
            `;

  /** WebGL 上下文/着色器复用缓存：免去每次重绘的上下文创建与编译开销，空闲后自动释放 */
  private webglCanvasCache: HTMLCanvasElement | null = null;
  private webglCtxCache: WebGLRenderingContext | null = null;
  private webglProgramCache: WebGLProgram | null = null;
  private webglReleaseTimer: any = null;
  private static readonly WEBGL_IDLE_RELEASE_MS = 30_000;

  /** 悬停命中索引（die/defect 按 "x_y" 键建 Map，替代每次鼠标移动的线性扫描） */
  private dataVersion = 0;
  private hoverIndexVersion = -1;
  private dieIndex: Map<string, Record<string, any>> | null = null;
  private defectIndex: Map<string, Record<string, any>> | null = null;

  /** 热力图颜色 memo：同一次绘制内相同原始值不重复构造 Big 与查表 */
  private heatmapColorMemo: Map<
    string,
    { color: number[]; enum: number | undefined }
  > | null = null;

  /** defect 符号精灵缓存：fillText → drawImage */
  private defectSpriteCache = new Map<string, HTMLCanvasElement>();

  /** 画布 CSS 宽 / 逻辑宽比例（initSetting 时更新，避免滚轮缩放每 tick 强制布局） */
  private canvasCssScale = 1;

  /** 坐标压缩表脏标记：数据 / 字段 / 开关变化时重建，重绘不再重复排序 */
  private coordinateCompressionDirty = true;

  /**
   * @param el Valid CSS selector string, or DOM
   * @param options 组件配置
   */
  constructor(el: HTMLCanvasElement | string, options: WaferWidgetOptions) {
    super();
    this.options = options;
    this.compressEmptyRowsColumns = Boolean(
      this.options.basicConfig.compressEmptyRowsColumns,
    );
    this.handleLoad = this.handleLoad.bind(this);
    this.handleContextmenu = this.handleContextmenu.bind(this);
    this.handleMousewheel = this.handleMousewheel.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleDblclick = this.handleDblclick.bind(this);
    this.handleKeyup = this.handleKeyup.bind(this);
    this.handleKeydown = this.handleKeydown.bind(this);
    const container = typeof el === 'string' ? document.querySelector(el) : el;
    if (container instanceof HTMLCanvasElement) {
      this.canvas = container;
      this.initSetting();
      this.initEvents();
      this.drawWafer(true);
    } else {
      console.warn('HTMLCanvasElement is required!');
    }
  }

  /* ---------- 旧版属性名兼容 ---------- */

  /** @deprecated 请使用 remember */
  get remmber(): NumberTuple[] {
    return this.remember;
  }
  set remmber(value: NumberTuple[]) {
    this.remember = value;
  }
  /** @deprecated 请使用 rememberOrigin */
  get remmberOrigin(): number[] {
    return this.rememberOrigin;
  }
  set remmberOrigin(value: number[]) {
    this.rememberOrigin = value;
  }
  /** @deprecated 请使用 offscreenCtx */
  get offScreenCtx() {
    return this.offscreenCtx;
  }
  /** @deprecated 请使用 xCount */
  get xDieCount() {
    return this.xCount;
  }
  set xDieCount(value: number) {
    this.xCount = value;
  }
  /** @deprecated 请使用 yCount */
  get yDieCount() {
    return this.yCount;
  }
  set yDieCount(value: number) {
    this.yCount = value;
  }

  /* ---------- 等高线图坐标换算 ---------- */

  /**
   * 将相对坐标(0-1)转换为当前画布的实际坐标
   */
  private relativeToActual(relativeX: number, relativeY: number): Point {
    const { width, height } = this.getCurrentCanvasSize();
    return {
      x: relativeX * width,
      y: relativeY * height,
    };
  }

  /**
   * 将实际坐标转换为相对坐标(0-1)
   */
  private actualToRelative(actualX: number, actualY: number): Point {
    const { width, height } = this.getCurrentCanvasSize();
    return {
      x: width > 0 ? actualX / width : 0,
      y: height > 0 ? actualY / height : 0,
    };
  }

  /**
   * 更新控制点的实际坐标（根据当前画布尺寸）
   */
  private updateControlPointsActualCoords() {
    for (const point of this.controlPoints) {
      const actual = this.relativeToActual(point.originalX, point.originalY);
      point.x = actual.x;
      point.y = actual.y;
    }
  }

  /**
   * 获取当前画布尺寸
   */
  private getCurrentCanvasSize(): { width: number; height: number } {
    return {
      width: this.waferCanvas?.width || this.IMAGE_WIDTH || 1024,
      height: this.waferCanvas?.height || this.IMAGE_HEIGHT || 1024,
    };
  }

  //  wafer组件基础配置信息
  get basicConfig() {
    return this.options.basicConfig;
  }

  /** 热力图模式：chartType 优先，缺省时兼容旧版 wmConfig.isHeatmap */
  get isHeatmapChart() {
    const { chartType, wmConfig } = this.basicConfig;
    return chartType === 'heatmap' || wmConfig.isHeatmap === true;
  }

  /* ---------- 坐标压缩（稀疏 waferMap 性能优化） ---------- */

  private canCompressEmptyRowsColumns() {
    const { chartType, wmConfig } = this.basicConfig;
    const supportedChart =
      chartType === undefined || ['heatmap', 'wafermap'].includes(chartType);
    return (
      this.compressEmptyRowsColumns &&
      !this.options.isBackgroundImage &&
      supportedChart &&
      wmConfig.visible &&
      Boolean(this.waferData.waferMap?.dataList?.length) &&
      Boolean(wmConfig.position.x && wmConfig.position.y)
    );
  }

  /** 数据 / 坐标字段 / 压缩开关变化时调用：坐标压缩表与悬停索引随之重建 */
  private markCoordinateCompressionDirty() {
    this.coordinateCompressionDirty = true;
    this.dataVersion++;
  }

  private rebuildCoordinateCompression() {
    // 压缩表只依赖 dataList 与坐标字段，脏标记避免每次重绘重复 Set+sort
    if (!this.coordinateCompressionDirty) return;
    this.coordinateCompressionDirty = false;
    if (!this.canCompressEmptyRowsColumns()) {
      this.coordinateCompression = null;
      return;
    }
    const { x, y } = this.basicConfig.wmConfig.position;
    const compression = createWaferCoordinateCompression(
      this.waferData.waferMap?.dataList || [],
      x,
      y,
    );
    this.coordinateCompression =
      compression.x.coordinates.length > 0 &&
      compression.y.coordinates.length > 0
        ? compression
        : null;
  }

  getDieDisplayPosition(point: Record<string, any>): null | Point {
    return this.createDiePositionReader()(point);
  }

  /** 热循环固定字段名与压缩映射，避免每个点重复读取配置。 */
  private createDiePositionReader(): (
    point: Record<string, any>,
  ) => null | Point {
    const { x, y } = this.basicConfig.wmConfig.position;
    const cached = this.diePositionReader;
    if (
      cached &&
      cached.x === x &&
      cached.y === y &&
      cached.compression === this.coordinateCompression
    )
      return cached.read;
    const xKey = `_o_${x}`;
    const yKey = `_o_${y}`;
    const compression = this.coordinateCompression;
    const read = (point: Record<string, any>): null | Point => {
      const sourceX = Number(point[xKey]);
      const sourceY = Number(point[yKey]);
      if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) return null;
      if (!compression) return { x: sourceX, y: sourceY };
      const displayX = mapWaferDieCoordinate(sourceX, compression.x);
      const displayY = mapWaferDieCoordinate(sourceY, compression.y);
      return displayX === null || displayY === null
        ? null
        : { x: displayX, y: displayY };
    };
    this.diePositionReader = { x, y, compression, read };
    return read;
  }

  getDefectDisplayPosition(point: Record<string, any>): null | Point {
    const { x, y } = this.basicConfig.defectConfig.position;
    const sourceX = Number(point[`_o_${x}`]);
    const sourceY = Number(point[`_o_${y}`]);
    if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) {
      return null;
    }
    if (!this.coordinateCompression) {
      return { x: sourceX, y: sourceY };
    }
    const displayX = mapWaferOverlayCoordinate(
      sourceX,
      this.coordinateCompression.x,
    );
    const displayY = mapWaferOverlayCoordinate(
      sourceY,
      this.coordinateCompression.y,
    );
    return displayX === null || displayY === null
      ? null
      : { x: displayX, y: displayY };
  }

  setCompressEmptyRowsColumns(enabled: boolean) {
    this.compressEmptyRowsColumns = enabled;
    this.markCoordinateCompressionDirty();
    this.rebuildCoordinateCompression();
    this.drawWafer();
  }

  private rotateShotRect(x: number, y: number, width: number, height: number) {
    const boundary = this.waferBoundary || this.waferData.waferMap;
    const xCount = boundary?.xCount || this.xCount;
    const yCount = boundary?.yCount || this.yCount;
    switch (this.currentRotate) {
      case WaferRotate.Notch向上: {
        return {
          x: xCount - x - width,
          y: yCount - y - height,
          width,
          height,
        };
      }
      case WaferRotate.Notch向右: {
        return { x: y, y: xCount - x - width, width: height, height: width };
      }
      case WaferRotate.Notch向左: {
        return { x: yCount - y - height, y: x, width: height, height: width };
      }
      case WaferRotate['Notch-X镜像']: {
        return { x, y: yCount - y - height, width, height };
      }
      case WaferRotate['Notch-Y镜像']: {
        return { x: xCount - x - width, y, width, height };
      }
      default: {
        return { x, y, width, height };
      }
    }
  }
  // 网格元素的宽
  setGridItemWidth() {
    this.gridItemWidth =
      this.IMAGE_WIDTH > 0
        ? this.IMAGE_WIDTH / this.xCount
        : this.WIDTH / this.xCount;
  }
  // 网格元素高
  setGridItemHeight() {
    this.gridItemHeight =
      this.IMAGE_HEIGHT > 0
        ? this.IMAGE_HEIGHT / this.yCount
        : this.HEIGHT / this.yCount;
  }
  // 获取晶圆图中心点
  setCenterPoint() {
    this.centerPoint = {
      x: this.IMAGE_WIDTH > 0 ? this.IMAGE_WIDTH / 2 : this.WIDTH / 2,
      y: this.IMAGE_HEIGHT > 0 ? this.IMAGE_HEIGHT / 2 : this.HEIGHT / 2,
    };
  }
  //  晶圆图的半径
  setRadius() {
    this.radius = Math.abs(
      this.IMAGE_WIDTH > 0 ? this.IMAGE_WIDTH / 2 : this.WIDTH / 2,
    );
  }
  /** 当前选中的标注 */
  get activeShape() {
    return this.dataset.find((x) => x.active) || ({} as any);
  }
  /** 当前缩放比例 */
  get scale() {
    if (this.IMAGE_ORIGIN_WIDTH && this.IMAGE_WIDTH) {
      return this.IMAGE_WIDTH / this.IMAGE_ORIGIN_WIDTH;
    }
    return 1;
  }
  /** 图片最小边尺寸 */
  get imageMin() {
    return Math.min(this.IMAGE_WIDTH, this.IMAGE_HEIGHT);
  }
  /** 图片原始最大边尺寸 */
  get imageOriginMax() {
    return Math.max(this.IMAGE_ORIGIN_WIDTH, this.IMAGE_ORIGIN_HEIGHT);
  }
  /** 创建放大镜容器 */
  private createMagnifierCanvas() {
    if (this.isMagnifierVisible) {
      this.magnifierCanvas =
        this.magnifierCanvas || document.createElement('canvas');
      this.magnifierCtx =
        this.magnifierCanvas &&
        (this.magnifierCanvas.getContext('2d', {
          willReadFrequently: true,
        }) as CanvasRenderingContext2D);
      this.magnifierCanvas.style.position = 'fixed';
      this.magnifierCanvas.style.pointerEvents = 'none';
      this.magnifierCanvas.style.zIndex = '1000';
      this.magnifierCanvas.style.border = '1px solid black';
      this.magnifierCanvas.style.borderRadius = '50%';
      this.magnifierCanvas.style.width = '100px';
      this.magnifierCanvas.style.height = '100px';
      document.body.append(this.magnifierCanvas);
    }
  }
  /** 创建放大镜 */
  private createMagnifier(x: number, y: number) {
    if (this.magnifierCanvas) {
      this.updateMagnifier(x, y);
    } else {
      this.createMagnifierCanvas();
    }
  }
  /** 更新放大镜 */
  private updateMagnifier(x: number, y: number) {
    if (this.canvas && this.magnifierCanvas && this.magnifierCtx) {
      const magnifierSize = 100;
      const dpr = window.devicePixelRatio || 1;
      this.magnifierCanvas.width = magnifierSize;
      this.magnifierCanvas.height = magnifierSize;
      this.magnifierCtx.clearRect(0, 0, magnifierSize, magnifierSize);

      // 放大镜位置
      if (this.magnifierPosition && this.magnifierPosition.length === 2) {
        const [mx, my] = this.magnifierPosition;
        this.magnifierCanvas.style.left = `${mx}px`;
        this.magnifierCanvas.style.top = `${my}px`;
      } else {
        this.magnifierCanvas.style.left = `${x + 10}px`;
        this.magnifierCanvas.style.top = `${y + 10}px`;
      }

      const originImageData = this.getImageDataFromCanvas(this.canvas, [
        x * dpr - magnifierSize / 2,
        y * dpr - magnifierSize / 2,
        magnifierSize,
        magnifierSize,
      ]);
      // 新的像素信息对象
      const areaImageData = this.magnifierCanvas
        .getContext('2d', { willReadFrequently: true })
        ?.createImageData(
          this.magnifierCanvas.width,
          this.magnifierCanvas.height,
        );

      if (areaImageData && originImageData) {
        let count = 0;
        for (let j = 0; j < magnifierSize; j += 1) {
          for (let i = 0; i < magnifierSize; i += 1) {
            for (let k = j; k < j + 1; k++) {
              for (let m = i; m < i + 1; m++) {
                const index = (k * magnifierSize + m) * 4;
                // @ts-ignore
                areaImageData.data[index] = originImageData.data[count];
                // @ts-ignore
                areaImageData.data[index + 1] = originImageData.data[count + 1];
                // @ts-ignore
                areaImageData.data[index + 2] = originImageData.data[count + 2];
                // @ts-ignore
                areaImageData.data[index + 3] = originImageData.data[count + 3];
              }
            }
            count += 4;
          }
        }
        this.magnifierCanvas
          .getContext('2d', { willReadFrequently: true })
          ?.putImageData(areaImageData, 0, 0);

        this.magnifierCtx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        this.magnifierCtx.lineWidth = 2;
        this.magnifierCtx.strokeRect(0, 0, magnifierSize, magnifierSize);
      }
    }
  }
  /** 销毁放大镜 */
  private destroyMagnifier() {
    if (this.magnifierCanvas) {
      this.magnifierCanvas.remove();
      this.magnifierCanvas = undefined;
      this.magnifierCtx = undefined;
    }
  }

  /* ---------- 局部放大工具 ---------- */

  private clampCanvasPoint(point: Point): Point {
    return {
      x: Math.min(this.WIDTH, Math.max(0, point.x)),
      y: Math.min(this.HEIGHT, Math.max(0, point.y)),
    };
  }

  private screenToCanvasPoint(point: Point): Point {
    const { scale, offsetX, offsetY } = this.localZoomTransform;
    return {
      x: (point.x - offsetX) / scale,
      y: (point.y - offsetY) / scale,
    };
  }

  private canvasToScreenPoint(point: Point): Point {
    const { scale, offsetX, offsetY } = this.localZoomTransform;
    return {
      x: point.x * scale + offsetX,
      y: point.y * scale + offsetY,
    };
  }

  private getClickSelectRect(): LocalZoomRect | null {
    if (!this.clickSelectStart || !this.clickSelectCurrent) return null;
    const start = this.canvasToScreenPoint(this.clickSelectStart);
    const current = this.canvasToScreenPoint(this.clickSelectCurrent);
    return {
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y),
    };
  }

  private getLocalZoomRect(): LocalZoomRect | null {
    if (!this.localZoomStart || !this.localZoomCurrent) return null;
    const x = Math.min(this.localZoomStart.x, this.localZoomCurrent.x);
    const y = Math.min(this.localZoomStart.y, this.localZoomCurrent.y);
    return {
      x,
      y,
      width: Math.abs(this.localZoomCurrent.x - this.localZoomStart.x),
      height: Math.abs(this.localZoomCurrent.y - this.localZoomStart.y),
    };
  }

  private drawLocalZoomSelection() {
    const rect = this.getLocalZoomRect();
    if (!rect || !this.ctx) return;
    this.ctx.save();
    this.ctx.strokeStyle = '#409eff';
    this.ctx.fillStyle = 'rgba(64, 158, 255, 0.12)';
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([6, 4]);
    this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    this.ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    this.ctx.restore();
  }

  private drawClickSelectSelection() {
    const rect = this.getClickSelectRect();
    if (!rect || !this.clickSelectDragging || !this.ctx) return;
    this.ctx.save();
    this.ctx.strokeStyle = '#409eff';
    this.ctx.fillStyle = 'rgba(64, 158, 255, 0.12)';
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([4, 3]);
    this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    this.ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    this.ctx.restore();
  }

  private applyLocalZoom(rect: LocalZoomRect) {
    if (
      rect.width < 4 ||
      rect.height < 4 ||
      this.WIDTH <= 0 ||
      this.HEIGHT <= 0
    ) {
      return false;
    }
    const current = this.localZoomTransform;
    const viewScale = Math.min(
      this.WIDTH / rect.width,
      this.HEIGHT / rect.height,
    );

    // 将局部放大转换为高分辨率源图重绘，避免把已经栅格化的 waferCanvas
    // 继续拉伸导致模糊。WebGL/Canvas 的源图尺寸仍受设备安全上限限制。
    const requestedScale = this.scale * current.scale * viewScale;
    const maxSourceSize = getSafeWebGLRenderSize();
    const maxScale =
      Math.min(this.IMAGE_ORIGIN_WIDTH, this.IMAGE_ORIGIN_HEIGHT) > 0
        ? maxSourceSize /
          Math.max(this.IMAGE_ORIGIN_WIDTH, this.IMAGE_ORIGIN_HEIGHT)
        : requestedScale;
    const renderScale = Math.min(requestedScale, maxScale);
    if (!Number.isFinite(renderScale) || renderScale <= 0) {
      return false;
    }

    const rectCenter = {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
    const sourceCenter = this.screenToCanvasPoint(rectCenter);
    const currentImageScale = this.scale;
    const sourceLogicalCenter = {
      x: (sourceCenter.x - this.origin.x) / currentImageScale,
      y: (sourceCenter.y - this.origin.y) / currentImageScale,
    };
    this.IMAGE_WIDTH = Math.max(
      1,
      Math.round(this.IMAGE_ORIGIN_WIDTH * renderScale),
    );
    this.IMAGE_HEIGHT = Math.max(
      1,
      Math.round(this.IMAGE_ORIGIN_HEIGHT * renderScale),
    );
    this.origin = {
      x: this.WIDTH / 2 - sourceLogicalCenter.x * renderScale,
      y: this.HEIGHT / 2 - sourceLogicalCenter.y * renderScale,
    };
    this.localZoomTransform = { scale: 1, offsetX: 0, offsetY: 0 };
    this.calcCenterPointAndDieSize();
    this.drawWafer();
    return true;
  }

  /** 开启/关闭一次性局部放大框选 */
  setLocalZoomMode(enabled: boolean) {
    this.localZoomMode = enabled;
    if (this.canvas) {
      this.canvas.style.cursor = enabled ? 'crosshair' : '';
    }
    this.localZoomStart = null;
    this.localZoomCurrent = null;
    this.clickSelectStart = null;
    this.clickSelectCurrent = null;
    this.clickSelectDragging = false;
    if (enabled) {
      this.createType = Shape.None;
      this.dataset.forEach((shape) => {
        shape.active = false;
      });
    }
    this.update();
  }

  /** 清除局部放大并恢复完整视图 */
  clearLocalZoom() {
    this.localZoomMode = false;
    if (this.canvas) {
      this.canvas.style.cursor = '';
    }
    this.localZoomStart = null;
    this.localZoomCurrent = null;
    this.clickSelectStart = null;
    this.clickSelectCurrent = null;
    this.clickSelectDragging = false;
    this.localZoomTransform = { scale: 1, offsetX: 0, offsetY: 0 };
    if (this.IMAGE_WIDTH > 0 && this.IMAGE_HEIGHT > 0) {
      this.fitZoom();
    } else {
      this.update();
    }
  }

  private handleLocalZoomMouseDown(e: MouseEvent | TouchEvent) {
    const { mouseX, mouseY } = this.mergeEvent(e);
    if (
      (!this.isMobile && (e as MouseEvent).buttons === 1) ||
      (this.isMobile && (e as TouchEvent).touches?.length === 1)
    ) {
      const point = this.clampCanvasPoint({ x: mouseX, y: mouseY });
      this.localZoomStart = point;
      this.localZoomCurrent = point;
      this.update();
    }
  }

  private handleLocalZoomMouseMove(e: MouseEvent | TouchEvent) {
    if (!this.localZoomStart) return;
    const { mouseX, mouseY } = this.mergeEvent(e);
    if (
      (!this.isMobile && (e as MouseEvent).buttons === 1) ||
      (this.isMobile && (e as TouchEvent).touches?.length === 1)
    ) {
      this.localZoomCurrent = this.clampCanvasPoint({ x: mouseX, y: mouseY });
      this.update();
    }
  }

  private handleLocalZoomMouseUp() {
    const rect = this.getLocalZoomRect();
    this.localZoomStart = null;
    this.localZoomCurrent = null;
    if (rect && this.applyLocalZoom(rect)) {
      this.localZoomMode = false;
      if (this.canvas) {
        this.canvas.style.cursor = '';
      }
      this.emit('localZoomComplete');
    }
    this.update();
  }

  /* ---------- 点选（单击 / 拖框） ---------- */

  private beginClickSelect(point: Point) {
    this.clickSelectStart = point;
    this.clickSelectCurrent = point;
    this.clickSelectDragging = false;
    this.dataset.forEach((shape) => {
      shape.active = false;
    });
    this.update();
  }

  private updateClickSelect(point: Point) {
    if (!this.clickSelectStart) return;
    this.clickSelectCurrent = point;
    const rect = this.getClickSelectRect();
    if (rect && (rect.width >= 4 || rect.height >= 4)) {
      this.clickSelectDragging = true;
    }
    this.update();
  }

  private addClickSelectPoint(point: NumberTuple) {
    if (this.getClickSelectShapeIndex({ x: point[0], y: point[1] }) > -1) {
      return;
    }
    this.dataset.push(new ClickSelect({ coor: point }, this.dataset.length));
  }

  private finishClickSelect() {
    if (!this.clickSelectStart || !this.clickSelectCurrent) return;
    const start = this.getPoint(this.clickSelectStart);
    const end = this.getPoint(this.clickSelectCurrent);
    const wasDragging = this.clickSelectDragging;
    let selectedShape: ClickSelect | null = null;

    this.clickSelectStart = null;
    this.clickSelectCurrent = null;
    this.clickSelectDragging = false;

    if (wasDragging) {
      if (this.isSingleClickSelection()) {
        this.clearClickSelectMarks();
      }
      const minX = Math.max(0, Math.min(start.x, end.x));
      const maxX = Math.min(this.xCount - 1, Math.max(start.x, end.x));
      const minY = Math.max(0, Math.min(start.y, end.y));
      const maxY = Math.min(this.yCount - 1, Math.max(start.y, end.y));
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          this.addClickSelectPoint([x, y]);
        }
      }
      selectedShape =
        (this.dataset[this.dataset.length - 1] as ClickSelect) || null;
    } else {
      const point: NumberTuple = [start.x, start.y];
      const clickShapeIndex = this.getClickSelectShapeIndex({
        x: point[0],
        y: point[1],
      });
      if (clickShapeIndex > -1) {
        this.dataset.splice(clickShapeIndex, 1);
      } else {
        if (this.isSingleClickSelection()) {
          this.clearClickSelectMarks();
        }
        this.addClickSelectPoint(point);
        selectedShape =
          (this.dataset[this.dataset.length - 1] as ClickSelect) || null;
      }
    }

    this.dataset.forEach((shape) => {
      shape.active = false;
    });
    this.dataset.forEach((shape, index) => {
      shape.index = index;
    });
    this.emit('select', selectedShape);
    this.emit('add', this.dataset[this.dataset.length - 1]);
    this.update();
  }

  /* 提取像素信息 */
  private getImageDataFromCanvas(
    canvas: HTMLCanvasElement,
    [x, y, width, height]: [number, number, number, number],
  ) {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    return context?.getImageData(x, y, width, height);
  }
  /** 合成事件 */
  private mergeEvent(e: MouseEvent | TouchEvent) {
    let mouseX = 0;
    let mouseY = 0;
    let mouseCX = 0;
    let mouseCY = 0;
    if (this.isMobile && (e as TouchEvent).touches) {
      // @ts-ignore
      const { clientX, clientY } = (e as TouchEvent).touches[0];
      const target = e.target as HTMLCanvasElement;
      const { left, top } = target.getBoundingClientRect();
      mouseX = Math.round(clientX - left);
      mouseY = Math.round(clientY - top);
      if ((e as TouchEvent).touches?.length === 2) {
        const { clientX: clientX1 = 0, clientY: clientY1 = 0 } =
          (e as TouchEvent).touches[1] || {};
        mouseCX = Math.round(
          Math.abs((clientX1 - clientX) / 2 + clientX) - left,
        );
        mouseCY = Math.round(
          Math.abs((clientY1 - clientY) / 2 + clientY) - top,
        );
      } else if ((e as TouchEvent).touches?.length === 1) {
        mouseCX = Math.round(clientX - left);
        mouseCY = Math.round(clientY - top);
      }
    } else {
      mouseX = (e as MouseEvent).offsetX;
      mouseY = (e as MouseEvent).offsetY;
    }
    return { ...e, mouseX, mouseY, mouseCX, mouseCY };
  }
  private handleLoad() {
    this.emit('load', this.image.src);
    this.IMAGE_ORIGIN_WIDTH = this.IMAGE_WIDTH = this.image.width;
    this.IMAGE_ORIGIN_HEIGHT = this.IMAGE_HEIGHT = this.image.height;
    this.fitZoom();
  }
  private handleContextmenu(e: MouseEvent) {
    e.preventDefault();
  }
  private handleMousewheel(e: WheelEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (this.localZoomMode) return;
    if (!this.isDrawing) {
      if (this.lock || !this.scrollZoom) return;
      const { mouseX, mouseY } = this.mergeEvent(e);
      this.mouse = this.screenToCanvasPoint({ x: mouseX, y: mouseY });
      this.setScale(e.deltaY < 0, true);
    }
  }
  /**
   * 根据point获取ClickSelect对应的shape索引信息
   */
  private getClickSelectShapeIndex(point: Point): number {
    return this.dataset.findIndex(
      (shape) =>
        shape.type === Shape.ClickSelect &&
        shape.coor.join(',') === `${point.x},${point.y}`,
    );
  }

  /** 点选模式未配置时兼容旧版，默认允许多个点选结果叠加。 */
  private isSingleClickSelection() {
    return this.basicConfig.dotSelectionMode === 'single';
  }

  private clearClickSelectMarks() {
    this.dataset = this.dataset.filter(
      (shape) => shape.type !== Shape.ClickSelect,
    );
  }

  /** 更新点选模式；切换为单选时立即保留最新语义，清理已有叠加点。 */
  setDotSelectionMode(mode: 'multiple' | 'single' = 'multiple') {
    if (mode === 'single') {
      this.clearClickSelectMarks();
      this.dataset.forEach((shape, index) => {
        shape.index = index;
      });
    }
    this.drawWafer();
  }

  private handleMouseDown(e: MouseEvent | TouchEvent) {
    e.stopPropagation();
    if (this.lock) return;
    if (this.localZoomMode) {
      this.handleLocalZoomMouseDown(e);
      return;
    }
    const { mouseX, mouseY, mouseCX, mouseCY } = this.mergeEvent(e);
    const canvasPoint = this.screenToCanvasPoint({ x: mouseX, y: mouseY });
    const canvasCenterPoint = this.screenToCanvasPoint({
      x: mouseCX,
      y: mouseCY,
    });
    const normalizedMouseX = canvasPoint.x;
    const normalizedMouseY = canvasPoint.y;
    const normalizedMouseCX = canvasCenterPoint.x;
    const normalizedMouseCY = canvasCenterPoint.y;
    const offsetX = Math.round(normalizedMouseX / this.scale);
    const offsetY = Math.round(normalizedMouseY / this.scale);
    this.mouse =
      this.isMobile && (e as TouchEvent).touches?.length === 2
        ? { x: normalizedMouseCX, y: normalizedMouseCY }
        : { x: normalizedMouseX, y: normalizedMouseY };
    if (
      this.createType === Shape.ClickSelect &&
      !this.readonly &&
      !this.isCtrlKey &&
      ((!this.isMobile && (e as MouseEvent).buttons === 1) ||
        (this.isMobile && (e as TouchEvent).touches?.length === 1))
    ) {
      this.beginClickSelect(this.mouse);
      return;
    }
    this.rememberOrigin = [
      normalizedMouseX - this.origin.x,
      normalizedMouseY - this.origin.y,
    ];
    if (
      (!this.isMobile && (e as MouseEvent).buttons === 1) ||
      (this.isMobile && (e as TouchEvent).touches?.length === 1)
    ) {
      // 鼠标左键
      const ctrls = this.activeShape.ctrlsData || [];
      this.ctrlIndex = ctrls.findIndex((coor: NumberTuple) =>
        this.isPointInCircle(this.mouse, coor, this.ctrlRadius),
      );
      if (this.ctrlIndex > -1 && !this.readonly) {
        // 点击到控制点
        const [x0, y0] = ctrls[this.ctrlIndex];
        if (
          this.activeShape.type === Shape.Polygon &&
          this.activeShape.coor.length > 2 &&
          this.ctrlIndex === 0
        ) {
          this.handleDblclick(e);
        }
        this.remember = [[offsetX - x0, offsetY - y0]];
      } else if (this.isInBackground(e)) {
        if (this.activeShape.creating && !this.readonly) {
          // 创建中
          if ([Shape.Line, Shape.Polygon].includes(this.activeShape.type)) {
            const [x, y] =
              this.activeShape.coor[this.activeShape.coor.length - 1];
            if (x !== offsetX && y !== offsetY) {
              const nx = Math.round(offsetX - this.origin.x / this.scale);
              const ny = Math.round(offsetY - this.origin.y / this.scale);
              this.activeShape.coor.push([nx, ny]);
            }
          }
        } else if (
          this.createType !== Shape.None &&
          !this.readonly &&
          !this.isCtrlKey
        ) {
          // 开始创建
          let newShape;
          const nx = Math.round(offsetX - this.origin.x / this.scale);
          const ny = Math.round(offsetY - this.origin.y / this.scale);
          const curPoint: NumberTuple = [nx, ny];
          switch (this.createType) {
            case Shape.Circle: {
              newShape = new Circle({ coor: curPoint }, this.dataset.length);
              newShape.creating = true;
              break;
            }
            case Shape.ClickSelect: {
              const { x, y } = this.getPoint(this.mouse);
              newShape = new ClickSelect(
                { coor: [x, y] },
                this.dataset.length,
              );
              this.emit('select', newShape);
              break;
            }
            case Shape.Dot: {
              newShape = new Dot({ coor: curPoint }, this.dataset.length);
              this.emit('add', newShape);
              break;
            }
            case Shape.Grid: {
              newShape = new Grid(
                { coor: [curPoint, curPoint] },
                this.dataset.length,
              );
              newShape.creating = true;
              break;
            }
            case Shape.Line: {
              newShape = new Line({ coor: [curPoint] }, this.dataset.length);
              newShape.creating = true;
              break;
            }
            case Shape.Polygon: {
              newShape = new Polygon(
                { coor: [curPoint] },
                this.dataset.length,
              );
              newShape.creating = true;
              break;
            }
            case Shape.Rect: {
              newShape = new Rect(
                { coor: [curPoint, curPoint] },
                this.dataset.length,
              );
              newShape.creating = true;
              break;
            }
            default: {
              break;
            }
          }
          if (newShape) {
            this.dataset.forEach((sp) => {
              sp.active = false;
            });
            newShape.active = true;
            if (this.createType === Shape.ClickSelect) {
              const clickShapeIndex = this.getClickSelectShapeIndex({
                x: newShape.coor[0],
                y: newShape.coor[1],
              });
              if (clickShapeIndex > -1) {
                this.dataset.splice(clickShapeIndex, 1);
                this.emit('add', newShape);
              } else {
                this.dataset.push(newShape);
              }
            } else {
              this.dataset.push(newShape);
            }
          }
        } else {
          // 是否点击到形状
          const [hitShapeIndex, hitShape] = this.hitOnShape(this.mouse);
          if (hitShapeIndex > -1 && hitShape) {
            hitShape.dragging = true;
            this.dataset.forEach(
              (item, i) => (item.active = i === hitShapeIndex),
            );
            this.dataset.splice(hitShapeIndex, 1);
            this.dataset.push(hitShape);
            if (!this.readonly) {
              this.remember = [];
              if ([Shape.Circle, Shape.Dot].includes(hitShape.type)) {
                const [x, y] = hitShape.coor;
                this.remember = [[offsetX - x, offsetY - y]];
              } else {
                hitShape.coor.forEach((pt: any) => {
                  this.remember.push([offsetX - pt[0], offsetY - pt[1]]);
                });
              }
            }
            this.emit('select', hitShape);
          } else {
            this.activeShape.active = false;
            this.dataset.sort((a, b) => a.index - b.index);
            this.emit('select', null);
          }
        }
        this.update();
      }
    } else if (
      (!this.isMobile && (e as MouseEvent).buttons === 2) ||
      (this.isMobile &&
        (e as TouchEvent).touches?.length === 3 &&
        !this.readonly)
    ) {
      // 鼠标右键
      if ([Shape.Grid].includes(this.activeShape.type) && this.gridMenuEnable) {
        // eslint-disable-next-line no-alert
        const rowCol = prompt(
          'x 行 y 列 x,y',
          [this.activeShape.row, this.activeShape.col].join(','),
        );
        if (typeof rowCol === 'string') {
          const [row, col] = rowCol.split(',');
          if (row && col && /^[1-9]\d*$/.test(row) && /^[1-9]\d*$/.test(col)) {
            this.activeShape.row = Number(row);
            this.activeShape.col = Number(col);
            this.update();
          }
        }
      }
      this.emit('contextmenu', e);
    }
  }
  private handleMouseMove(e: MouseEvent | TouchEvent) {
    if (this.lock) return;
    if (this.localZoomMode) {
      this.handleLocalZoomMouseMove(e);
      return;
    }
    const { mouseX, mouseY, mouseCX, mouseCY } = this.mergeEvent(e);
    const canvasPoint = this.screenToCanvasPoint({ x: mouseX, y: mouseY });
    const canvasCenterPoint = this.screenToCanvasPoint({
      x: mouseCX,
      y: mouseCY,
    });
    const normalizedMouseX = canvasPoint.x;
    const normalizedMouseY = canvasPoint.y;
    const normalizedMouseCX = canvasCenterPoint.x;
    const normalizedMouseCY = canvasCenterPoint.y;
    const offsetX = Math.round(normalizedMouseX / this.scale);
    const offsetY = Math.round(normalizedMouseY / this.scale);
    this.mouse =
      this.isMobile && (e as TouchEvent).touches?.length === 2
        ? { x: normalizedMouseCX, y: normalizedMouseCY }
        : { x: normalizedMouseX, y: normalizedMouseY };
    if (
      this.clickSelectStart &&
      ((!this.isMobile && (e as MouseEvent).buttons === 1) ||
        (this.isMobile && (e as TouchEvent).touches?.length === 1))
    ) {
      this.updateClickSelect(this.mouse);
      if (
        this.basicConfig.wmConfig.visible ||
        this.basicConfig.defectConfig.visible
      ) {
        this.emit('hover', this.getPoint(this.mouse));
      }
      return;
    }
    if (
      ((!this.isMobile && (e as MouseEvent).buttons === 1) ||
        (this.isMobile && (e as TouchEvent).touches?.length === 1)) &&
      this.activeShape.type
    ) {
      if (
        this.ctrlIndex > -1 &&
        this.remember.length > 0 &&
        (this.isInBackground(e) || this.activeShape.type === Shape.Circle)
      ) {
        const [x, y] = this.remember[0] as NumberTuple;
        // resize矩形
        if ([Shape.Grid, Shape.Rect].includes(this.activeShape.type)) {
          const [[x0, y0], [x1, y1]] = this.activeShape.coor;
          let coor: NumberTuple[] = [];
          switch (this.ctrlIndex) {
            case 0: {
              coor = [
                [offsetX - x, offsetY - y],
                [x1, y1],
              ];
              break;
            }
            case 1: {
              coor = [
                [x0, offsetY - y],
                [x1, y1],
              ];
              break;
            }
            case 2: {
              coor = [
                [x0, offsetY - y],
                [offsetX - x, y1],
              ];
              break;
            }
            case 3: {
              coor = [
                [x0, y0],
                [offsetX - x, y1],
              ];
              break;
            }
            case 4: {
              coor = [
                [x0, y0],
                [offsetX - x, offsetY - y],
              ];
              break;
            }
            case 5: {
              coor = [
                [x0, y0],
                [x1, offsetY - y],
              ];
              break;
            }
            case 6: {
              coor = [
                [offsetX - x, y0],
                [x1, offsetY - y],
              ];
              break;
            }
            case 7: {
              coor = [
                [offsetX - x, y0],
                [x1, y1],
              ];
              break;
            }
            default: {
              break;
            }
          }
          // @ts-ignore
          let [[a0, b0], [a1, b1]] = coor;
          if (
            a0 < 0 ||
            a1 < 0 ||
            b0 < 0 ||
            b1 < 0 ||
            a1 > this.IMAGE_ORIGIN_WIDTH ||
            b1 > this.IMAGE_ORIGIN_HEIGHT
          ) {
            // 偶然触发 超出边界处理
            a0 < 0 && (a0 = 0);
            a1 < 0 && (a1 = 0);
            b0 < 0 && (b0 = 0);
            b1 < 0 && (b1 = 0);
            if (a1 > this.IMAGE_ORIGIN_WIDTH) {
              a1 = this.IMAGE_ORIGIN_WIDTH;
            }
            if (b1 > this.IMAGE_ORIGIN_HEIGHT) {
              b1 = this.IMAGE_ORIGIN_HEIGHT;
            }
          }

          if (a1 - a0 >= this.MIN_WIDTH && b1 - b0 >= this.MIN_HEIGHT) {
            this.activeShape.coor = [
              [a0, b0],
              [a1, b1],
            ];
          } else {
            this.emit(
              'warn',
              `Width cannot be less than ${this.MIN_WIDTH},Height cannot be less than${this.MIN_HEIGHT}。`,
            );
          }
        } else if (
          [Shape.Line, Shape.Polygon].includes(this.activeShape.type)
        ) {
          const nx = Math.round(offsetX - this.origin.x / this.scale);
          const ny = Math.round(offsetY - this.origin.y / this.scale);
          const newPoint = [nx, ny];
          this.activeShape.coor.splice(this.ctrlIndex, 1, newPoint);
        } else if (this.activeShape.type === Shape.Circle) {
          const nx = Math.round(offsetX - this.origin.x / this.scale);
          const newRadius = nx - this.activeShape.coor[0];
          if (newRadius >= this.MIN_RADIUS) this.activeShape.radius = newRadius;
        }
        if (this.isMagnifierVisible) {
          const [ux, uy] = this.isMobile
            ? [mouseCX, mouseCY]
            : [mouseX, mouseY];
          this.createMagnifier(ux, uy);
        }
      } else if (this.activeShape.dragging && !this.readonly) {
        // 拖拽
        // 拖拽点的时候，也需要触发放大镜
        if (this.isMagnifierVisible && this.activeShape.type === 3) {
          const [ux, uy] = this.isMobile
            ? [mouseCX, mouseCY]
            : [mouseX, mouseY];
          this.createMagnifier(ux, uy);
        }
        let coor = [];
        let noLimit = true;
        const w = this.IMAGE_ORIGIN_WIDTH || this.WIDTH;
        const h = this.IMAGE_ORIGIN_HEIGHT || this.HEIGHT;
        if ([Shape.Circle, Shape.Dot].includes(this.activeShape.type)) {
          // @ts-ignore
          const [t1, t2] = this.remember[0];
          const x = offsetX - t1;
          const y = offsetY - t2;
          if (x < 0 || x > w || y < 0 || y > h) noLimit = false;
          coor = [x, y];
        } else {
          for (let i = 0; i < this.activeShape.coor.length; i++) {
            const tar = this.remember[i];
            if (tar) {
              const x = offsetX - tar[0];
              const y = offsetY - tar[1];
              if (x < 0 || x > w || y < 0 || y > h) noLimit = false;
              coor.push([x, y]);
            }
          }
        }
        if (noLimit) this.activeShape.coor = coor;
      } else if (this.activeShape.creating && this.isInBackground(e)) {
        const x = Math.round(offsetX - this.origin.x / this.scale);
        const y = Math.round(offsetY - this.origin.y / this.scale);
        // 创建矩形
        if ([Shape.Grid, Shape.Rect].includes(this.activeShape.type)) {
          this.activeShape.coor.splice(1, 1, [x, y]);
        } else if (this.activeShape.type === Shape.Circle) {
          const [x0, y0] = this.activeShape.coor;
          const r = Math.hypot(x0 - x, y0 - y);
          this.activeShape.radius = r;
        }
      }
      this.update();
    } else if (
      [Shape.Line, Shape.Polygon].includes(this.activeShape.type) &&
      this.activeShape.creating
    ) {
      // 多边形添加点
      this.update();
    } else if (
      (!this.isMobile &&
        (e as MouseEvent).buttons === 2 &&
        (e as MouseEvent).which === 3) ||
      (this.isMobile &&
        (e as TouchEvent).touches?.length === 1 &&
        !this.isTouch2)
    ) {
      const [rememberOriginX = 0, rememberOriginY = 0] = this.rememberOrigin;
      // 拖动背景
      this.origin = {
        x: Math.round(normalizedMouseX - rememberOriginX),
        y: Math.round(normalizedMouseY - rememberOriginY),
      };
      this.update();
    } else if (this.isMobile && (e as TouchEvent).touches?.length === 2) {
      this.isTouch2 = true;
      const touch0 = (e as TouchEvent).touches[0];
      const touch1 = (e as TouchEvent).touches[1];
      const cur = this.scaleTouchStore;
      this.scaleTouchStore = Math.abs(
        // @ts-ignore
        (touch1.clientX - touch0.clientX) * (touch1.clientY - touch0.clientY),
      );
      this.setScale(this.scaleTouchStore > cur, true);
    }
    if (
      this.basicConfig.wmConfig.visible ||
      this.basicConfig.defectConfig.visible
    ) {
      this.emit('hover', this.getPoint(this.mouse));
    }
  }
  private handleMouseUp(e: MouseEvent | TouchEvent) {
    if (this.lock) return;
    if (this.localZoomMode) {
      this.handleLocalZoomMouseUp();
      return;
    }
    if (this.clickSelectStart) {
      this.finishClickSelect();
      return;
    }
    // 鼠标抬起则卸载放大器
    this.destroyMagnifier();
    // 处理移动端触摸事件
    if (this.isMobile) {
      if ((e as TouchEvent).touches?.length === 0) {
        this.isTouch2 = false;
      }
      if (Date.now() - this.dblTouchStore < this.dblTouch) {
        this.handleDblclick(e);
        return;
      }
      this.dblTouchStore = Date.now();
    }
    this.remember = [];
    // 处理标注创建完成
    if (this.activeShape.type !== Shape.None && !this.isCtrlKey) {
      this.activeShape.dragging = false;
      if (this.activeShape.creating) {
        this.handleShapeCreationComplete();
        this.update();
      } else if (this.activeShape.type === Shape.ClickSelect) {
        this.emit('add', this.activeShape);
      }
    }
  }
  /** 处理标注完成逻辑 */
  private handleShapeCreationComplete() {
    if ([Shape.Grid, Shape.Rect].includes(this.activeShape.type)) {
      const [[x0, y0], [x1, y1]] = this.activeShape.coor;

      if (
        Math.abs(x0 - x1) < this.MIN_WIDTH ||
        Math.abs(y0 - y1) < this.MIN_HEIGHT
      ) {
        this.dataset.pop();
        this.emit(
          'warn',
          `Width cannot be less than ${this.MIN_WIDTH},Height cannot be less than ${this.MIN_HEIGHT}`,
        );
      } else {
        // 调整坐标为左上角和右下角
        this.activeShape.coor = [
          [Math.min(x0, x1), Math.min(y0, y1)],
          [Math.max(x0, x1), Math.max(y0, y1)],
        ];
        this.activeShape.creating = false;
        this.emit('add', this.activeShape);
      }
    } else if (this.activeShape.type === Shape.Circle) {
      if (this.activeShape.radius < this.MIN_RADIUS) {
        this.dataset.pop();
        this.emit('warn', `Radius cannot be less than ${this.MIN_WIDTH}`);
      } else {
        this.activeShape.creating = false;
        this.emit('add', this.activeShape);
      }
    }
  }
  private handleDblclick(e: MouseEvent | TouchEvent) {
    e.stopPropagation();
    if (this.lock) return;
    if ([Shape.Line, Shape.Polygon].includes(this.activeShape.type)) {
      const canPolygon =
        this.activeShape.type === Shape.Polygon &&
        this.activeShape.coor.length > 2;
      const canLine =
        this.activeShape.type === Shape.Line &&
        this.activeShape.coor.length > 1;
      if (canPolygon) {
        this.emit('add', this.activeShape);
        this.activeShape.creating = false;
        this.update();
      }
      if (canLine) {
        this.activeShape.creating = false;
        this.activeShape.label = '11.82mm';
        this.update();
      }
    } else if (
      [Shape.Grid].includes(this.activeShape.type) && // 双击切换网格分区选中状态
      this.activeShape.active
    ) {
      this.activeShape.gridRects.forEach(
        (rect: { coor: NumberTuple[]; index: number }) => {
          if (this.isPointInRect(this.mouse, rect.coor)) {
            const thisIndex = this.activeShape.selected.indexOf(rect.index);
            if (thisIndex === -1) {
              this.activeShape.selected.push(rect.index);
            } else {
              this.activeShape.selected.splice(thisIndex, 1);
            }
          }
        },
      );
      this.update();
    }
  }
  private handleKeydown(e: KeyboardEvent) {
    if (e.code === this.ctrlCode) {
      this.isCtrlKey = true;
    }
  }
  private handleKeyup(e: KeyboardEvent) {
    if (e.code === this.ctrlCode) {
      this.isCtrlKey = false;
    }
    if (this.lock || this.readonly) return;
    if (this.activeShape.type) {
      if (
        [Shape.Line, Shape.Polygon].includes(this.activeShape.type) &&
        e.key === 'Escape'
      ) {
        if (this.activeShape.coor.length > 1 && this.activeShape.creating) {
          this.activeShape.coor.pop();
        } else {
          this.deleteByIndex(this.activeShape.index);
        }
        this.update();
      } else if (e.key === 'Backspace') {
        this.deleteByIndex(this.activeShape.index);
      }
    }
  }
  /** 初始化配置 */
  private initSetting(explicitCanvasSize?: number) {
    if (!this.canvas) return;

    const dpr = window.devicePixelRatio || 1;
    // 处理图片跨域问题
    this.image.crossOrigin = 'anonymous';
    this.canvas.style.userSelect = 'none';
    this.ctx = this.canvas.getContext('2d', { alpha: this.alpha });

    // 设置画布尺寸：显式尺寸 > 容器宽（自适应/旧版行为）> 配置 size 数字 > 600
    const fallbackSize =
      Number.parseInt(`${this.basicConfig.size}`.replace(/[^\d.]/g, ''), 10) ||
      600;
    const canvasSize =
      (explicitCanvasSize && explicitCanvasSize > 0
        ? explicitCanvasSize
        : 0) || Math.round(this.canvas.clientWidth) || fallbackSize;
    this.WIDTH = canvasSize;
    this.HEIGHT = canvasSize;
    this.canvas.width = canvasSize * dpr;
    this.canvas.height = canvasSize * dpr;
    this.canvas.style.width = `${canvasSize}px`;
    this.canvas.style.height = `${canvasSize}px`;
    this.canvas.style.backgroundColor =
      this.options.backgroundColor || 'transparent';
    // 画布 CSS 宽 / 逻辑宽比例只在画布重置时更新，避免缩放交互中反复 getBoundingClientRect 强制布局
    const rectWidth = this.canvas.getBoundingClientRect().width;
    this.canvasCssScale = rectWidth > 0 ? rectWidth / canvasSize : 1;

    // 新画布需要重新计算缩放和居中位置，不能复用上一次尺寸的状态
    this.scaleStep = 0;
    this.origin = { x: 0, y: 0 };
    this.localZoomTransform = { scale: 1, offsetX: 0, offsetY: 0 };
    this.localZoomStart = null;
    this.localZoomCurrent = null;
    this.clickSelectStart = null;
    this.clickSelectCurrent = null;
    this.clickSelectDragging = false;

    // 设置默认图片尺寸
    const defaultImageSize = 1024;
    this.IMAGE_ORIGIN_WIDTH = this.IMAGE_WIDTH = defaultImageSize;
    this.IMAGE_ORIGIN_HEIGHT = this.IMAGE_HEIGHT = defaultImageSize;

    // 创建离屏画布
    this.offScreen = document.createElement('canvas');
    this.offScreen.width = defaultImageSize;
    this.offScreen.height = defaultImageSize;
    this.offscreenCtx = this.offScreen.getContext('2d', {
      willReadFrequently: true,
    });

    // 创建wafer图层画布
    this.waferCanvas = document.createElement('canvas');
    this.waferCanvas.width = defaultImageSize;
    this.waferCanvas.height = defaultImageSize;
    this.waferCtx = this.waferCanvas.getContext('2d', {
      willReadFrequently: true,
    });

    // 缩放上下文以匹配设备像素比
    this.ctx?.scale(dpr, dpr);
  }

  /** 初始化事件 */
  private initEvents() {
    if (!this.canvas) return;
    this.image.addEventListener('load', this.handleLoad);
    this.canvas.addEventListener('touchstart', this.handleMouseDown);
    this.canvas.addEventListener('touchmove', this.handleMouseMove);
    this.canvas.addEventListener('touchend', this.handleMouseUp);
    this.canvas.addEventListener('contextmenu', this.handleContextmenu);

    // @ts-ignore
    this.canvas.addEventListener('mousewheel', this.handleMousewheel);
    this.canvas.addEventListener('wheel', this.handleMousewheel);
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mouseup', this.handleMouseUp);
    this.canvas.addEventListener('dblclick', this.handleDblclick);
    document.body.addEventListener('keydown', this.handleKeydown, true);
    document.body.addEventListener('keyup', this.handleKeyup, true);
  }

  /** 计算中心点及Die的尺寸信息 */
  private calcCenterPointAndDieSize() {
    this.setGridItemWidth();
    this.setGridItemHeight();
    this.setCenterPoint();
    this.setRadius();
  }
  /** 更新die总数信息 */
  private updateDieTotal() {
    if (this.waferCtx) {
      let xCount = 0;
      let yCount = 0;
      this.rebuildCoordinateCompression();
      if (this.coordinateCompression) {
        xCount = this.coordinateCompression.x.coordinates.length;
        yCount = this.coordinateCompression.y.coordinates.length;
      } else if (
        this.basicConfig.wmConfig.visible &&
        this.waferData.waferMap
      ) {
        const waferMap = this.waferData.waferMap;
        // 新数据提供 xCount/yCount；旧数据 xDieCount 为跨度，+1 修正为总数
        xCount =
          waferMap.xCount ??
          (waferMap.xDieCount !== undefined ? waferMap.xDieCount + 1 : 30);
        yCount =
          waferMap.yCount ??
          (waferMap.yDieCount !== undefined ? waferMap.yDieCount + 1 : 30);
      } else if (
        this.basicConfig.defectConfig.visible &&
        this.waferData.defect
      ) {
        const defect = this.waferData.defect;
        xCount = defect.xCount ?? 30;
        yCount = defect.yCount ?? 30;
      } else {
        xCount = 30;
        yCount = 30;
      }
      this.xCount = xCount;
      this.yCount = yCount;
      this.calcCenterPointAndDieSize();
    }
  }

  /* ---------- 渲染调度 ---------- */

  private drawWafer(isInitLoad?: boolean, invalidate = true) {
    if (this.destroyed) return;
    if (invalidate) this.renderVersion++;
    this.drawRequested = true;
    this.drawInitLoadRequested ||= Boolean(isInitLoad);
    this.scheduleDraw();
  }

  private scheduleDraw(): void {
    if (this.destroyed || (this.renderingPaused && this.exportDepth === 0))
      return;
    this.drawController?.abort();
    waferRenderQueue.cancelActive(this);
    this.drawTask ||= Promise.resolve().then(() => this.flushDrawQueue());
  }

  getRenderVersion(): number {
    return this.renderVersion;
  }

  /** 缓存或隐藏时只暂停绘制，数据、选择和缩放仍由原实例保存。 */
  setRenderingPaused(paused: boolean): void {
    if (this.renderingPaused === paused) return;
    this.renderingPaused = paused;
    if (paused && this.exportDepth === 0) {
      this.drawRequested ||= Boolean(this.drawTask);
      this.drawController?.abort();
      waferRenderQueue.cancel(this);
    } else if (this.drawRequested) {
      this.scheduleDraw();
    } else if (this.viewUpdatePending) {
      // 暂停期间也可能只更新选择标记，恢复时补交画布，不必重算整张晶圆。
      void this.update(this.pendingViewImage);
    }
  }

  /** 等待真实绘制与最后一次画布提交，不用固定帧数代替完成状态。 */
  async whenRendered(): Promise<void> {
    this.flushPendingDraw();
    do {
      const drawing = this.drawTask;
      if (drawing) await drawing;
      // 绘制过程中可能安排尺寸适配的重绘，也必须一并完成。
      this.flushPendingDraw();
      const update = this.updateTask;
      if (update) await update;
      if (!this.drawTask && update === this.updateTask) break;
    } while (!this.destroyed);
    if (this.destroyed) throw new Error('晶圆组件已卸载，无法完成导出');
    if (this.drawError) throw this.drawError;
  }

  /** 提交已有防抖任务，隐藏页仍遵守暂停规则，不额外启动绘制。 */
  flushPendingDraw(): void {
    this.debounceRedrawWafer.flush();
  }

  /** 导出临时恢复完整文字；释放时不修改配置和交互状态。 */
  async prepareExport(): Promise<() => void> {
    this.exportDepth++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.exportDepth--;
      if (!this.destroyed && this.exportDepth === 0) {
        this.drawRequested = true;
        this.scheduleDraw();
      }
    };
    try {
      if (this.exportDepth === 1) {
        this.drawRequested = true;
        this.scheduleDraw();
      }
      await this.whenRendered();
      return release;
    } catch (error) {
      release();
      throw error;
    }
  }

  private getRenderPointCount(): number {
    return (
      (this.waferData.waferMap?.dataList?.length || 0) +
      (this.waferData.defect?.dataList?.length || 0)
    );
  }

  private setDrawingState(isDrawing: boolean): void {
    if (this.isDrawing === isDrawing) return;
    this.isDrawing = isDrawing;
    this.emit(isDrawing ? 'drawingStart' : 'drawingEnd');
  }

  /** 在任务真正获得执行权时读取最新状态，合并排队期间的重复请求。 */
  private async executeLatestDraw(signal?: AbortSignal): Promise<void> {
    throwIfRenderAborted(signal);
    if (this.destroyed) return;

    this.drawRequested = false;
    this.drawError = undefined;
    const isInitLoad = this.drawInitLoadRequested;
    this.drawInitLoadRequested = false;
    if (this.resizeRequested) {
      const canvasSize = this.pendingCanvasSize;
      this.resizeRequested = false;
      this.pendingCanvasSize = undefined;
      this.initSetting(canvasSize);
      this.updateControlPointsActualCoords();
      this.contourGridPoints = [];
    }
    // 小数据不进共享队列，但同样需要在重查、隐藏和卸载时取消。
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    this.drawController = controller;
    try {
      await this.renderWafer(isInitLoad, controller.signal);
    } finally {
      signal?.removeEventListener('abort', cancel);
      if (this.drawController === controller) this.drawController = null;
    }
  }

  private async flushDrawQueue() {
    if (this.destroyed) {
      this.drawTask = null;
      return;
    }
    this.setDrawingState(true);
    try {
      while (
        this.drawRequested &&
        !this.destroyed &&
        (!this.renderingPaused || this.exportDepth > 0)
      ) {
        try {
          await (this.getRenderPointCount() > LARGE_DATA_RENDER_THRESHOLD
            ? waferRenderQueue.enqueue(this, (signal) =>
                this.executeLatestDraw(signal),
              )
            : this.executeLatestDraw());
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError')
            continue;
          this.drawError = error;
          console.error('Wafer drawing failed:', error);
        }
      }
    } finally {
      this.drawTask = null;
      this.setDrawingState(false);
    }
  }

  private async renderWafer(isInitLoad?: boolean, signal?: AbortSignal) {
    // 让出一次宏任务，给宿主 UI 时间更新等待状态
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    throwIfRenderAborted(signal);

    if (this.waferCanvas && this.waferCtx) {
      const waferCtx = this.waferCtx as CanvasRenderingContext2D;
      waferCtx.clearRect(0, 0, this.waferCanvas.width, this.waferCanvas.height);

      if (this.IMAGE_WIDTH > 0 && this.IMAGE_HEIGHT > 0) {
        this.waferCanvas.width = this.IMAGE_WIDTH;
        this.waferCanvas.height = this.IMAGE_HEIGHT;
      }

      waferCtx.translate(0, 0);
      this.updateDieTotal();

      if (this.basicConfig.chartType === 'contourmap') {
        await this.drawContourMap();
        throwIfRenderAborted(signal);
      } else {
        // 按顺序绘制各层
        await this.drawBackgroundImage(signal);
        throwIfRenderAborted(signal);
        await this.drawOutline();
        throwIfRenderAborted(signal);
        await this.drawDie(signal);
        throwIfRenderAborted(signal);
        await this.drawGridLines();
        throwIfRenderAborted(signal);
        await this.drawReticle();
        throwIfRenderAborted(signal);
        await this.drawZones();
        throwIfRenderAborted(signal);
        await this.drawDefect();
        throwIfRenderAborted(signal);
        await this.drawLegendValue(signal);
        throwIfRenderAborted(signal);
        await this.drawWaferSummaryInfo();
        throwIfRenderAborted(signal);
      }

      if (isInitLoad || this.scale === 1) {
        // 首次绘制和尺寸适配不代表用户修改了图表，不使导出快照失效。
        await this.fitZoom(false);
      } else {
        await this.update(this.waferCanvas);
      }
      throwIfRenderAborted(signal);
    }
  }
  /** 创建并配置webgl缓冲区 */
  private setupBuffer(
    gl: WebGLRenderingContext,
    data: BufferSource,
    webglBuffers: WebGLBuffer[],
  ): WebGLBuffer {
    const buffer = gl.createBuffer();
    webglBuffers.push(buffer); // 如果提供了收集数组，则记录缓冲区
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
  }
  /** 清理WebGL缓冲区 */
  private cleanupBuffers(
    gl: WebGLRenderingContext,
    webglBuffers: WebGLBuffer[],
  ): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    webglBuffers.forEach((buffer) => {
      if (buffer) {
        gl.deleteBuffer(buffer);
      }
    });
    webglBuffers.length = 0;
  }
  /**
   * 准备die数据（按图层分批，只为当前图层需要的元素分配显存）
   */
  private prepareData(
    pointsData: Record<string, any>[],
    startIndex: number,
    endIndex: number,
    cellSize: CellSize,
    layer: WebGLRenderLayer,
    gradientColorMap: Map<number, number[]>,
  ) {
    // 从配置中解构常用值，减少后续访问开销
    const wmConfig = this.basicConfig.wmConfig;
    const isLegacyHeatmap =
      this.basicConfig.chartType === undefined && wmConfig.isHeatmap === true;
    const getPosition = this.createDiePositionReader();
    const isRectLayer = layer === 'rect';
    const isBorderLayer = layer === 'border';
    const isGlowLayer = layer === 'glow';
    const isMaskLayer = layer === 'mask';
    const {
      drawType = 'whole',
      value,
      addedValue = value,
      border,
      hightlight,
      shadow,
      legendColor,
      heatmapMinColor,
      heatmapMaxColor,
      transparency = 100,
    } = wmConfig;

    // 获取晶圆图数据，设置默认值避免空指针异常
    const waferMap = this.waferData.waferMap || {
      minValue: 0,
      maxValue: 0,
      heatmapMinValue: 0,
      heatmapMaxValue: 0,
      heatmapMinColor: '' as string | undefined,
      heatmapMaxColor: '' as string | undefined,
      legendList: [] as Record<string, any>[],
    };

    const {
      heatmapMinColor: userHeatmapMinColor,
      heatmapMaxColor: userHeatmapMaxColor,
    } = waferMap;
    const finaHeatmapMinColor =
      userHeatmapMinColor || heatmapMinColor || this.DEFAULT_MIN_COLOR;
    const finaHeatmapMaxColor =
      userHeatmapMaxColor || heatmapMaxColor || this.DEFAULT_MAX_COLOR;

    // 旧版 isHeatmap 模式：颜色仍按图例首尾插值，避免旧配置视觉变化
    const legacyHeatmapColors = isLegacyHeatmap
      ? (waferMap.legendList.length > 0
          ? [
              waferMap.legendList[0]?.hexColor,
              waferMap.legendList[waferMap.legendList.length - 1]?.hexColor,
            ]
          : ['#FF0000', '#0000FF'])
      : [];

    // 缓存常用计算值
    const cellWidth = cellSize.width;
    const cellHeight = cellSize.height;
    const borderCellSize = isBorderLayer ? this.calculateCellSize(2) : cellSize;

    // 预计算数组大小，避免动态扩容
    const pointCount = Math.max(0, endIndex - startIndex);
    let borderItemCount = 0;
    let shadowItemCount = 0;
    if (isBorderLayer || isGlowLayer || isMaskLayer) {
      for (let index = startIndex; index < endIndex; index++) {
        const point = pointsData[index];
        if (!point) continue;
        if (isBorderLayer) {
          borderItemCount +=
            (border && point[border] ? 1 : 0) +
            (hightlight && point[hightlight] ? 1 : 0);
        }
        if ((isGlowLayer || isMaskLayer) && shadow && point[shadow]) {
          shadowItemCount++;
        }
      }
    }
    const rectArraySize = isRectLayer
      ? pointCount * this.RECT_VERTICES * 2
      : 0; // 每个顶点2个坐标(x,y)
    const borderArraySize = borderItemCount * this.BORDER_VERTICES * 2;
    const maskArraySize = isMaskLayer
      ? shadowItemCount * this.RECT_VERTICES * 2
      : 0;
    const glowArraySize = isGlowLayer
      ? shadowItemCount * this.GLOW_VERTICES * 2
      : 0;

    // 仅为当前绘制层分配数组，避免可选效果占用大块空内存
    const positions = new Float32Array(rectArraySize);
    const colors = new Float32Array(rectArraySize * 2);
    const borderPositions = new Float32Array(borderArraySize);
    const borderColors = new Float32Array(borderArraySize * 2);
    const maskPositions = new Float32Array(maskArraySize);
    const maskColors = new Float32Array(maskArraySize * 2);
    const glowPositions = new Float32Array(glowArraySize);
    const glowColors = new Float32Array(glowArraySize * 2);

    // 使用指针跟踪当前填充位置，避免重复计算索引
    let borderColorIdx = 0;
    let borderPosIdx = 0;
    let colorIdx = 0;
    let rectPosIdx = 0;
    let glowColorIdx = 0;
    let glowPosIdx = 0;
    let maskColorIdx = 0;
    let maskPosIdx = 0;

    // 定义画布起点坐标
    const startX = -1;
    const startY = 1;

    const [minDieVal, maxDieVal] = this.mapHeatmapValue;
    const [minColorValue, maxColorValue] = this.heatmapColorRange;
    const heatmapLegendMode = wmConfig.heatmapLegendMode || 'slider';
    const configuredIntervalCount = Number(wmConfig.heatmapLegendIntervalCount);
    const heatmapIntervalCount = Number.isInteger(configuredIntervalCount)
      ? Math.min(20, Math.max(2, configuredIntervalCount))
      : 10;
    const intervalColors =
      heatmapLegendMode === 'interval'
        ? generateDistinctHeatmapIntervalColors(
            wmConfig.heatmapColorList || [],
            heatmapIntervalCount,
          )
        : [];

    /**
     * 根据点的值获取颜色
     */
    const rawGetColorByValue = (
      point: Record<string, any>,
      valueField: string,
    ): number[] => {
      try {
        // 热力图模式处理
        if (this.isHeatmapChart) {
          // 0 是热力图中的有效数值，不能按空值处理。
          if (
            !point ||
            point[valueField] === null ||
            point[valueField] === undefined ||
            point[valueField] === ''
          ) {
            return [0.9294, 0.9294, 0.9294, transparency / 100];
          }

          if (isLegacyHeatmap) {
            // 旧版 isHeatmap：单阈值过滤 + 图例首尾颜色插值
            const numericValue = Number(point[valueField]);
            if (
              !Number.isFinite(numericValue) ||
              numericValue < minDieVal ||
              numericValue > maxDieVal
            ) {
              return [0.9, 0.9, 0.9, transparency / 100];
            }
            const { minValue = 0, maxValue = 0 } = waferMap;
            const ratio =
              maxValue - minValue > 0
                ? (numericValue - minValue) / (maxValue - minValue)
                : 0;
            return hexToWebGLColor(
              getInterpolatedColor(ratio, legacyHeatmapColors),
              transparency / 100,
            );
          }

          let dieValue: number;
          let preciseDieValue: BigNumber;
          try {
            preciseDieValue = Big(point[valueField]);
            dieValue = preciseDieValue.toNumber();
          } catch {
            // 处理Big.js转换错误
            dieValue = 0;
            preciseDieValue = Big(0);
          }

          if (this.isHeatmapIntervalSelected(preciseDieValue)) {
            point.dieValueEnum = -1;
            return [0.9, 0.9, 0.9, transparency / 100];
          }

          if (preciseDieValue.gte(minDieVal) && preciseDieValue.lte(maxDieVal)) {
            if (heatmapLegendMode === 'interval') {
              let intervalIndex = 0;
              try {
                const colorRange = Big(maxColorValue).minus(minColorValue);
                intervalIndex = Math.floor(
                  preciseDieValue
                    .minus(minColorValue)
                    .div(colorRange)
                    .times(heatmapIntervalCount)
                    .toNumber(),
                );
              } catch {
                intervalIndex = 0;
              }
              intervalIndex = Math.min(
                heatmapIntervalCount - 1,
                Math.max(0, intervalIndex),
              );
              const displayIndex = heatmapIntervalCount - 1 - intervalIndex;
              point.dieValueEnum = 0;
              return hexToWebGLColor(
                intervalColors[displayIndex] as string,
                transparency / 100,
              );
            }
            let ratio = 0;
            try {
              // 使用 Big.js 计算归一化比例，避免微小数值区间在 number 减法中
              // 被舍入，从而造成颜色集中在少数几个等级。
              ratio = preciseDieValue
                .minus(minColorValue)
                .times(100)
                .div(Big(maxColorValue).minus(minColorValue))
                .round(0)
                .toNumber();
            } catch {
              ratio = mapToRange(dieValue, minColorValue, maxColorValue);
            }
            ratio = Math.min(100, Math.max(0, ratio));
            point.dieValueEnum = 0;
            return gradientColorMap.get(ratio) as number[];
          } else {
            if (preciseDieValue.lt(minColorValue)) {
              point.dieValueEnum = -2;
              return hexToWebGLColor(
                finaHeatmapMinColor || this.DEFAULT_MIN_COLOR,
                transparency / 100,
              );
            } else if (preciseDieValue.gt(maxColorValue)) {
              point.dieValueEnum = 2;
              return hexToWebGLColor(
                finaHeatmapMaxColor || this.DEFAULT_MAX_COLOR,
                transparency / 100,
              );
            } else {
              point.dieValueEnum = preciseDieValue.lt(minDieVal) ? -1 : 1;
              return [0.9, 0.9, 0.9, transparency / 100];
            }
          }
        } else {
          // 非热力图模式，从图例映射中获取颜色
          if (!point) {
            return [0.9294, 0.9294, 0.9294, transparency / 100];
          }

          return this.mapLegendValues.includes(point[valueField])
            ? [0.9, 0.9, 0.9, transparency / 100]
            : (this.dieLegendMap.get(point[valueField]) || {})[
                `_o_${legendColor}`
              ] || [0.9294, 0.9294, 0.9294, transparency / 100];
        }
      } catch (error) {
        console.error('Error in getColorByValue:', error);
        return [0.9294, 0.9294, 0.9294, transparency / 100];
      }
    };

    /**
     * 热力图颜色 memo：同一次绘制内区间 / 色阶 / 配置恒定，
     * 相同原始值（含 addedValue 字段）复用颜色与 dieValueEnum，
     * 避免每个 die 重复构造 Big 对象与区间比较。
     */
    const heatmapMemo = this.heatmapColorMemo;
    const getColorByValue = (
      point: Record<string, any>,
      valueField: string,
    ): number[] => {
      if (
        heatmapMemo &&
        point &&
        this.isHeatmapChart &&
        point[valueField] !== null &&
        point[valueField] !== undefined &&
        point[valueField] !== ''
      ) {
        const memoKey = `${valueField}:${String(point[valueField])}`;
        const hit = heatmapMemo.get(memoKey);
        if (hit) {
          if (hit.enum !== undefined) point.dieValueEnum = hit.enum;
          return hit.color;
        }
        const color = rawGetColorByValue(point, valueField);
        heatmapMemo.set(memoKey, { color, enum: point.dieValueEnum });
        return color;
      }
      return rawGetColorByValue(point, valueField);
    };

    /**
     * 创建边框顶点和颜色数据
     */
    const createBorder = (
      position: { left: number; top: number; right: number; bottom: number },
      size: CellSize,
      borderColor: number[],
    ) => {
      const { left, top, right, bottom } = position;
      // 计算内边框坐标
      const innerLeft = left + size.borderWidth;
      const innerRight = right - size.borderWidth;
      const innerTop = top + size.borderHeight;
      const innerBottom = bottom - size.borderHeight;

      // 四条边框的顶点数据
      const borderVerts = [
        // 上边框
        left,
        top,
        right,
        top,
        left,
        innerTop,
        right,
        top,
        right,
        innerTop,
        left,
        innerTop,
        // 右边框
        right,
        top,
        right,
        bottom,
        innerRight,
        top,
        right,
        bottom,
        innerRight,
        bottom,
        innerRight,
        top,
        // 下边框
        left,
        bottom,
        right,
        bottom,
        left,
        innerBottom,
        right,
        bottom,
        right,
        innerBottom,
        left,
        innerBottom,
        // 左边框
        left,
        top,
        left,
        bottom,
        innerLeft,
        top,
        left,
        bottom,
        innerLeft,
        bottom,
        innerLeft,
        top,
      ];

      borderPositions.set(borderVerts, borderPosIdx);
      borderPosIdx += borderVerts.length;

      // 设置边框颜色
      for (let i = 0; i < this.BORDER_VERTICES; i++) {
        borderColors.set(borderColor, borderColorIdx);
        borderColorIdx += 4;
      }
    };

    const writeRectVertices = (
      target: Float32Array,
      offset: number,
      left: number,
      right: number,
      top: number,
      bottom: number,
    ): number => {
      if (drawType === 'ltTorb') {
        target[offset] = left;
        target[offset + 1] = top;
        target[offset + 2] = right;
        target[offset + 3] = top;
        target[offset + 4] = left;
        target[offset + 5] = bottom;
        target[offset + 6] = right;
        target[offset + 7] = top;
        target[offset + 8] = right;
        target[offset + 9] = bottom;
        target[offset + 10] = left;
        target[offset + 11] = bottom;
      } else {
        target[offset] = left;
        target[offset + 1] = bottom;
        target[offset + 2] = right;
        target[offset + 3] = bottom;
        target[offset + 4] = left;
        target[offset + 5] = top;
        target[offset + 6] = right;
        target[offset + 7] = bottom;
        target[offset + 8] = right;
        target[offset + 9] = top;
        target[offset + 10] = left;
        target[offset + 11] = top;
      }
      return offset + this.RECT_VERTICES * 2;
    };
    const blackBorderColor = [0, 0, 0, 1];
    const highlightBorderColor = [0.501_96, 0, 0.501_96, 1];
    const maskColor = [0.9294, 0.9294, 0.9294, 0.5];
    const glowColor = [1, 1, 0.3, 0.7];
    // 主处理循环
    for (let index = startIndex; index < endIndex; index++) {
      const point = pointsData[index];
      if (!point) continue;
      const displayPosition = getPosition(point);
      if (!displayPosition) continue;
      // 计算当前点的边界坐标
      const left = startX + displayPosition.x * cellWidth;
      const right = left + cellWidth;
      const top = startY - displayPosition.y * cellHeight;
      const bottom = top - cellHeight;

      if (isRectLayer) {
        rectPosIdx = writeRectVertices(
          positions,
          rectPosIdx,
          left,
          right,
          top,
          bottom,
        );
        // 设置顶点颜色
        const color = getColorByValue(point, value);
        if (drawType === 'lbTort' || drawType === 'ltTorb') {
          // 双色模式：前3个顶点一种颜色，后3个顶点另一种颜色
          const addedColor = getColorByValue(point, addedValue);
          for (let i = 0; i < this.RECT_VERTICES; i++) {
            colors.set(i < 3 ? color : addedColor, colorIdx);
            colorIdx += 4;
          }
        } else {
          // 单色模式：所有顶点相同颜色
          for (let i = 0; i < this.RECT_VERTICES; i++) {
            colors.set(color, colorIdx);
            colorIdx += 4;
          }
        }
      }

      // 根据条件创建边框
      if (isBorderLayer && border && point[border]) {
        createBorder(
          { left, top, right, bottom },
          borderCellSize,
          blackBorderColor,
        ); // 黑色边框
      }
      if (isBorderLayer && hightlight && point[hightlight]) {
        createBorder(
          { left, top, right, bottom },
          cellSize,
          highlightBorderColor,
        ); // 紫色高亮
      }

      // 处理阴影效果
      if ((isGlowLayer || isMaskLayer) && shadow && point[shadow]) {
        if (isMaskLayer) {
          // 设置遮罩顶点(与主矩形相同)
          maskPosIdx = writeRectVertices(
            maskPositions,
            maskPosIdx,
            left,
            right,
            top,
            bottom,
          );

          // 设置遮罩颜色(灰色半透明)
          for (let i = 0; i < this.RECT_VERTICES; i++) {
            maskColors.set(maskColor, maskColorIdx);
            maskColorIdx += 4;
          }
        }

        if (isGlowLayer) {
          // 创建发光边框
          const glowSize = 0.4;
          const glowWidth = (glowSize / this.IMAGE_WIDTH) * 2;
          const glowHeight = (glowSize / this.IMAGE_HEIGHT) * 2;

          // 计算发光边框内边界
          const glowInnerLeft = left + glowWidth;
          const glowInnerRight = right - glowWidth;
          const glowInnerTop = top + glowHeight;
          const glowInnerBottom = bottom - glowHeight;

          // 发光边框顶点数据
          const glowVerts = [
            // 上边框
            left,
            top,
            right,
            top,
            left,
            glowInnerTop,
            right,
            top,
            right,
            glowInnerTop,
            left,
            glowInnerTop,
            // 右边框
            right,
            top,
            right,
            bottom,
            glowInnerRight,
            top,
            right,
            bottom,
            glowInnerRight,
            bottom,
            glowInnerRight,
            top,
            // 下边框
            left,
            bottom,
            right,
            bottom,
            left,
            glowInnerBottom,
            right,
            bottom,
            right,
            glowInnerBottom,
            left,
            glowInnerBottom,
            // 左边框
            left,
            top,
            left,
            bottom,
            glowInnerLeft,
            top,
            left,
            bottom,
            glowInnerLeft,
            bottom,
            glowInnerLeft,
            top,
          ];

          glowPositions.set(glowVerts, glowPosIdx);
          glowPosIdx += glowVerts.length;

          // 设置发光颜色(浅黄色半透明)
          for (let i = 0; i < this.GLOW_VERTICES; i++) {
            glowColors.set(glowColor, glowColorIdx);
            glowColorIdx += 4;
          }
        }
      }
    }

    // 返回计算结果
    return {
      rectPositions: positions,
      rectColors: colors,
      borderPositions,
      borderColors,
      maskPositions,
      maskColors,
      glowPositions,
      glowColors,
      rectCount: rectPosIdx / 2,
      borderCount: borderPosIdx / 2,
      maskCount: maskPosIdx / 2,
      glowCount: glowPosIdx / 2,
    };
  }
  /**
   * 绘制die信息（WebGL，按图层 + 数据分块渲染）
   * WebGL 上下文与着色器跨绘制复用（渲染队列保证同一实例的绘制串行），
   * 空闲 WEBGL_IDLE_RELEASE_MS 后自动释放，避免多实例长期占用浏览器上下文配额。
   */
  private acquireWebglResources(
    width: number,
    height: number,
  ): { canvas: HTMLCanvasElement; gl: WebGLRenderingContext; program: WebGLProgram } | null {
    if (this.destroyed) return null;
    if (this.webglReleaseTimer) {
      clearTimeout(this.webglReleaseTimer);
      this.webglReleaseTimer = null;
    }
    if (
      !this.webglCanvasCache ||
      !this.webglCtxCache ||
      !this.webglProgramCache
    ) {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl', {
        antialias: true,
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true, // 跨任务分批绘制时保留已完成批次
      }) as null | WebGLRenderingContext;
      if (!gl) {
        canvas.remove();
        return null;
      }
      const program = this.createShaderProgram(gl);
      // 上下文被浏览器回收（标签页挂起、GPU 重置等）时丢弃缓存，下次绘制重建
      canvas.addEventListener(
        'webglcontextlost',
        () => {
          this.webglCanvasCache = null;
          this.webglCtxCache = null;
          this.webglProgramCache = null;
        },
        { once: true },
      );
      this.webglCanvasCache = canvas;
      this.webglCtxCache = gl;
      this.webglProgramCache = program;
    }
    const canvas = this.webglCanvasCache;
    // 重设画布尺寸会重置绘制缓冲，上下文与已编译 program 保留
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return {
      canvas,
      gl: this.webglCtxCache,
      program: this.webglProgramCache,
    };
  }

  private scheduleWebglRelease() {
    if (!this.webglCanvasCache || this.destroyed) return;
    if (this.webglReleaseTimer) clearTimeout(this.webglReleaseTimer);
    this.webglReleaseTimer = setTimeout(() => {
      this.webglReleaseTimer = null;
      this.releaseWebglResources();
    }, WaferWidget.WEBGL_IDLE_RELEASE_MS);
  }

  private releaseWebglResources() {
    if (this.webglReleaseTimer) {
      clearTimeout(this.webglReleaseTimer);
      this.webglReleaseTimer = null;
    }
    if (this.webglCtxCache) {
      try {
        this.webglCtxCache.getExtension('WEBGL_lose_context')?.loseContext();
      } catch {
        // 上下文可能已被浏览器回收
      }
    }
    if (this.webglCanvasCache) {
      this.webglCanvasCache.width = 0;
      this.webglCanvasCache.height = 0;
      this.webglCanvasCache.remove();
    }
    this.webglCanvasCache = null;
    this.webglCtxCache = null;
    this.webglProgramCache = null;
  }

  private async drawDie(signal?: AbortSignal) {
    throwIfRenderAborted(signal);
    if (this.waferCanvas && this.basicConfig.wmConfig?.visible) {
      const cached = this.acquireWebglResources(
        this.waferCanvas.width,
        this.waferCanvas.height,
      );
      if (!cached) {
        console.warn(
          `Unable to create WebGL context for ${this.waferCanvas.width}x${this.waferCanvas.height} wafer canvas.`,
        );
        return;
      }
      const offscreenWebglCanvas = cached.canvas;
      const gl = cached.gl;
      // 同一次绘制内配置不变，颜色 memo 跨 chunk 复用
      this.heatmapColorMemo = new Map();

      try {
        // 1. 初始化基础设置
        const cellSize = this.calculateCellSize();
        const shaderProgram = cached.program;

        // 设置WebGL基础状态
        gl.useProgram(shaderProgram);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        // 设置清除颜色为完全透明
        gl.clearColor(0, 0, 0, 0);
        // 清除颜色和深度缓冲区
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // 2. 绘制Die元素（如果配置可见）
        const { position } = this.basicConfig.wmConfig;
        const { dataList } = this.waferData.waferMap || {
          dataList: [] as Record<string, any>[],
        };

        // 检查必要数据是否存在
        if (position.x && position.y && dataList?.length > 0) {
          // 2.1 获取并启用着色器属性（只需设置一次）
          const aPosition = gl.getAttribLocation(shaderProgram, 'aPosition');
          const aColor = gl.getAttribLocation(shaderProgram, 'aColor');
          gl.enableVertexAttribArray(aPosition);
          gl.enableVertexAttribArray(aColor);

          // 按图层顺序分批绘制，避免一次申请超大连续 ArrayBuffer
          const { border, heatmapColorList, hightlight, shadow, transparency } =
            this.basicConfig.wmConfig;
          const gradientColorMap = generateGradientMap(
            Array.isArray(heatmapColorList) && heatmapColorList.length > 0
              ? cloneDeep(heatmapColorList).reverse()
              : ['#0000FF', '#00FF00', '#FF0000'],
            transparency / 100,
          );
          const renderLayers: WebGLRenderLayer[] = ['rect'];
          if (border || hightlight) {
            renderLayers.push('border');
          }
          if (shadow) {
            renderLayers.push('glow', 'mask');
          }

          for (const layer of renderLayers) {
            throwIfRenderAborted(signal);
            const useBlend = layer === 'glow' || layer === 'mask';
            if (useBlend) {
              gl.enable(gl.BLEND);
              gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            }

            for (
              let startIndex = 0;
              startIndex < dataList.length;
              startIndex += WEBGL_RENDER_CHUNK_SIZE
            ) {
              const endIndex = Math.min(
                startIndex + WEBGL_RENDER_CHUNK_SIZE,
                dataList.length,
              );
              throwIfRenderAborted(signal);
              const preparedData = this.prepareData(
                dataList,
                startIndex,
                endIndex,
                cellSize,
                layer,
                gradientColorMap,
              );
              let renderPositions: Float32Array;
              let renderColors: Float32Array;
              let renderCount: number;

              switch (layer) {
                case 'border': {
                  renderPositions = preparedData.borderPositions;
                  renderColors = preparedData.borderColors;
                  renderCount = preparedData.borderCount;
                  break;
                }
                case 'glow': {
                  renderPositions = preparedData.glowPositions;
                  renderColors = preparedData.glowColors;
                  renderCount = preparedData.glowCount;
                  break;
                }
                case 'mask': {
                  renderPositions = preparedData.maskPositions;
                  renderColors = preparedData.maskColors;
                  renderCount = preparedData.maskCount;
                  break;
                }
                default: {
                  renderPositions = preparedData.rectPositions;
                  renderColors = preparedData.rectColors;
                  renderCount = preparedData.rectCount;
                }
              }

              if (renderCount > 0) {
                const chunkBuffers: WebGLBuffer[] = [];
                try {
                  this.setupBuffer(gl, renderPositions, chunkBuffers);
                  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
                  this.setupBuffer(gl, renderColors, chunkBuffers);
                  gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0);
                  gl.drawArrays(gl.TRIANGLES, 0, renderCount);
                } finally {
                  this.cleanupBuffers(gl, chunkBuffers);
                }
              }

              if (endIndex < dataList.length) {
                gl.flush();
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
                throwIfRenderAborted(signal);
              }
            }

            if (useBlend) {
              gl.disable(gl.BLEND);
            }
          }
        }

        // 3. 将离屏canvas绘制到主canvas
        throwIfRenderAborted(signal);
        if (this.waferCtx) {
          gl.finish();
          this.waferCtx.drawImage(offscreenWebglCanvas, 0, 0);
        }
      } finally {
        // 复用模式：只解绑缓冲区；上下文与 program 保留给下次绘制，空闲后统一释放
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.flush();
        this.scheduleWebglRelease();
      }
    }
  }
  /** 绘制背景图片（亮度/饱和度/对比度/旋转，结果缓存） */
  private async drawBackgroundImage(signal?: AbortSignal) {
    throwIfRenderAborted(signal);
    if (!this.options.isBackgroundImage) return;
    const setting = this.basicConfig.backgroundSetting || {
      imageUrl: '',
      brightness: 100,
      saturation: 100,
      contrast: 100,
      rotate: 0,
    };
    const imageUrl =
      this.options.bgUrlField && this.waferData.waferSummary
        ? this.waferData.waferSummary[this.options.bgUrlField]
        : setting.imageUrl;
    this.backgroundParams = {
      brightness: setting.brightness || 100,
      saturation: setting.saturation || 100,
      contrast: setting.contrast || 100,
      rotate: setting.rotate || 0,
      imageUrl,
      currentImageUrl: this.backgroundParams.currentImageUrl,
    };
    if (!imageUrl) return;
    let image =
      imageUrl === this.backgroundParams.currentImageUrl
        ? this.cachedBackgroundImage
        : null;
    if (!image) {
      image = await new Promise<HTMLImageElement | null>(
        (resolve, reject) => {
          const loadedImage = new Image();
          const cleanup = () => {
            loadedImage.removeEventListener('load', loaded);
            loadedImage.removeEventListener('error', failed);
            signal?.removeEventListener('abort', cancelled);
          };
          const loaded = () => {
            cleanup();
            resolve(loadedImage);
          };
          const failed = () => {
            cleanup();
            console.warn('Failed to load background image:', imageUrl);
            resolve(null);
          };
          const cancelled = () => {
            cleanup();
            loadedImage.removeAttribute('src');
            reject(new DOMException('晶圆背景图片加载已取消', 'AbortError'));
          };
          // 先注册监听再设置地址，取消后不能迟到写回背景缓存或占住绘制队列。
          loadedImage.crossOrigin = 'anonymous';
          loadedImage.addEventListener('load', loaded, { once: true });
          loadedImage.addEventListener('error', failed, { once: true });
          signal?.addEventListener('abort', cancelled, { once: true });
          if (signal?.aborted) cancelled();
          else loadedImage.src = imageUrl;
        },
      );
      throwIfRenderAborted(signal);
      if (!image) return;
      this.backgroundParams.currentImageUrl = imageUrl;
      this.cachedBackgroundImage = image;
    }
    const readyImage = image;
    return new Promise<void>((resolve) =>
      this.drawBackgroundImageToCanvas(readyImage, resolve),
    );
  }

  /**
   * 绘制背景图片到画布
   */
  private drawBackgroundImageToCanvas(
    backgroundImage: HTMLImageElement,
    resolve: () => void,
  ) {
    if (this.waferCanvas && this.waferCtx) {
      // 保存当前上下文状态
      this.waferCtx.save();

      // 创建圆形裁剪路径（以width为直径）
      const centerX = this.waferCanvas.width / 2;
      const centerY = this.waferCanvas.height / 2;
      const radius = this.waferCanvas.width / 2;

      this.waferCtx.beginPath();
      this.waferCtx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      this.waferCtx.closePath();
      this.waferCtx.clip(); // 裁剪路径，只保留圆内区域

      // 设置滤镜效果
      this.waferCtx.filter = `brightness(${this.backgroundParams.brightness}%) saturate(${this.backgroundParams.saturation}%) contrast(${this.backgroundParams.contrast}%)`;

      // 处理旋转
      if (this.backgroundParams.rotate !== 0) {
        // 平移到中心点
        this.waferCtx.translate(centerX, centerY);

        // 旋转
        this.waferCtx.rotate((this.backgroundParams.rotate * Math.PI) / 180);

        // 平移回原点
        this.waferCtx.translate(-centerX, -centerY);
      }

      // 绘制背景图片
      this.waferCtx.drawImage(
        backgroundImage,
        0,
        0,
        this.waferCanvas.width,
        this.waferCanvas.height,
      );

      // 恢复上下文状态
      this.waferCtx.restore();
    }
    resolve();
  }
  /**
   * 绘制晶圆轮廓图（waferMap 不可见或显式开启时）
   */
  private async drawOutline() {
    const showOutline =
      this.options.isShowWaferOutline ?? !this.basicConfig.wmConfig.visible;
    if (showOutline && this.waferCanvas && this.waferCtx) {
      const { x: centerX, y: centerY } = this.centerPoint;
      const distance =
        this.gridItemWidth > this.radius
          ? this.radius / 10
          : this.gridItemWidth;
      const scaleDistance = (this.options.redueOutlineRadius || 0) * distance;
      this.waferCtx.save();
      // 绘制外圆
      this.waferCtx.beginPath();
      this.waferCtx.arc(
        centerX,
        centerY,
        this.radius - scaleDistance,
        0,
        2 * Math.PI,
      );
      this.waferCtx.stroke();
      this.waferCtx.strokeStyle = 'rgba(0, 0, 0, 1)';
      this.waferCtx.fillStyle =
        this.options.backgroundColor ?? 'rgba(255, 255, 255, 0.75)';
      this.waferCtx.fill();
      this.waferCtx.closePath();
      if (this.options.isClipByWaferOutline ?? true) {
        this.waferCtx.clip(); // 限制绘制区域为圆内
      }
    }
  }
  /** 绘制die的图例值 */
  private async drawLegendValue(signal?: AbortSignal) {
    if (
      this.waferCanvas &&
      this.waferCtx &&
      this.basicConfig.wmConfig &&
      this.basicConfig.wmConfig.visible
    ) {
      const {
        value,
        isShowLegendValue,
        label,
        position: { x, y },
      } = this.basicConfig.wmConfig;
      const { dataList } = this.waferData.waferMap || {};
      if (dataList && dataList.length > 0 && isShowLegendValue) {
        // 屏幕字体不足 6 CSS 像素时无法辨认；导出沿用原有文字规则。
        const fontSize = Math.min(20, this.gridItemWidth * 0.8);
        if (this.exportDepth === 0 && !this.canDrawScreenLegendValue(fontSize))
          return;
        const [minDieVal, maxDieVal] = this.mapHeatmapValue;
        const isHeatmap = this.isHeatmapChart;
        const isLegacyHeatmap =
          this.basicConfig.chartType === undefined &&
          this.basicConfig.wmConfig.isHeatmap === true;
        const excludedValues = new Set(this.mapLegendValues);
        const getPosition = this.createDiePositionReader();
        const isVisible = (die: Record<string, any>) => {
          if (this.mapLegendValues.length > 0) {
            return !excludedValues.has(die[value]);
          }
          if (isHeatmap) {
            if (isLegacyHeatmap) {
              const numericValue = Number(die[value]);
              return (
                Number.isFinite(numericValue) &&
                numericValue >= minDieVal &&
                numericValue <= maxDieVal
              );
            }
            let numericValue: BigNumber;
            try {
              numericValue = Big(die[value]);
            } catch {
              return false;
            }
            if (this.isHeatmapIntervalSelected(numericValue)) {
              return false;
            }
            return numericValue.gte(minDieVal) && numericValue.lte(maxDieVal);
          }
          return true;
        };
        // 在每个格子中心绘制value值
        this.waferCtx.textAlign = 'center';
        this.waferCtx.textBaseline = 'middle';
        this.waferCtx.fillStyle = '#000';
        this.waferCtx.font = `${fontSize}px Arial`;

        for (const [index, point] of dataList.entries()) {
          // 导出仍可能逐点画字，分段让出主线程并响应过期任务取消。
          if (index % 2048 === 0) {
            throwIfRenderAborted(signal);
            if (index > 0)
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
            throwIfRenderAborted(signal);
          }
          if (!point || !isVisible(point)) continue;
          const displayPosition = getPosition(point);
          if (!displayPosition) continue;
          const centerX = (displayPosition.x + 0.5) * this.gridItemWidth;
          const centerY = (displayPosition.y + 0.5) * this.gridItemHeight;
          this.waferCtx.fillText(
            String(point[label || value] ?? ''),
            centerX,
            centerY,
          );
        }
      }
    }
  }

  private canDrawScreenLegendValue(
    fontSize = Math.min(
      20,
      ((this.IMAGE_WIDTH || this.WIDTH) / this.xCount) * 0.8,
    ),
  ): boolean {
    const config = this.basicConfig.wmConfig;
    if (!config?.visible || !config.isShowLegendValue) return false;
    return fontSize * this.canvasCssScale >= 6;
  }
  // 计算格子大小
  private calculateCellSize(borderWidth: number = 1): CellSize {
    const glWidth = (this.gridItemWidth / this.IMAGE_WIDTH) * 2;
    const glHeight = (this.gridItemHeight / this.IMAGE_HEIGHT) * 2;

    // 边框在WebGL坐标系中的大小
    const borderGlWidth = (Math.max(1, borderWidth) / this.IMAGE_WIDTH) * 2;
    const borderGlHeight = (Math.max(1, borderWidth) / this.IMAGE_HEIGHT) * 2;
    return {
      width: glWidth,
      height: glHeight,
      pixelWidth: this.gridItemWidth,
      pixelHeight: this.gridItemHeight,
      borderWidth: borderGlWidth,
      borderHeight: borderGlHeight,
    };
  }

  /** 创建着色器程序（含 shader 资源释放） */
  private createShaderProgram(gl: WebGLRenderingContext): WebGLProgram {
    const vertexShader = gl.createShader(gl.VERTEX_SHADER) as WebGLShader;
    gl.shaderSource(vertexShader, this.vsSource);
    gl.compileShader(vertexShader);

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER) as WebGLShader;
    gl.shaderSource(fragmentShader, this.fsSource);
    gl.compileShader(fragmentShader);

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      throw new Error('Unable to create WebGL shader program.');
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.detachShader(program, vertexShader);
    gl.detachShader(program, fragmentShader);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return program;
  }
  /** defect 符号精灵：按 (字形, 颜色, 0.5px 档位尺寸) 预渲染成小图，fillText 换 drawImage */
  private getDefectSprite(
    glyph: string,
    color: string,
    size: number,
  ): HTMLCanvasElement | null {
    if (!Number.isFinite(size) || size <= 0) return null;
    // 尺寸量化到 0.5px 档位，避免连续缩放撑爆缓存
    const quantized = Math.max(4, Math.round(size * 2) / 2);
    const px = Math.ceil(quantized * 1.6); // 字形溢出余量
    const key = `${glyph}|${color}|${quantized}`;
    let sprite = this.defectSpriteCache.get(key);
    if (!sprite) {
      if (this.defectSpriteCache.size > 512) this.defectSpriteCache.clear();
      sprite = document.createElement('canvas');
      sprite.width = px;
      sprite.height = px;
      const spriteCtx = sprite.getContext('2d');
      if (!spriteCtx) return null;
      spriteCtx.font = `${quantized}px Arial`;
      spriteCtx.textAlign = 'center';
      spriteCtx.textBaseline = 'middle';
      spriteCtx.fillStyle = color;
      spriteCtx.fillText(glyph, px / 2, px / 2);
      this.defectSpriteCache.set(key, sprite);
    }
    return sprite;
  }

  /** 绘制缺陷信息 */
  private async drawDefect() {
    if (this.waferCanvas && this.waferCtx) {
      const { value, legendShape, legendSize, legendColor } =
        this.basicConfig.defectConfig;
      const getLegendShape = createFirstMatchingTitle(legendShape);
      const getLegendSize = createFirstMatchingTitle(legendSize);
      const { dataList } = this.waferData.defect || {
        dataList: [] as Record<string, any>[],
        legendList: [] as Record<string, any>[],
      };

      const getDefectColor = (defect: Record<string, number | string>) => {
        return (
          (this.defectLegendMap.get(defect[value]) || {})[legendColor] || 'red'
        );
      };

      // 过滤缺陷数据
      const filteredDataList = (
        (dataList as Record<string, any>[]) || []
      ).filter((defect) => {
        if (this.defectLegendValues.length > 0) {
          return !this.defectLegendValues.includes(defect[value]);
        }
        return true;
      });

      // 字体大小缩放比例以固定 1024 基准图宽计算，避免缩放时符号忽大忽小
      let scale = 1;
      if (this.IMAGE_ORIGIN_WIDTH && this.IMAGE_WIDTH) {
        scale = this.IMAGE_WIDTH / 1024;
      }
      // 预计算样式以减少重复计算
      const baseFontSize = 12 * scale;
      if (this.waferCtx) {
        this.waferCtx.save();
        this.waferCtx.textAlign = 'center'; // 水平居中
        this.waferCtx.textBaseline = 'middle'; // 垂直居中

        filteredDataList.forEach((defect) => {
          const displayPosition = this.getDefectDisplayPosition(defect);
          if (!displayPosition) return;
          const nx = displayPosition.x * this.gridItemWidth;
          const ny = displayPosition.y * this.gridItemHeight;
          const color = (getDefectColor(defect) as string) || 'black';
          const shapeSize =
            (getLegendSize(defect) as number) * scale || baseFontSize;
          if (!this.waferCtx) return;

          const shapeType = getLegendShape(defect);
          let glyph = '*';
          switch (shapeType) {
            case 'circle': {
              glyph = '◉';
              break;
            }
            case 'doji': {
              glyph = '✦';
              break;
            }
            case 'fiveStar': {
              glyph = '★';
              break;
            }
            case 'flag': {
              glyph = '⚑';
              break;
            }
            case 'rect': {
              glyph = '■';
              break;
            }
            case 'smallDot': {
              glyph = '●';
              break;
            }
            case 'triangle': {
              glyph = '▲';
              break;
            }
            case '十': {
              glyph = '+';
              break;
            }
            default: {
              glyph = '*';
              break;
            }
          }

          // 命中精灵缓存直接贴图；缓存不可用时回退 fillText
          const sprite = this.getDefectSprite(glyph, color, shapeSize);
          if (sprite) {
            const drawSize =
              Math.max(4, Math.round(shapeSize * 2) / 2) || shapeSize;
            this.waferCtx.drawImage(
              sprite,
              nx - drawSize / 2,
              ny - drawSize / 2,
              drawSize,
              drawSize,
            );
          } else {
            this.waferCtx.fillStyle = color;
            this.waferCtx.strokeStyle = color;
            this.waferCtx.font = `${shapeSize}px Arial`;
            this.waferCtx.fillText(glyph, nx, ny);
          }
        });

        this.waferCtx.restore();
      }
    }
  }

  // 根据网格数量自动计算线宽
  private calculateLineWidth() {
    // 取横向和纵向网格线数量的最大值
    const maxLines = Math.max(this.xCount, this.yCount);

    // 线宽计算逻辑：数量越多线越细，线宽在0.2px到1px之间
    const lineWidth = 0.8 / (maxLines / 2) ** 0.3;

    // 限制线宽在0.2px到1px之间
    return Math.max(0.2, Math.min(0.8, lineWidth));
  }

  // 根据线宽自动计算颜色，确保清晰可见
  private calculateLineColor(lineWidth: number) {
    // 线宽越细，颜色越深，透明度越高，确保可见性
    if (lineWidth >= 0.8) {
      return 'rgba(180, 180, 180, 0.7)'; // 粗线，较浅颜色
    } else if (lineWidth >= 0.5) {
      return 'rgba(150, 150, 150, 0.8)'; // 中等线宽
    } else if (lineWidth >= 0.3) {
      return 'rgba(120, 120, 120, 0.9)'; // 细线，较深颜色
    } else {
      return 'rgba(90, 90, 90, 0.95)'; // 极细线，深色高透明度
    }
  }
  /** 绘制网格线（Canvas 2D，自适应线宽/颜色） */
  private async drawGridLines() {
    if (this.waferCanvas && this.waferCtx && this.options.isShowGrid) {
      const lineWidth = this.calculateLineWidth();
      const lineColor = this.calculateLineColor(lineWidth);

      // 设置网格线样式
      this.waferCtx.strokeStyle = lineColor;
      this.waferCtx.lineWidth = lineWidth;

      // 绘制垂直线（纵向网格线）
      for (let i = 0; i < this.xCount; i++) {
        const x = i * this.gridItemWidth;
        // 处理半像素问题，使线条更清晰
        const adjustedX = Math.floor(x) + 0.5;
        this.waferCtx.beginPath();
        this.waferCtx.moveTo(adjustedX, 0);
        this.waferCtx.lineTo(adjustedX, this.waferCanvas.height);
        this.waferCtx.stroke();
      }

      // 绘制水平线（横向网格线）
      for (let i = 0; i < this.yCount; i++) {
        const y = i * this.gridItemHeight;
        // 处理半像素问题，使线条更清晰
        const adjustedY = Math.floor(y) + 0.5;
        this.waferCtx.beginPath();
        this.waferCtx.moveTo(0, adjustedY);
        this.waferCtx.lineTo(this.waferCanvas.width, adjustedY);
        this.waferCtx.stroke();
      }

      // 绘制边界
      this.waferCtx.strokeStyle = '#bdc3c7';
      this.waferCtx.lineWidth = 1;
      this.waferCtx.strokeRect(
        0.5,
        0.5,
        this.waferCanvas.width - 1,
        this.waferCanvas.height - 1,
      );
    }
  }
  /** 绘制Reticle */
  private async drawReticle() {
    if (
      this.waferCanvas &&
      this.waferCtx &&
      this.basicConfig.shotConfig &&
      this.basicConfig.shotConfig.visible
    ) {
      const { offsetX, offsetY, color, position } = this.basicConfig.shotConfig;
      this.waferCtx.restore();
      let minX = 0;
      let minY = 0;
      if (this.waferData.waferMap) {
        minX = this.waferData.waferMap.minX;
        minY = this.waferData.waferMap.minY;
      }
      if (this.waferData.shot && Array.isArray(this.waferData.shot.dataList)) {
        const { x, y } = position;
        this.waferData.shot.dataList.forEach((item: Record<string, any>) => {
          if (this.waferCtx) {
            const shotOffsetX = item[offsetX] || 0;
            const shotOffsetY = item[offsetY] || 0;
            const sourceX = +item[x] - minX;
            const sourceY = +item[y] - minY;
            let nx = sourceX * this.gridItemWidth;
            let ny = sourceY * this.gridItemHeight;
            let shotWidth = +shotOffsetX;
            let shotHeight = +shotOffsetY;
            if (this.coordinateCompression) {
              const rotatedRect = this.rotateShotRect(
                sourceX,
                sourceY,
                shotWidth,
                shotHeight,
              );
              const compressedX = mapWaferOverlaySpan(
                rotatedRect.x,
                rotatedRect.width,
                this.coordinateCompression.x,
              );
              const compressedY = mapWaferOverlaySpan(
                rotatedRect.y,
                rotatedRect.height,
                this.coordinateCompression.y,
              );
              if (!compressedX || !compressedY) return;
              nx = compressedX.start * this.gridItemWidth;
              ny = compressedY.start * this.gridItemHeight;
              shotWidth = compressedX.length;
              shotHeight = compressedY.length;
            }
            this.waferCtx.strokeStyle = colorToHex(color);
            this.waferCtx.lineWidth = 2;
            this.waferCtx.strokeRect(
              nx,
              ny,
              this.gridItemWidth * shotWidth,
              this.gridItemHeight * shotHeight,
            );
          }
        });
      }
    }
  }
  /** 绘制zone */
  private async drawZones() {
    if (this.waferCanvas && this.waferCtx && this.waferData.zone) {
      const maxRadius = Math.max(
        ...this.waferData.zone.dataList.map(
          (item: { maxRadius: number }) => item.maxRadius,
        ),
      );
      const radiusStep = this.radius / maxRadius;
      this.waferData.zone.dataList.forEach((item: Record<string, any>) => {
        if (this.waferCtx) {
          const startAngle = (item.minAngleDegrees * Math.PI) / 180;
          const endAngle = (item.maxAngleDegrees * Math.PI) / 180;
          this.waferCtx.beginPath();
          // 移动到圆心
          this.waferCtx.moveTo(this.centerPoint.x, this.centerPoint.y);
          // 绘制圆弧
          this.waferCtx.arc(
            this.centerPoint.x,
            this.centerPoint.y,
            item.maxRadius * radiusStep,
            startAngle,
            -endAngle,
            true,
          );
          // 闭合路径回到圆心
          this.waferCtx.closePath();

          // 可选：绘制边框
          this.waferCtx.strokeStyle = '#333';
          this.waferCtx.lineWidth = 2;
          this.waferCtx.stroke();

          // 计算扇形中心角度（中点）
          const centerAngle = (item.minAngleDegrees + item.maxAngleDegrees) / 2;
          const centerRad = -(centerAngle * Math.PI) / 180;
          // 计算中心点坐标（稍微向内偏移）
          const labelRadius =
            ((item.maxRadius - item.minRadius) / 2 + item.minRadius) *
            radiusStep; // 标签位置半径
          const centerX =
            this.centerPoint.x + labelRadius * Math.cos(centerRad);
          const centerY =
            this.centerPoint.y + labelRadius * Math.sin(centerRad);

          // 绘制序号标签
          this.waferCtx.beginPath();
          this.waferCtx.arc(centerX, centerY, 15, 0, Math.PI * 2);
          this.waferCtx.fillStyle = 'white';
          this.waferCtx.fill();
          this.waferCtx.strokeStyle = '#333';
          this.waferCtx.stroke();

          this.waferCtx.font = 'bold 14px Arial';
          this.waferCtx.fillStyle = '#333';
          this.waferCtx.textAlign = 'center';
          this.waferCtx.textBaseline = 'middle';
          this.waferCtx.fillText(item.zoneNo, centerX, centerY);
        }
      });
    }
  }
  /** 绘制WaferSummary信息 */
  private async drawWaferSummaryInfo() {
    if (
      this.waferCanvas &&
      this.waferCtx &&
      this.basicConfig.wsConfig.visible
    ) {
      const { position, data } = this.basicConfig.wsConfig;
      const direction = ['leftBottom', 'leftTop'].includes(position)
        ? 'ltr'
        : 'rtl';
      let lineHeight = 18;
      let startX = 5;
      let startY = 18;
      switch (position) {
        case 'leftBottom': {
          startX = 5 * this.scale;
          startY = this.HEIGHT - 5 * this.scale;
          lineHeight = -18 * this.scale;
          break;
        }
        case 'leftTop': {
          startX = 5 * this.scale;
          startY = 18 * this.scale;
          lineHeight = 18 * this.scale;
          break;
        }
        case 'rightTop': {
          startX = this.WIDTH - 5 * this.scale;
          startY = 18 * this.scale;
          lineHeight = 18 * this.scale;
          break;
        }
        case 'rightBottom': {
          startX = this.WIDTH - 5 * this.scale;
          startY = this.HEIGHT - 5 * this.scale;
          lineHeight = -18 * this.scale;
        }
      }

      if (data && data.length > 0 && this.waferCtx) {
        this.waferCtx.restore();
        this.waferCtx.font = `${Math.ceil(12 * this.scale)}px Arial`;
        this.waferCtx.direction = direction;
        const waferSummary = this.waferData.waferSummary || {};
        this.waferCtx.fillStyle = '#000';
        data.forEach((item, index) => {
          if (this.waferCtx) {
            const text = `${item.title}: ${waferSummary[item.content] || ''}`;
            this.waferCtx.fillText(text, startX, startY + index * lineHeight);
          }
        });
      }
    }
  }
  /** 判断点是否在圆形区域内 */
  private isInCircle(x: number, y: number): boolean {
    const dx = x - this.centerPoint.x;
    const dy = y - this.centerPoint.y;
    const distanceSquared = dx * dx + dy * dy;
    return distanceSquared <= this.radius * this.radius;
  }

  /** 验证并调整控制点位置（确保在圆形区域内） */
  private validateAndAdjustPoints(points: ControlPoint[]) {
    const { x: CENTER_X, y: CENTER_Y } = this.centerPoint;
    const CIRCLE_RADIUS_SQUARED = this.radius * this.radius;
    this.controlPoints = points.map((point) => {
      let { x, y } = point;

      // 检查是否在圆形区域内，如果不在则调整到边界内
      const dx = x - CENTER_X;
      const dy = y - CENTER_Y;
      const distSq = dx * dx + dy * dy;

      if (distSq > CIRCLE_RADIUS_SQUARED) {
        const dist = Math.sqrt(distSq);
        const scale = (this.radius / dist) * 0.95; // 保留5%边距
        x = CENTER_X + dx * scale;
        y = CENTER_Y + dy * scale;

        // 更新相对坐标
        const relative = this.actualToRelative(x, y);
        point.originalX = relative.x;
        point.originalY = relative.y;
      }

      return {
        originalX: point.originalX,
        originalY: point.originalY,
        x,
        y,
        height: point.height,
      };
    });
  }

  /** 控制点空间分桶（约 32px 一格），供 K 近邻 IDW 逐环收集 */
  private buildContourBuckets() {
    const { width, height } = this.getCurrentCanvasSize();
    const cols = Math.max(1, Math.round(width / 32));
    const rows = Math.max(1, Math.round(height / 32));
    const cellWidth = width / cols;
    const cellHeight = height / rows;
    const buckets: ControlPoint[][] = Array.from(
      { length: cols * rows },
      () => [],
    );
    for (const cp of this.controlPoints) {
      const gx = Math.min(cols - 1, Math.max(0, Math.floor(cp.x / cellWidth)));
      const gy = Math.min(rows - 1, Math.max(0, Math.floor(cp.y / cellHeight)));
      buckets[gx + gy * cols].push(cp);
    }
    this.contourBuckets = { cellWidth, cellHeight, cols, rows, buckets };
  }

  /**
   * 使用反距离加权法计算网格点高度。
   * 控制点少时精确遍历；控制点多时改为空间分桶逐环收集近邻点（每格收满 K 个为止，
   * 至少一圈）：反距离权重随距离快速衰减，远处点贡献可忽略，近似误差肉眼不可辨，
   * 复杂度由 O(网格×控制点总数) 降为 O(网格×邻桶点数)。
   */
  private calculateContourGridPoints() {
    this.contourGridPoints = []; // 清空原有数据

    // 获取当前画布尺寸
    const canvasSize = this.getCurrentCanvasSize();
    // 计算实际的网格间距（基于当前画布尺寸）
    const actualGridItemWidth = canvasSize.width / this.CONTOUR_GRID_SIZE;
    const actualGridItemHeight = canvasSize.height / this.CONTOUR_GRID_SIZE;

    // 热循环常量缓存为局部变量；避免 for-of（转译为迭代器协议+try/finally，阻断 JIT）
    const controlPoints = this.controlPoints;
    const pointCount = controlPoints.length;
    const power = this.CONTOUR_POWER;
    // 默认幂指数 2：权重 1/d²，无需开方与乘方
    const powerIsTwo = power === 2;
    const bruteForceLimit = 2048;
    const useBuckets = pointCount > bruteForceLimit;
    if (useBuckets) {
      this.buildContourBuckets();
    }
    const bucketsRoot = this.contourBuckets;
    const bucketList = bucketsRoot ? bucketsRoot.buckets : null;
    const cols = bucketsRoot ? bucketsRoot.cols : 0;
    const rows = bucketsRoot ? bucketsRoot.rows : 0;
    const cellWidth = bucketsRoot ? bucketsRoot.cellWidth : 0;
    const cellHeight = bucketsRoot ? bucketsRoot.cellHeight : 0;
    const maxRing = Math.max(cols, rows);

    const neighborTarget = Math.min(32, pointCount);
    // 近邻缓存用平铺数值数组跨网格点复用，避免逐邻居分配对象
    const neighborDistSq: number[] = [];
    const neighborHeight: number[] = [];

    for (let col = 0; col < this.CONTOUR_GRID_SIZE; col++) {
      for (let row = 0; row < this.CONTOUR_GRID_SIZE; row++) {
        const centerX = col * actualGridItemWidth + actualGridItemWidth / 2;
        const centerY = row * actualGridItemHeight + actualGridItemHeight / 2;

        // 只处理圆形区域内的点
        if (!this.isInCircle(centerX, centerY)) continue;

        let denominator = 0;
        let numerator = 0;
        let exactHit = false;
        let neighborCount = 0;

        if (!useBuckets) {
          // 精确路径：遍历全部控制点
          for (let i = 0; i < pointCount; i++) {
            const cp = controlPoints[i];
            const dx = centerX - cp.x;
            const dy = centerY - cp.y;
            const distSq = dx * dx + dy * dy;

            // 如果距离非常近，直接使用控制点高度
            if (distSq < 0.01) {
              numerator = cp.height;
              denominator = 1;
              exactHit = true;
              break;
            }

            // 计算权重（反距离加权）
            const weight = powerIsTwo
              ? 1 / distSq
              : 1 / Math.sqrt(distSq) ** power;
            numerator += weight * cp.height;
            denominator += weight;
          }
        } else {
          // 近似路径：从中心桶逐环向外收集，凑满近邻目标数即停（至少收集一圈）
          const gx = Math.min(
            cols - 1,
            Math.max(0, Math.floor(centerX / cellWidth)),
          );
          const gy = Math.min(
            rows - 1,
            Math.max(0, Math.floor(centerY / cellHeight)),
          );
          ringLoop: for (let ring = 0; ring <= maxRing; ring++) {
            const x0 = Math.max(0, gx - ring);
            const x1 = Math.min(cols - 1, gx + ring);
            const y0 = Math.max(0, gy - ring);
            const y1 = Math.min(rows - 1, gy + ring);
            for (let bx = x0; bx <= x1; bx++) {
              for (let by = y0; by <= y1; by++) {
                // 只处理当前环新增的外圈单元格，避免重复扫描内圈
                if (
                  ring > 0 &&
                  bx !== x0 &&
                  bx !== x1 &&
                  by !== y0 &&
                  by !== y1
                ) {
                  continue;
                }
                const bucket = bucketList![bx + by * cols];
                if (bucket == null) continue;
                for (let i = 0; i < bucket.length; i++) {
                  const cp = bucket[i];
                  const dx = centerX - cp.x;
                  const dy = centerY - cp.y;
                  const distSq = dx * dx + dy * dy;
                  if (distSq < 0.01) {
                    numerator = cp.height;
                    denominator = 1;
                    exactHit = true;
                    break;
                  }
                  neighborDistSq[neighborCount] = distSq;
                  neighborHeight[neighborCount] = cp.height;
                  neighborCount++;
                }
                if (exactHit) break;
              }
              if (exactHit) break;
            }
            if (exactHit) break;
            // 至少收集一圈（3×3 桶），避免单桶结果造成块状不连续
            if (neighborCount >= neighborTarget && ring >= 1) {
              break ringLoop;
            }
          }
          if (!exactHit) {
            for (let i = 0; i < neighborCount; i++) {
              const distSq = neighborDistSq[i];
              const weight = powerIsTwo
                ? 1 / distSq
                : 1 / Math.sqrt(distSq) ** power;
              numerator += weight * neighborHeight[i];
              denominator += weight;
            }
          }
        }

        const heightValue =
          exactHit || denominator > 0 ? numerator / denominator : 0;

        // 添加网格点到数组
        this.contourGridPoints.push({
          x: centerX,
          y: centerY,
          height: heightValue,
          col,
          row,
        });
      }
    }
    this.contourFieldDirty = false;
  }

  /**
   * 画布尺寸变化时按行列索引重排网格点坐标。
   * IDW 权重只依赖距离间的比值，整体缩放不变，因此高度场可跨缩放复用。
   */
  private repositionContourGridPoints() {
    const canvasSize = this.getCurrentCanvasSize();
    const actualGridItemWidth = canvasSize.width / this.CONTOUR_GRID_SIZE;
    const actualGridItemHeight = canvasSize.height / this.CONTOUR_GRID_SIZE;
    for (const point of this.contourGridPoints) {
      point.x = point.col * actualGridItemWidth + actualGridItemWidth / 2;
      point.y = point.row * actualGridItemHeight + actualGridItemHeight / 2;
    }
  }

  /**
   * 根据归一化高度获取颜色
   */
  private getColorForHeight(normalized: number) {
    if (normalized < 0.25) {
      const intensity = Math.floor(50 + normalized * 200);
      return `rgb(26, 58, ${intensity})`;
    } else if (normalized < 0.5) {
      const intensity = Math.floor(100 + (normalized - 0.25) * 400);
      return `rgb(26, ${intensity}, 255)`;
    } else if (normalized < 0.75) {
      const intensity = Math.floor(100 + (normalized - 0.5) * 620);
      return `rgb(${intensity}, 201, 240)`;
    } else {
      const intensity = Math.floor(200 + (normalized - 0.75) * 220);
      return `rgb(247, 37, ${intensity})`;
    }
  }

  /** 绘制高度图（颜色渐变部分） */
  private drawHeightMap() {
    if (this.offscreenCtx && this.contourGridPoints.length > 0) {
      const canvasSize = this.getCurrentCanvasSize();
      const actualGridItemWidth = canvasSize.width / this.CONTOUR_GRID_SIZE;
      const actualGridItemHeight = canvasSize.height / this.CONTOUR_GRID_SIZE;

      for (const point of this.contourGridPoints) {
        const x = point.col * actualGridItemWidth;
        const y = point.row * actualGridItemHeight;

        // 计算归一化高度并获取对应颜色
        const normalized = Math.min(
          Math.max(
            (point.height - this.CONTORU_MIN_HEIGHT) /
              (this.CONTORU_MAX_HEIGHT - this.CONTORU_MIN_HEIGHT || 1),
            0,
          ),
          1,
        );
        const color = this.getColorForHeight(normalized);

        this.offscreenCtx.fillStyle = color;
        this.offscreenCtx.fillRect(
          x,
          y,
          Math.ceil(actualGridItemWidth), // 确保覆盖整个单元格
          Math.ceil(actualGridItemHeight),
        );
      }
    }
  }

  /** 根据行列索引获取网格点高度 */
  private getHeightAt(col: number, row: number) {
    // 网格点按 col 外层 / row 内层顺序生成，可按索引直接定位
    const index = col * this.CONTOUR_GRID_SIZE + row;
    const point = this.contourGridPoints[index];
    if (point && point.col === col && point.row === row) {
      return point.height;
    }
    const found = this.contourGridPoints.find(
      (p) => p.col === col && p.row === row,
    );
    return found ? found.height : 0;
  }

  /** 绘制等高线 */
  private drawContourLines() {
    if (this.offscreenCtx && this.contourGridPoints.length > 0) {
      const canvasSize = this.getCurrentCanvasSize();
      const actualGridItemWidth = canvasSize.width / this.CONTOUR_GRID_SIZE;
      const actualGridItemHeight = canvasSize.height / this.CONTOUR_GRID_SIZE;

      this.offscreenCtx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      this.offscreenCtx.lineWidth = 1;
      this.offscreenCtx.beginPath();

      // 为每个等高线层级绘制
      for (let level = 1; level <= this.CONTOUR_LINES; level++) {
        const threshold =
          this.CONTORU_MIN_HEIGHT +
          (level / this.CONTOUR_LINES) *
            (this.CONTORU_MAX_HEIGHT - this.CONTORU_MIN_HEIGHT);

        // 遍历网格单元
        for (let col = 0; col < this.CONTOUR_GRID_SIZE - 1; col++) {
          for (let row = 0; row < this.CONTOUR_GRID_SIZE - 1; row++) {
            // 获取当前单元的中心坐标，用于圆形区域判断
            const centerX = col * actualGridItemWidth + actualGridItemWidth / 2;
            const centerY =
              row * actualGridItemHeight + actualGridItemHeight / 2;

            // 只处理圆形区域内的单元
            if (!this.isInCircle(centerX, centerY)) continue;

            // 获取四个角的高度值
            const h1 = this.getHeightAt(col, row);
            const h2 = this.getHeightAt(col + 1, row);
            const h3 = this.getHeightAt(col + 1, row + 1);
            const h4 = this.getHeightAt(col, row + 1);

            // 收集等高线与单元边界的交点
            const edges: Point[] = [];

            // 检查每条边是否有等高线穿过
            if (h1 < threshold !== h2 < threshold) {
              const t = (threshold - h1) / (h2 - h1);
              edges.push({
                x: col * actualGridItemWidth + t * actualGridItemWidth,
                y: row * actualGridItemHeight,
              });
            }
            if (h2 < threshold !== h3 < threshold) {
              const t = (threshold - h2) / (h3 - h2);
              edges.push({
                x: (col + 1) * actualGridItemWidth,
                y: row * actualGridItemHeight + t * actualGridItemHeight,
              });
            }
            if (h3 < threshold !== h4 < threshold) {
              const t = (threshold - h3) / (h4 - h3);
              edges.push({
                x: (col + 1) * actualGridItemWidth - t * actualGridItemWidth,
                y: (row + 1) * actualGridItemHeight,
              });
            }
            if (h4 < threshold !== h1 < threshold) {
              const t = (threshold - h4) / (h1 - h4);
              edges.push({
                x: col * actualGridItemWidth,
                y: (row + 1) * actualGridItemHeight - t * actualGridItemHeight,
              });
            }

            // 如果有两个交点，绘制线段
            if (edges.length === 2 && edges[0] && edges[1]) {
              this.offscreenCtx.moveTo(edges[0].x, edges[0].y);
              this.offscreenCtx.lineTo(edges[1].x, edges[1].y);
            }
          }
        }
      }
      this.offscreenCtx.stroke();
    }
  }

  /** 绘制控制点（大数据量时抽样显示且省略高度标签） */
  private drawControlPoints() {
    if (this.offscreenCtx) {
      this.offscreenCtx.fillStyle = '#ffd700';
      this.offscreenCtx.strokeStyle = '#000';
      this.offscreenCtx.lineWidth = 1;

      // 控制点成千上万时逐点画圆与文字既慢也失去可读性：抽样显示、隐藏标签
      const total = this.controlPoints.length;
      const step = Math.max(1, Math.ceil(total / 2000));
      const showLabel = total <= 200;
      for (let i = 0; i < total; i += step) {
        const point = this.controlPoints[i];
        if (!point || !this.isInCircle(point.x, point.y)) continue;
        // 绘制控制点
        this.offscreenCtx.beginPath();
        this.offscreenCtx.arc(
          point.x,
          point.y,
          this.CONTOUR_POINT_SIZE,
          0,
          Math.PI * 2,
        );
        this.offscreenCtx.fill();
        this.offscreenCtx.stroke();

        if (showLabel) {
          // 绘制高度标签
          this.offscreenCtx.fillStyle = '#fff';
          this.offscreenCtx.font = '12px Arial';
          this.offscreenCtx.textAlign = 'center';
          this.offscreenCtx.fillText(
            formatNumber(point.height, { decimals: 2 }),
            point.x,
            point.y - this.CONTOUR_POINT_SIZE - 5,
          );
          this.offscreenCtx.fillStyle = '#ffd700';
        }
      }
    }
  }

  /** 绘制圆形边界和中心点 */
  private drawCircleBoundary() {
    if (this.offscreenCtx) {
      const { x, y } = this.centerPoint;
      // 圆形边界
      this.offscreenCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      this.offscreenCtx.lineWidth = 2;
      this.offscreenCtx.beginPath();
      this.offscreenCtx.arc(x, y, this.radius, 0, Math.PI * 2);
      this.offscreenCtx.stroke();

      // 中心点
      this.offscreenCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      this.offscreenCtx.beginPath();
      this.offscreenCtx.arc(x, y, 3, 0, Math.PI * 2);
      this.offscreenCtx.fill();
    }
  }

  /** 绘制等高线图 */
  private async drawContourMap() {
    if (
      this.waferCanvas &&
      this.waferCtx &&
      this.offScreen &&
      this.offscreenCtx
    ) {
      // 数据与配置未变时复用控制点集与高度场（重建是 O(n) 的全量 map，大数据下是主要耗时）
      if (!this.contourFieldDirty && this.contourGridPoints.length > 0) {
        this.updateControlPointsActualCoords();
        this.repositionContourGridPoints();
        this.drawContourMapLayers();
        return;
      }
      if (this.CONTOUR_DIMENSION === 'die') {
        if (this.basicConfig.wmConfig.visible && this.waferData.waferMap) {
          const {
            value: dieValue,
            position: { x: xUI, y: yUI },
          } = this.options.basicConfig.wmConfig;
          const waferMap = this.waferData.waferMap;
          const originalTestPoints = waferMap.dataList
            .map((item) => ({
              relativeX: linearMap(
                item[`_o_${xUI}`],
                waferMap.minX,
                waferMap.maxX,
                0,
                1,
              ),
              relativeY: linearMap(
                item[`_o_${yUI}`],
                waferMap.minY,
                waferMap.maxY,
                0,
                1,
              ),
              height: item[dieValue],
            }))
            .filter(
              (item) =>
                Number.isFinite(item.relativeX) &&
                Number.isFinite(item.relativeY) &&
                Number.isFinite(Number(item.height)),
            );
          if (waferMap.minValue === waferMap.maxValue) {
            this.CONTORU_MIN_HEIGHT = waferMap.minValue;
            this.CONTORU_MAX_HEIGHT = waferMap.maxValue + 1;
          } else {
            this.CONTORU_MIN_HEIGHT = waferMap.minValue;
            this.CONTORU_MAX_HEIGHT = waferMap.maxValue;
          }

          // 转换到当前画布坐标
          const convertedPoints = originalTestPoints.map((point) => {
            const actual = this.relativeToActual(
              point.relativeX,
              point.relativeY,
            );
            return {
              originalX: point.relativeX,
              originalY: point.relativeY,
              x: actual.x,
              y: actual.y,
              height: point.height,
            };
          });

          this.validateAndAdjustPoints(convertedPoints);
        } else {
          this.controlPoints = [];
        }
      } else {
        if (this.basicConfig.defectConfig.visible && this.waferData.defect) {
          const {
            value: defectValue,
            position: { x: xUI, y: yUI },
          } = this.options.basicConfig.defectConfig;
          const defect = this.waferData.defect;
          const originalTestPoints = defect.dataList
            .map((item) => ({
              relativeX: linearMap(
                item[`_o_${xUI}`],
                defect.minX,
                defect.maxX,
                0,
                1,
              ),
              relativeY: linearMap(
                item[`_o_${yUI}`],
                defect.minY,
                defect.maxY,
                0,
                1,
              ),
              height: item[defectValue],
            }))
            .filter(
              (item) =>
                Number.isFinite(item.relativeX) &&
                Number.isFinite(item.relativeY) &&
                Number.isFinite(Number(item.height)),
            );

          // 转换到当前画布坐标
          const convertedPoints = originalTestPoints.map((point) => {
            const actual = this.relativeToActual(
              point.relativeX,
              point.relativeY,
            );
            return {
              originalX: point.relativeX,
              originalY: point.relativeY,
              x: actual.x,
              y: actual.y,
              height: point.height,
            };
          });
          this.validateAndAdjustPoints(convertedPoints);
          const minValue = defect.minValue ?? 0;
          const maxValue = defect.maxValue ?? 1;
          if (minValue === maxValue) {
            this.CONTORU_MIN_HEIGHT = minValue;
            this.CONTORU_MAX_HEIGHT = maxValue + 1;
          } else {
            this.CONTORU_MIN_HEIGHT = minValue;
            this.CONTORU_MAX_HEIGHT = maxValue;
          }
        } else {
          this.controlPoints = [];
        }
      }

      // 更新控制点的实际坐标（确保使用当前画布尺寸）
      this.updateControlPointsActualCoords();

      // 数据/配置已变化：重建高度场
      this.calculateContourGridPoints();
      this.drawContourMapLayers();
    }
  }

  /** 等高线图层绘制（高度场已就绪，纯画布操作） */
  private drawContourMapLayers() {
    if (
      !this.waferCanvas ||
      !this.waferCtx ||
      !this.offScreen ||
      !this.offscreenCtx
    ) {
      return;
    }
    // 确保离屏画布尺寸与当前画布尺寸一致
    const canvasSize = this.getCurrentCanvasSize();
      this.offScreen.width = canvasSize.width;
      this.offScreen.height = canvasSize.height;

      // 清空主画布
      this.waferCtx.clearRect(
        0,
        0,
        this.waferCanvas.width,
        this.waferCanvas.height,
      );

      // 清空离屏画布
      this.offscreenCtx.clearRect(
        0,
        0,
        this.offScreen.width,
        this.offScreen.height,
      );

      // 绘制背景
      this.offscreenCtx.fillStyle = '#0a1931';
      this.offscreenCtx.fillRect(
        0,
        0,
        this.offScreen.width,
        this.offScreen.height,
      );

      // 绘制高度图（颜色渐变）
      this.drawHeightMap();

      // 绘制等高线
      this.drawContourLines();

      // 绘制控制点
      this.drawControlPoints();

      // 绘制圆形边界
      this.drawCircleBoundary();

      // 先保存主画布状态
      this.waferCtx.save();

      // 创建圆形裁剪路径（使用主画布的坐标系）
      this.waferCtx.beginPath();
      this.waferCtx.arc(
        this.centerPoint.x,
        this.centerPoint.y,
        this.radius,
        0,
        Math.PI * 2,
      );
      this.waferCtx.clip();

      // 将离屏Canvas内容绘制到主Canvas的正确位置
      this.waferCtx.drawImage(
        this.offScreen,
        0,
        0,
        this.offScreen.width,
        this.offScreen.height,
        0,
        0,
        this.waferCanvas.width,
        this.waferCanvas.height,
      );

      this.waferCtx.restore();

      // 绘制圆形边界（确保边界清晰）
      this.waferCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      this.waferCtx.lineWidth = 2;
      this.waferCtx.beginPath();
      this.waferCtx.arc(
        this.centerPoint.x,
        this.centerPoint.y,
        this.radius,
        0,
        Math.PI * 2,
      );
      this.waferCtx.stroke();
  }

  /* ---------- 公开 API ---------- */

  /** 重绘（含等高线配置、热力图区间、图例映射刷新） */
  redraw() {
    this.updateContourmanConfig();
    this.updateHeatmapValue();
    this.updateDieLegend();
    this.updateDefectLegend();
    this.drawWafer();
  }

  async updateOption(option: WaferWidgetOptions) {
    merge(this.options, option);
    this.compressEmptyRowsColumns = Boolean(
      this.options.basicConfig.compressEmptyRowsColumns,
    );
    // 配置合并可能改变坐标字段 / 图层可见性 / 等高线参数
    this.markCoordinateCompressionDirty();
    this.contourFieldDirty = true;
    this.drawWafer();
    return this.options;
  }

  /** 更新等高线图相关配置 */
  updateContourmanConfig() {
    const config = this.basicConfig.contourMapConfig;
    if (!config) return;
    const nextMin = config.valueRange?.[0] ?? this.CONTORU_MIN_HEIGHT;
    const nextMax = config.valueRange?.[1] ?? this.CONTORU_MAX_HEIGHT;
    // redraw 也会走到这里：配置未变化时不作废已缓存的高度场
    const changed =
      this.CONTOUR_DIMENSION !== config.dimension ||
      this.CONTOUR_POWER !== config.power ||
      this.CONTOUR_LINES !== config.lines ||
      this.CONTOUR_POINT_SIZE !== config.size ||
      this.CONTOUR_GRID_SIZE !== config.gridSize ||
      this.CONTORU_MIN_HEIGHT !== nextMin ||
      this.CONTORU_MAX_HEIGHT !== nextMax;
    this.CONTOUR_DIMENSION = config.dimension ?? this.CONTOUR_DIMENSION;
    this.CONTOUR_POWER = config.power ?? this.CONTOUR_POWER;
    this.CONTORU_MIN_HEIGHT = nextMin;
    this.CONTORU_MAX_HEIGHT = nextMax;
    this.CONTOUR_LINES = config.lines ?? this.CONTOUR_LINES;
    this.CONTOUR_POINT_SIZE = config.size ?? this.CONTOUR_POINT_SIZE;
    this.CONTOUR_GRID_SIZE = config.gridSize ?? this.CONTOUR_GRID_SIZE;
    if (changed) {
      this.contourFieldDirty = true;
    }
  }

  /** 设置热力图初始值（来自数据的 heatmapMinValue/heatmapMaxValue） */
  updateHeatmapValue() {
    if (this.isHeatmapChart && this.waferData.waferMap) {
      const { heatmapMinValue, heatmapMaxValue } = this.waferData.waferMap;
      if (
        !this.hasHeatmapRangeOverride &&
        heatmapMinValue !== undefined &&
        heatmapMaxValue !== undefined
      ) {
        this.mapHeatmapValue = [heatmapMinValue, heatmapMaxValue];
      }
      if (!this.hasHeatmapRangeOverride) {
        this.heatmapColorRange = [
          heatmapMinValue ?? this.waferData.waferMap.minValue,
          heatmapMaxValue ?? this.waferData.waferMap.maxValue,
        ];
      }
    }
  }

  /** 更新die图例映射对象 */
  updateDieLegend(legendList?: Record<string, any>[]) {
    const { legendValue, legendColor, transparency } =
      this.basicConfig.wmConfig;
    if (this.waferData.waferMap) {
      if (legendList !== undefined) {
        this.waferData.waferMap.legendList = legendList;
      }
      this.dieLegendMap.clear();
      for (const legend of this.waferData.waferMap.legendList) {
        // 绘制die的时候需要把颜色代码转成webgl专用格式
        legend[`_o_${legendColor}`] = hexToWebGLColor(
          legend[legendColor],
          transparency / 100,
        );
        this.dieLegendMap.set(legend[legendValue], legend);
      }
    }
    if (legendList !== undefined) {
      this.redraw();
    }
  }

  /** 更新defect图例映射对象 */
  updateDefectLegend(legendList?: Record<string, any>[]) {
    const { legendValue } = this.basicConfig.defectConfig;
    if (this.waferData.defect) {
      if (legendList !== undefined) {
        this.waferData.defect.legendList = legendList;
      }
      this.defectLegendMap.clear();
      for (const legend of this.waferData.defect.legendList) {
        this.defectLegendMap.set(legend[legendValue], legend);
      }
    }
    if (legendList !== undefined) {
      this.redraw();
    }
  }

  /**
   * 更新wafer图数据
   * @param waferData 数据
   * @param contextParams 上下文参数（传入时视为一次全新数据装载）
   * @param callbackFn 配置回调
   * @param isResize 是否触发画布尺寸重置
   */
  updateData(
    waferData: WaferParams,
    contextParams?: Record<string, any>,
    callbackFn?: (...args: any[]) => any,
    isResize: boolean = true,
  ) {
    this.renderVersion++;
    let shouldApplyDefaultRotate = false;
    let defaultRotate: WaferWidgetOptions['basicConfig']['defaultRotate'];
    if (contextParams && waferData.waferMap) {
      this.currentRotate = WaferRotate['Notch向下'];
      this.hasHeatmapRangeOverride = false;
      this.heatmapIntervalSelection = [];
      this.controlPoints = [];
      this.waferBoundary = {
        minX: waferData.waferMap.minX,
        maxX: waferData.waferMap.maxX,
        minY: waferData.waferMap.minY,
        maxY: waferData.waferMap.maxY,
        xCount: waferData.waferMap.xCount,
        yCount: waferData.waferMap.yCount,
        minValue: waferData.waferMap.minValue,
        maxValue: waferData.waferMap.maxValue,
      };
      defaultRotate = this.basicConfig.defaultRotate;
      if (defaultRotate && defaultRotate !== 'rotate0') {
        shouldApplyDefaultRotate = true;
      }
    }

    if (callbackFn) {
      this.options = callbackFn({
        option: this.options,
        data: waferData,
        ...contextParams,
      });
      this.compressEmptyRowsColumns = Boolean(
        this.options.basicConfig.compressEmptyRowsColumns,
      );
    }
    Object.assign(this.waferData, waferData);
    this.markCoordinateCompressionDirty();
    this.contourFieldDirty = true;
    this.rebuildCoordinateCompression();
    this.updateContourmanConfig();
    this.updateHeatmapValue();
    this.updateDieLegend();
    this.updateDefectLegend();
    if (shouldApplyDefaultRotate) {
      // setRotate 内部会再次 updateData 并触发重绘
      this.setRotate(defaultRotate as WaferRotate);
    } else if (isResize) {
      this.resize();
    }
  }

  /**
   * 更新热力图筛选区间
   * @param value [min, max]；兼容旧版单阈值 number（>= 阈值）
   */
  updateHeatmap(value: number | [number, number]) {
    this.mapHeatmapValue =
      typeof value === 'number' ? [value, Number.MAX_SAFE_INTEGER] : value;
    // 热力图范围变化只影响颜色和筛选结果，不应重新初始化画布尺寸或缩放状态
    this.drawWafer();
  }

  /** 更新区间图例中被隐藏的区间。 */
  setHeatmapIntervalSelection(intervals: HeatmapLegendInterval[]) {
    this.heatmapIntervalSelection = intervals.map((interval) => ({
      ...interval,
    }));
    this.drawWafer();
  }

  /** 更新热力图区间图例配置，并重绘离散色阶。 */
  setHeatmapLegendConfig(mode: HeatmapLegendMode, intervalCount: number) {
    this.basicConfig.wmConfig.heatmapLegendMode = mode;
    this.basicConfig.wmConfig.heatmapLegendIntervalCount = intervalCount;
    this.drawWafer();
  }

  private isHeatmapIntervalSelected(value: BigNumber) {
    return this.heatmapIntervalSelection.some((interval) => {
      const min = Big(interval.min);
      const max = Big(interval.max);
      const meetsMin = interval.includeMin ? value.gte(min) : value.gt(min);
      const meetsMax = interval.includeMax ? value.lte(max) : value.lt(max);
      return meetsMin && meetsMax;
    });
  }

  /**
   * 更新热力图颜色域，并将当前筛选范围重置为整个新域。
   */
  setHeatmapRange(value: [number, number]) {
    if (
      !Number.isFinite(value[0]) ||
      !Number.isFinite(value[1]) ||
      value[0] >= value[1]
    ) {
      return false;
    }
    this.heatmapColorRange = [...value];
    this.mapHeatmapValue = [...value];
    this.heatmapIntervalSelection = [];
    this.hasHeatmapRangeOverride = true;
    // 重新分配颜色域只需要重绘，保留当前全屏尺寸和局部放大状态
    this.drawWafer();
    return true;
  }

  getHeatmapRange(): [number, number] {
    return [...this.heatmapColorRange];
  }

  /**
   * 添加/切换图片
   * @param url 图片链接
   */
  setImage(url: string) {
    this.image.src = url;
  }

  /**
   * 设置数据
   * @param data Array
   */
  setData(data: AllShape[]) {
    setTimeout(() => {
      const initdata: AllShape[] = [];
      data.forEach((item, index) => {
        if (Object.prototype.toString.call(item).includes('Object')) {
          let shape: any;
          switch (item.type) {
            case Shape.Circle: {
              shape = new Circle(item, index);
              break;
            }
            case Shape.Dot: {
              shape = new Dot(item, index);
              break;
            }
            case Shape.Grid: {
              shape = new Grid(item, index);
              break;
            }
            case Shape.Line: {
              shape = new Line(item, index);
              break;
            }
            case Shape.Polygon: {
              shape = new Polygon(item, index);
              break;
            }
            case Shape.Rect: {
              shape = new Rect(item, index);
              break;
            }
            default: {
              console.warn('Invalid shape', item);
              break;
            }
          }
          [
            Shape.Circle,
            Shape.Dot,
            Shape.Grid,
            Shape.Line,
            Shape.Polygon,
            Shape.Rect,
          ].includes(item.type) &&
            shape &&
            initdata.push(shape);
        } else {
          console.warn('Shape must be an enumerable Object.', item);
        }
      });
      this.dataset = initdata;
      this.update();
    });
  }

  /** 设置选中的dies（按原始坐标，自动换算显示位置） */
  setSelectedDies(points: Point[]) {
    this.quickFindPoint = null;
    const { x: xField, y: yField } = this.basicConfig.wmConfig.position;
    const dataList = this.waferData.waferMap?.dataList || [];
    const initdata: AllShape[] = [];
    points.forEach((point, index) => {
      const targetDie = dataList.find(
        (die) =>
          Number(die[xField]) === Number(point.x) &&
          Number(die[yField]) === Number(point.y),
      );
      const displayPosition = targetDie
        ? this.getDieDisplayPosition(targetDie)
        : null;
      if (displayPosition) {
        initdata.push(
          new ClickSelect(
            { coor: [displayPosition.x, displayPosition.y] },
            index,
          ),
        );
      }
    });
    this.dataset = initdata;
    this.update();
  }

  /** 获取当前点选的 die 原始坐标集合 */
  getSelectedDieCoordinates(): Point[] {
    const selectedKeys = new Set<string>();
    for (const points of this.getMarksPoints()) {
      for (const [x, y] of points) {
        selectedKeys.add(`${x}_${y}`);
      }
    }
    const { x: xField, y: yField } = this.basicConfig.wmConfig.position;
    const result: Point[] = [];
    for (const die of this.waferData.waferMap?.dataList || []) {
      const displayPosition = this.getDieDisplayPosition(die);
      if (
        !displayPosition ||
        !selectedKeys.has(`${displayPosition.x}_${displayPosition.y}`)
      ) {
        continue;
      }
      result.push({ x: Number(die[xField]), y: Number(die[yField]) });
    }
    return result;
  }

  /**
   * 判断是否在标注实例上
   * @param mousePoint 点击位置
   */
  hitOnShape(mousePoint: Point): [number, AllShape] {
    let hitShapeIndex = -1;
    let hitShape: any;
    for (let i = this.dataset.length - 1; i > -1; i--) {
      const shape = this.dataset[i];
      if (shape) {
        if (shape.hide) continue;
        if (
          (shape.type === Shape.Dot &&
            this.isPointInCircle(
              mousePoint,
              shape.coor as NumberTuple,
              this.ctrlRadius,
            )) ||
          (shape.type === Shape.Circle &&
            this.isPointInCircle(
              mousePoint,
              shape.coor as NumberTuple,
              (shape as Circle).radius * this.scale,
            )) ||
          (shape.type === Shape.Rect &&
            this.isPointInRect(mousePoint, (shape as Rect).coor)) ||
          (shape.type === Shape.Polygon &&
            this.isPointInPolygon(mousePoint, (shape as Polygon).coor)) ||
          (shape.type === Shape.Grid &&
            this.isPointInRect(mousePoint, (shape as Grid).coor))
        ) {
          if (this.focusMode && !shape.active) continue;
          hitShapeIndex = i;
          hitShape = shape;
          break;
        }
      }
    }
    return [hitShapeIndex, hitShape];
  }

  /** 判断是否在矩形内 */
  isPointInRect(point: Point, coor: NumberTuple[]): boolean {
    const { x, y } = point;
    // @ts-ignore
    const [[x0, y0], [x1, y1]] = coor.map((a) => a.map((b) => b * this.scale));
    return (
      x0 + this.origin.x <= x &&
      x <= x1 + this.origin.x &&
      y0 + this.origin.y <= y &&
      y <= y1 + this.origin.y
    );
  }

  /** 判断是否在多边形内 */
  isPointInPolygon(point: Point, polygon: NumberTuple[]) {
    const { x, y } = {
      x: (point.x - this.origin.x) / this.scale,
      y: (point.y - this.origin.y) / this.scale,
    };
    let inside = false;
    if (polygon.length > 2) {
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = (polygon[i] as NumberTuple)[0];
        const yi = (polygon[i] as NumberTuple)[1];
        const xj = (polygon[j] as NumberTuple)[0];
        const yj = (polygon[j] as NumberTuple)[1];

        const intersect =
          yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
      }
    }
    return inside;
  }

  /**
   * 判断是否在圆内
   */
  isPointInCircle(point: Point, center: NumberTuple, r: number): boolean {
    const { x, y } = point;
    const [x0, y0] = center.map((a) => a * this.scale);
    // @ts-ignore
    const distance = Math.hypot(x0 + this.origin.x - x, y0 + this.origin.y - y);
    return distance <= r;
  }

  /** 判断是否在折线上 */
  isPointInLine(point: Point, coor: NumberTuple[]): boolean {
    if (!this.offscreenCtx) return false;
    this.offscreenCtx.save();
    this.offscreenCtx.clearRect(0, 0, this.WIDTH, this.HEIGHT);
    this.offscreenCtx.translate(this.origin.x, this.origin.y);
    this.offscreenCtx.lineWidth = Math.max(this.lineWidth, 5);
    this.offscreenCtx.beginPath();
    coor.forEach((pt, i) => {
      const [x, y] = pt.map((a) => Math.round(a * this.scale));
      if (x !== undefined && y !== undefined) {
        if (i === 0) {
          this.offscreenCtx?.moveTo(x, y);
        } else {
          this.offscreenCtx?.lineTo(x, y);
        }
      }
    });
    this.offscreenCtx.stroke();
    const areaData = this.offscreenCtx.getImageData(
      0,
      0,
      this.WIDTH,
      this.HEIGHT,
    );
    const index = (point.y - 1) * this.WIDTH * 4 + point.x * 4;
    this.offscreenCtx.restore();
    return areaData.data[index + 3] !== 0;
  }

  /**
   * 更新画布（返回 Promise 供导出流程等待真实提交）
   */
  update(image?: CanvasImageSource | null): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (this.renderingPaused && this.exportDepth === 0) {
      this.viewUpdatePending = true;
      this.pendingViewImage = image;
      return Promise.resolve();
    }
    this.viewUpdatePending = false;
    this.pendingViewImage = undefined;
    window.cancelAnimationFrame(this.timer);
    this.updateResolve?.();
    this.updateTask = new Promise<void>((resolve) => {
      this.updateResolve = resolve;
      this.timer = window.requestAnimationFrame(() => {
        if (!this.ctx) {
          this.updateResolve = null;
          resolve();
          return;
        }
        this.ctx.save();
        try {
          this.ctx.clearRect(0, 0, this.WIDTH, this.HEIGHT);
          const {
            scale: viewScale,
            offsetX,
            offsetY,
          } = this.localZoomTransform;
          this.ctx.translate(offsetX, offsetY);
          this.ctx.scale(viewScale, viewScale);
          this.ctx.translate(this.origin.x, this.origin.y);
          if (this.IMAGE_WIDTH && this.IMAGE_HEIGHT) {
            if (image) {
              this.ctx.drawImage(
                image,
                0,
                0,
                this.IMAGE_WIDTH,
                this.IMAGE_HEIGHT,
              );
            } else if (this.scale === 1) {
              this.ctx.drawImage(
                this.image,
                0,
                0,
                this.IMAGE_WIDTH,
                this.IMAGE_HEIGHT,
              );
            } else {
              this.ctx.drawImage(
                this.waferCanvas as CanvasImageSource,
                0,
                0,
                this.IMAGE_WIDTH,
                this.IMAGE_HEIGHT,
              );
            }
          }
          const currDataset = this.activeShape.type ? [this.activeShape] : [];
          const renderList = this.focusMode ? currDataset : this.dataset;
          for (const shape of renderList) {
            if (shape.hide) continue;
            switch (shape.type) {
              case Shape.Circle: {
                this.drawCircle(shape as Circle);
                break;
              }
              case Shape.ClickSelect: {
                this.drawClickSelect(shape as ClickSelect);
                break;
              }
              case Shape.Dot: {
                this.drawDot(shape as Dot);
                break;
              }
              case Shape.Grid: {
                this.drawGrid(shape as Grid);
                break;
              }
              case Shape.Line: {
                this.drawLine(shape as Line);
                break;
              }
              case Shape.Polygon: {
                this.drawPolygon(shape as Polygon);
                break;
              }
              case Shape.QuickFind: {
                this.drawQuickFind(shape as QuickFind);
                break;
              }
              case Shape.Rect: {
                this.drawRect(shape as Rect);
                break;
              }
              default: {
                break;
              }
            }
          }
          if (
            [
              Shape.Circle,
              Shape.Grid,
              Shape.Line,
              Shape.Polygon,
              Shape.Rect,
            ].includes(this.activeShape.type) &&
            !this.activeShape.hide
          ) {
            this.drawCtrlList(this.activeShape);
          }
          this.emit('updated', this.dataset);
        } finally {
          this.ctx.restore();
          this.drawLocalZoomSelection();
          this.drawClickSelectSelection();
          this.updateResolve = null;
          resolve();
        }
      });
    });
    return this.updateTask;
  }

  /**
   * 删除指定矩形
   * @param index number
   */
  deleteByIndex(index: number) {
    const num = this.dataset.findIndex((x) => x.index === index);
    if (num !== -1) {
      this.emit('delete', this.dataset[num]);
      this.dataset.splice(num, 1);
      this.dataset.forEach((item, i) => {
        item.index = i;
      });
      this.update();
    }
  }

  /**
   * 计算缩放步长（迭代实现，避免深递归）
   */
  calcStep(flag = '') {
    if (this.WIDTH <= 0 || this.HEIGHT <= 0) {
      return;
    }
    let direction = flag;
    if (!direction) {
      if (this.IMAGE_WIDTH < this.WIDTH && this.IMAGE_HEIGHT < this.HEIGHT) {
        direction = 'b';
      } else if (
        this.IMAGE_WIDTH > this.WIDTH ||
        this.IMAGE_HEIGHT > this.HEIGHT
      ) {
        direction = 's';
      }
    }
    if (!direction) {
      return;
    }
    for (let index = 0; index < 200; index++) {
      const shouldScale =
        direction === 'b'
          ? this.IMAGE_WIDTH < this.WIDTH && this.IMAGE_HEIGHT < this.HEIGHT
          : this.IMAGE_WIDTH > this.WIDTH || this.IMAGE_HEIGHT > this.HEIGHT;
      if (!shouldScale) {
        break;
      }
      const previousWidth = this.IMAGE_WIDTH;
      const previousHeight = this.IMAGE_HEIGHT;
      this.setScale(direction === 'b', false, true);
      if (
        previousWidth === this.IMAGE_WIDTH &&
        previousHeight === this.IMAGE_HEIGHT
      ) {
        break;
      }
    }
  }

  /**
   * 缩放
   * @param type true放大5%，false缩小5%
   * @param center 缩放中心 center|mouse
   * @param pure 不绘制
   */
  setScale(type: boolean, byMouse = false, pure = false) {
    if (this.lock) return;
    const hadReadableText = this.canDrawScreenLegendValue();
    if (type) {
      const nextScaleStep = this.scaleStep + 1;
      const nextScale =
        (nextScaleStep >= 0 ? 1.05 : 0.95) ** Math.abs(nextScaleStep);
      const nextMaxImageSize =
        Math.max(this.IMAGE_ORIGIN_WIDTH, this.IMAGE_ORIGIN_HEIGHT) * nextScale;
      if (nextMaxImageSize > getSafeWebGLRenderSize()) {
        return;
      }
    }
    if (!type && this.imageMin <= Math.min(this.WIDTH, this.HEIGHT)) return;
    // pure 用于自动适配的中间计算，仅用户缩放使导出快照失效。
    if (!pure) this.renderVersion++;

    // 保存缩放前的控制点（相对坐标）
    const originalControlPoints = this.controlPoints.map((point) => ({
      originalX: point.originalX,
      originalY: point.originalY,
      height: point.height,
    }));

    if (type) {
      this.scaleStep++;
    } else {
      this.scaleStep--;
    }

    let realToLeft = 0;
    let realToRight = 0;
    const { x, y } = this.mouse;
    // 基于鼠标所在的点进行缩放
    if (byMouse) {
      realToLeft = (x - this.origin.x) / this.scale;
      realToRight = (y - this.origin.y) / this.scale;
    }
    const abs = Math.abs(this.scaleStep);
    const width = this.IMAGE_WIDTH;
    this.IMAGE_WIDTH = Math.round(
      this.IMAGE_ORIGIN_WIDTH * (this.scaleStep >= 0 ? 1.05 : 0.95) ** abs,
    );
    this.IMAGE_HEIGHT = Math.round(
      this.IMAGE_ORIGIN_HEIGHT * (this.scaleStep >= 0 ? 1.05 : 0.95) ** abs,
    );
    if (byMouse) {
      this.origin = {
        x: x - realToLeft * this.scale,
        y: y - realToRight * this.scale,
      };
    } else {
      const scale = this.IMAGE_WIDTH / width;
      this.origin = {
        x: this.WIDTH / 2 - (this.WIDTH / 2 - this.origin.x) * scale,
        y: this.HEIGHT / 2 - (this.HEIGHT / 2 - this.origin.y) * scale,
      };
    }

    // 缩放后重新计算控制点坐标（高度场与缩放无关，网格点在下次绘制时重排）
    if (!pure && originalControlPoints.length > 0) {
      this.controlPoints = originalControlPoints.map((point) => {
        const actual = this.relativeToActual(point.originalX, point.originalY);
        return {
          originalX: point.originalX,
          originalY: point.originalY,
          x: actual.x,
          y: actual.y,
          height: point.height,
        };
      });
    }

    if (!pure) {
      this.update();
      // 不到原有两倍重绘阈值时，也要在文字可辨认状态变化后更新。
      if (hadReadableText !== this.canDrawScreenLegendValue())
        this.debounceRedrawWafer();
      if (type) {
        // 放大超过2倍才重绘
        if (this.scale >= 2) {
          this.debounceRedrawWafer();
        }
      } else {
        if (this.scale <= 2) {
          this.debounceRedrawWafer();
        }
      }
    }
  }

  /**
   * 适配背景图
   */
  fitZoom(invalidate = true) {
    // 用户还原仍需校验；内部布局适配由调用方显式排除。
    if (invalidate) this.renderVersion++;
    const hadReadableText = this.canDrawScreenLegendValue();
    const previousScale = this.scale;
    const previousWidth = this.IMAGE_WIDTH;
    const previousHeight = this.IMAGE_HEIGHT;
    this.calcStep();
    if (this.IMAGE_HEIGHT / this.IMAGE_WIDTH >= this.HEIGHT / this.WIDTH) {
      this.IMAGE_WIDTH =
        this.IMAGE_ORIGIN_WIDTH / (this.IMAGE_ORIGIN_HEIGHT / this.HEIGHT);
      this.IMAGE_HEIGHT = this.HEIGHT;
    } else {
      this.IMAGE_WIDTH = this.WIDTH;
      this.IMAGE_HEIGHT =
        this.IMAGE_ORIGIN_HEIGHT / (this.IMAGE_ORIGIN_WIDTH / this.WIDTH);
    }
    this.origin = {
      x: (this.WIDTH - this.IMAGE_WIDTH) / 2,
      y: (this.HEIGHT - this.IMAGE_HEIGHT) / 2,
    };
    if (
      (previousWidth !== this.IMAGE_WIDTH ||
        previousHeight !== this.IMAGE_HEIGHT) &&
      (previousScale >= 2 ||
        (this.exportDepth === 0 &&
          hadReadableText !== this.canDrawScreenLegendValue()))
    )
      this.debounceRedrawWafer();
    return this.update();
  }

  /**
   * 设置专注模式
   */
  setFocusMode(type: boolean) {
    this.focusMode = type;
    this.update();
  }

  /** 清除标记信息 */
  clearMarks() {
    this.dataset.splice(0);
    this.quickFindPoint = null;
    this.clickSelectStart = null;
    this.clickSelectCurrent = null;
    this.clickSelectDragging = false;
    this.update();
  }

  /** 当前标记是否全部为点选（ClickSelect） */
  hasOnlyClickSelectMarks() {
    return this.dataset.every((shape) => shape.type === Shape.ClickSelect);
  }

  /** 获取标注框内的点集合 */
  getMarksPoints(): Set<NumberTuple>[] {
    this.calcCenterPointAndDieSize();
    const clickSelectDataset = this.dataset.filter(
      (shape) => shape.type === Shape.ClickSelect,
    );
    if (clickSelectDataset.length === this.dataset.length) {
      return clickSelectDataset.map(
        (shape) => new Set<NumberTuple>([shape.coor as NumberTuple]),
      );
    }
    const masksPoint: { [key: string]: Set<NumberTuple> } = {};
    for (let x = 0; x < this.xCount; x++) {
      for (let y = 0; y < this.yCount; y++) {
        const nx =
          this.origin.x + x * this.gridItemWidth + this.gridItemWidth / 2;
        const ny =
          this.origin.y + y * this.gridItemHeight + this.gridItemHeight / 2;
        const [hitShapeIndex, hitShape] = this.hitOnShape({ x: nx, y: ny });
        if (hitShapeIndex > -1 && hitShape) {
          if (!masksPoint[hitShape.index]) {
            masksPoint[hitShape.index] = new Set<NumberTuple>();
          }
          if (hitShape.type === Shape.ClickSelect) {
            const newPoint = (hitShape as ClickSelect).coor as NumberTuple;
            if (!masksPoint[hitShape.index]?.has(newPoint)) {
              masksPoint[hitShape.index]?.add(newPoint);
            }
          } else {
            masksPoint[hitShape.index]?.add([x, y]);
          }
        }
      }
    }
    clickSelectDataset.forEach((hitShape) => {
      if (!masksPoint[hitShape.index]) {
        masksPoint[hitShape.index] = new Set<NumberTuple>();
      }
      masksPoint[hitShape.index]?.add(hitShape.coor as NumberTuple);
    });
    return orderBy(Object.entries(masksPoint), ([key]) => +key, 'asc').map(
      ([_, values]) => values,
    );
  }

  /** 判断缺陷点是否在标注框内 */
  hasDefectsInMarks(defectPoint: Point): boolean {
    this.calcCenterPointAndDieSize();
    const nx = defectPoint.x * this.gridItemWidth + this.origin.x;
    const ny = defectPoint.y * this.gridItemHeight + this.origin.y;
    const [hitShapeIndex] = this.hitOnShape({ x: nx, y: ny });
    return hitShapeIndex > -1;
  }

  /**
   * 切换图例对应die的显隐方式
   */
  toggleLegend(
    type: Layer,
    legendValue: number | string,
    callback: (selectedLegends: (number | string)[]) => void,
  ) {
    const legendValuesName =
      type === Layer.map ? 'mapLegendValues' : 'defectLegendValues';
    const existIndex = this[legendValuesName].indexOf(legendValue);
    if (existIndex === -1) {
      this[legendValuesName].push(legendValue);
    } else {
      this[legendValuesName].splice(existIndex, 1);
    }
    callback(this[legendValuesName]);
    this.debounceRedrawWafer();
  }

  /**
   * 批量设置图例
   */
  batchSetLegend(type: Layer, legendValues: number[] | string[]) {
    const legendValuesName =
      type === Layer.map ? 'mapLegendValues' : 'defectLegendValues';
    if (legendValues.length > 0) {
      this[legendValuesName] = [...legendValues];
    } else {
      this[legendValuesName].splice(0);
    }
    this.debounceRedrawWafer();
  }

  /**
   * 快速查找（标记目标 die，只保留最后一次查找结果）
   */
  quickFind(point: Point) {
    this.quickFindPoint = { ...point };
    // 快速查找是一次性定位标记，只保留最后一次查找结果。
    // 其他点选、框选等标记保持不变。
    for (let index = this.dataset.length - 1; index >= 0; index--) {
      if (this.dataset[index]?.type === Shape.QuickFind) {
        this.dataset.splice(index, 1);
      }
    }

    const waferMap = this.waferData.waferMap;
    const { x: xField, y: yField } = this.basicConfig.wmConfig.position;
    const targetDie = waferMap?.dataList.find(
      (die) =>
        Number(die[xField]) === Number(point.x) &&
        Number(die[yField]) === Number(point.y),
    );
    const displayPosition = targetDie
      ? this.getDieDisplayPosition(targetDie)
      : null;
    if (!displayPosition) {
      this.update();
      return;
    }

    const newShape = new QuickFind(
      { coor: [displayPosition.x, displayPosition.y] },
      this.dataset.length,
    );
    this.dataset.forEach((shape) => {
      shape.active = false;
    });
    newShape.active = true;
    this.dataset.push(newShape);
    this.update();
  }

  getActiveQuickFindPoint(): null | Point {
    return this.quickFindPoint ? { ...this.quickFindPoint } : null;
  }

  /**
   * 设置旋转角度（绝对方向，重复设置同一方向结果一致）
   */
  setRotate(rotateAngle: WaferRotate) {
    this.currentRotate = rotateAngle;
    const {
      position: { x: dieX, y: dieY },
    } = this.options.basicConfig.wmConfig;
    const {
      position: { x: defectX, y: defectY },
    } = this.options.basicConfig.defectConfig;

    // 绘图使用的坐标点信息
    const frontDieX = `_o_${dieX}`;
    const frontDieY = `_o_${dieY}`;
    const frontDefectX = `_o_${defectX}`;
    const frontDefectY = `_o_${defectY}`;

    if (!Object.hasOwnProperty.call(this.waferData, 'waferMap')) {
      this.waferData.waferMap = {
        dataList: [],
        minX: 0,
        minY: 0,
        minValue: 0,
        maxX: 0,
        maxY: 0,
        maxValue: 0,
        xCount: 30,
        yCount: 30,
        legendList: [],
      };
    }
    if (!Object.hasOwnProperty.call(this.waferData, 'defect')) {
      this.waferData.defect = {
        dataList: [],
        minX: 0,
        minY: 0,
        maxX: 0,
        maxY: 0,
        legendList: [],
      };
    }

    if (this.waferData.waferMap) {
      const boundary = this.waferBoundary || this.waferData.waferMap;
      const {
        minX: originMinX,
        maxX: originMaxX,
        minY: originMinY,
        maxY: originMaxY,
      } = boundary;
      const originXDieCount =
        boundary.xCount ??
        (this.waferData.waferMap.xDieCount !== undefined
          ? this.waferData.waferMap.xDieCount + 1
          : boundary.maxX - boundary.minX + 1);
      const originYDieCount =
        boundary.yCount ??
        (this.waferData.waferMap.yDieCount !== undefined
          ? this.waferData.waferMap.yDieCount + 1
          : boundary.maxY - boundary.minY + 1);

      let minX = 0;
      let maxX = 0;
      let minY = 0;
      let maxY = 0;
      let xCount = 0;
      let yCount = 0;
      if (
        rotateAngle === WaferRotate.Notch向左 ||
        rotateAngle === WaferRotate.Notch向右
      ) {
        minX = originMinX;
        maxX = originMaxX;
        minY = originMinY;
        maxY = originMaxY;
        xCount = originYDieCount;
        yCount = originXDieCount;
      } else {
        minX = originMinX;
        maxX = originMaxX;
        minY = originMinY;
        maxY = originMaxY;
        xCount = originXDieCount;
        yCount = originYDieCount;
      }
      let newMinX = 0;
      let newMinY = 0;

      // 旋转只读取未被修改的原始坐标字段、map 产出新行对象后再归一化，
      // 无需 cloneDeep 整包数据（大数据下深拷贝是主要耗时）

      // 重新映射waferDataList（归一化到 0 起点）
      const convertWaferDataList = () => {
        if (this.waferData.waferMap) {
          const xList = new Set(
            this.waferData.waferMap.dataList.map((item) =>
              Number(item[frontDieX]),
            ),
          );
          const yList = new Set(
            this.waferData.waferMap.dataList.map((item) =>
              Number(item[frontDieY]),
            ),
          );
          newMinX = Math.min(...xList);
          newMinY = Math.min(...yList);
          this.waferData.waferMap.dataList =
            this.waferData.waferMap.dataList.map((item) => {
              item[frontDieX] = item[frontDieX] - newMinX;
              item[frontDieY] = item[frontDieY] - newMinY;
              return item;
            });
        }
      };

      // 转换坐标点（从原始坐标字段出发，保证绝对方向语义）
      const readDieX = (item: Record<string, any>) =>
        dieX in item ? item[dieX] : item[frontDieX];
      const readDieY = (item: Record<string, any>) =>
        dieY in item ? item[dieY] : item[frontDieY];
      const readDefectX = (item: Record<string, any>) =>
        defectX in item ? item[defectX] : item[frontDefectX];
      const readDefectY = (item: Record<string, any>) =>
        defectY in item ? item[defectY] : item[frontDefectY];

      const rotatePoint = (rotateAngle: 0 | 90 | 180 | 270) => {
        if (this.waferData.waferMap) {
          this.waferData.waferMap.dataList =
            this.waferData.waferMap.dataList.map((item) => {
              const { x, y } = this.fastRotatePoint(
                readDieX(item),
                readDieY(item),
                rotateAngle,
                (maxX - minX) / 2,
                (maxY - minY) / 2,
              );
              return {
                ...item,
                [frontDieX]: x,
                [frontDieY]: y,
              };
            });
          convertWaferDataList();
        }
        if (this.waferData.defect) {
          this.waferData.defect.dataList = this.waferData.defect.dataList.map(
            (item) => {
              const { x, y } = this.fastRotatePoint(
                readDefectX(item) - minX,
                readDefectY(item) - minY,
                rotateAngle,
                (maxX - minX) / 2,
                (maxY - minY) / 2,
              );
              return {
                ...item,
                [frontDefectX]: x - newMinX,
                [frontDefectY]: y - newMinY,
              };
            },
          );
        }
      };

      switch (rotateAngle) {
        case WaferRotate.Notch向上: {
          rotatePoint(180);
          break;
        }
        case WaferRotate.Notch向右: {
          rotatePoint(270);
          break;
        }
        case WaferRotate.Notch向左: {
          rotatePoint(90);
          break;
        }
        case WaferRotate['Notch-X镜像']: {
          if (this.waferData.waferMap) {
            this.waferData.waferMap.dataList =
              this.waferData.waferMap.dataList.map((item) => {
                return {
                  ...item,
                  [frontDieX]: readDieX(item) - minX,
                  [frontDieY]: maxY - readDieY(item) - minY,
                };
              });
            convertWaferDataList();
          }
          if (this.waferData.defect) {
            this.waferData.defect.dataList = this.waferData.defect.dataList.map(
              (item) => {
                return {
                  ...item,
                  [frontDefectX]: readDefectX(item) - minX,
                  [frontDefectY]: maxY - readDefectY(item) - minY,
                };
              },
            );
          }
          break;
        }
        case WaferRotate['Notch-Y镜像']: {
          if (this.waferData.waferMap) {
            this.waferData.waferMap.dataList =
              this.waferData.waferMap.dataList.map((item) => {
                return {
                  ...item,
                  [frontDieX]: maxX - readDieX(item) - minX,
                  [frontDieY]: readDieY(item) - minY,
                };
              });
            convertWaferDataList();
          }
          if (this.waferData.defect) {
            this.waferData.defect.dataList = this.waferData.defect.dataList.map(
              (item) => {
                return {
                  ...item,
                  [frontDefectX]: maxX - readDefectX(item) - minX,
                  [frontDefectY]: readDefectY(item) - minY,
                };
              },
            );
          }
          break;
        }
        default: {
          rotatePoint(0);
          break;
        }
      }
      if (this.waferData.waferMap) {
        this.waferData.waferMap.xCount = xCount;
        this.waferData.waferMap.yCount = yCount;
      }
      this.updateData(this.waferData);
    }
  }

  /** 旋转坐标点 */
  private fastRotatePoint(
    x: number,
    y: number,
    angle = 0,
    cx = 0,
    cy = 0,
  ): Point {
    // 规范化角度
    angle = ((angle % 360) + 360) % 360;

    // 相对于中心的坐标
    const nx = x - cx;
    const ny = y - cy;

    let rx, ry;
    switch (angle) {
      case 90: {
        rx = -ny;
        ry = nx;
        break;
      }
      case 180: {
        rx = -nx;
        ry = -ny;
        break;
      }
      case 270: {
        rx = ny;
        ry = -nx;
        break;
      }
      default: {
        rx = nx;
        ry = ny;
      }
    }

    return {
      x: rx + cx,
      y: ry + cy,
    };
  }

  /** 导出图片时绘制图例 */
  private drawLegend(
    legendList: Record<string, any>[],
    finalCtx: CanvasRenderingContext2D,
    legendColor: string,
    legendName: string,
  ) {
    legendList.forEach((legend, index) => {
      const y = 2 + index * 15;
      finalCtx.save();
      finalCtx.fillStyle = legend[legendColor];
      finalCtx.fillRect(602, y, 12, 12);

      finalCtx.fillStyle = '#000';
      finalCtx.font = '11px Arial';
      finalCtx.fillText(legend[legendName], 617, 10 + y);
      finalCtx.restore();
    });
  }
  async saveImage(
    download: boolean = true,
  ): Promise<HTMLCanvasElement | null | undefined> {
    if (this.canvas) {
      // 等待真实绘制完成，避免导出半成品画布
      await this.whenRendered().catch(() => undefined);
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = 700; // 600（放大后） + 100（右侧图例）
      finalCanvas.height = 600;
      const finalCtx = finalCanvas.getContext('2d') as CanvasRenderingContext2D;

      // (1) 放大原图（300×300 → 600×600）
      finalCtx.fillStyle = '#fff';
      finalCtx.fillRect(0, 0, 600, 600);
      finalCtx.imageSmoothingEnabled = true; // 平滑缩放
      finalCtx.drawImage(
        this.canvas,
        0,
        0,
        this.canvas.width,
        this.canvas.height, // 原图区域
        0,
        0,
        600,
        600, // 放大到 600×600
      );
      finalCtx.fillStyle = 'rgba(255, 255, 255, 0.97)';
      finalCtx.fillRect(600, 0, 100, 600);

      if (this.basicConfig.wmConfig.visible && this.waferData.waferMap) {
        const { legendName, legendColor } = this.basicConfig.wmConfig;
        // 绘制Die图例
        this.drawLegend(
          this.waferData.waferMap.legendList,
          finalCtx,
          legendColor,
          legendName,
        );
      } else if (
        this.basicConfig.defectConfig.visible &&
        this.waferData.defect
      ) {
        const { legendName, legendColor } = this.basicConfig.defectConfig;
        // 绘制Defect图例
        this.drawLegend(
          this.waferData.defect.legendList,
          finalCtx,
          legendColor,
          legendName,
        );
      }
      const type = 'image/jpeg';
      // 使用toBlob代替toDataURL减少内存使用
      if (download) {
        finalCanvas.toBlob(
          (blob) => {
            const url = URL.createObjectURL(blob as Blob);
            this.triggerDownload(url, type.split('/')[1] as string);

            // 清理
            URL.revokeObjectURL(url);
          },
          type,
          1,
        );
      } else {
        return finalCanvas;
      }
    } else {
      return null;
    }
  }
  private triggerDownload(url: string, ext: string) {
    const link = document.createElement('a');
    link.download = `wafer-${Date.now()}.${ext}`;
    link.href = url;
    document.body.append(link);
    link.click();
    link.remove();
  }
  /**
   * 销毁
   */
  destroy() {
    this.destroyMagnifier();
    this.destroyed = true;
    this.viewUpdatePending = false;
    this.pendingViewImage = undefined;
    this.diePositionReader = undefined;
    this.drawController?.abort();
    this.drawRequested = false;
    this.drawInitLoadRequested = false;
    waferRenderQueue.cancel(this);
    this.setDrawingState(false);
    if (!this.canvas) return;
    window.cancelAnimationFrame(this.timer);
    this.updateResolve?.();
    this.updateResolve = null;
    this.image.removeEventListener('load', this.handleLoad);
    this.canvas.removeEventListener('contextmenu', this.handleContextmenu);
    // @ts-ignore
    this.canvas.removeEventListener('mousewheel', this.handleMousewheel);
    this.canvas.removeEventListener('wheel', this.handleMousewheel);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('touchstart', this.handleMouseDown);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('touchmove', this.handleMouseMove);
    this.canvas.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('touchend', this.handleMouseUp);
    this.canvas.removeEventListener('dblclick', this.handleDblclick);
    document.body.removeEventListener('keydown', this.handleKeydown, true);
    document.body.removeEventListener('keyup', this.handleKeyup, true);
    this.canvas.width = this.WIDTH;
    this.canvas.height = this.HEIGHT;
    this.ctx = null;
    if (this.waferCanvas) {
      this.waferCanvas.remove();
      this.waferCanvas = undefined;
      this.waferCtx = null;
    }
    if (this.offScreen) {
      this.offScreen.remove();
      this.offScreen = undefined;
      this.offscreenCtx = null;
    }
    this.debounceRedrawWafer.cancel();
    this.dieLegendMap.clear();
    this.defectLegendMap.clear();
    this.waferData = {};
    this.waferBoundary = null;
    this.controlPoints = [];
    this.contourGridPoints = [];
    this.contourBuckets = null;
    this.cachedBackgroundImage = null;
    this.releaseWebglResources();
    this.defectSpriteCache.clear();
    this.dieIndex = null;
    this.defectIndex = null;
    this.heatmapColorMemo = null;
    this.diePositionReader = undefined;
  }
  /**
   * 重新设置画布大小
   */
  resize(canvasSize?: number) {
    if (!this.canvas) return;
    this.resizeRequested = true;
    this.pendingCanvasSize = canvasSize;
    this.drawWafer(true, false);
  }

  /**
   * 判断鼠标是否在背景图内部
   */
  private isInBackground(_e: MouseEvent | TouchEvent): boolean {
    return true;
  }
  /**
   * 根据鼠标所在位置获取坐标信息
   */
  /**
   * 懒构建 die / defect 悬停命中索引。
   * 鼠标每次移动都要把屏幕坐标反查回数据行，线性扫描在大数据下会造成移动卡顿，
   * 这里按显示坐标（含旋转 / 压缩换算）建 "x_y" → 行 的 Map，随数据版本重建。
   */
  private ensureHoverIndex() {
    if (this.hoverIndexVersion === this.dataVersion) return;
    this.hoverIndexVersion = this.dataVersion;
    this.dieIndex = null;
    this.defectIndex = null;
    if (this.basicConfig.wmConfig.visible && this.waferData.waferMap) {
      const getPosition = this.createDiePositionReader();
      const index = new Map<string, Record<string, any>>();
      for (const item of this.waferData.waferMap.dataList) {
        const position = getPosition(item);
        if (!position) continue;
        const key = `${position.x}_${position.y}`;
        // 同格多行保留首行，与原 find 语义一致
        if (!index.has(key)) index.set(key, item);
      }
      this.dieIndex = index;
    }
    if (this.basicConfig.defectConfig.visible && this.waferData.defect) {
      const index = new Map<string, Record<string, any>>();
      for (const item of this.waferData.defect.dataList) {
        const position = this.getDefectDisplayPosition(item);
        if (!position) continue;
        const key = `${Math.floor(position.x)}_${Math.floor(position.y)}`;
        if (!index.has(key)) index.set(key, item);
      }
      this.defectIndex = index;
    }
  }

  private getPoint(mouse: Point): HoverParams {
    this.calcCenterPointAndDieSize();
    this.ensureHoverIndex();
    const { x, y } = mouse;
    const dataX = Math.floor((x - this.origin.x) / this.gridItemWidth);
    const dataY = Math.floor((y - this.origin.y) / this.gridItemHeight);
    const pointData: HoverParams = {
      x: dataX,
      y: dataY,
    };
    if (this.dieIndex) {
      pointData.dieData = this.dieIndex.get(`${dataX}_${dataY}`) || {};
    }
    if (this.defectIndex) {
      pointData.defectData = this.defectIndex.get(`${dataX}_${dataY}`) || {};
    }
    return pointData;
  }
  /** 绘制矩形 */
  private drawRect(
    shape: Rect,
    sub?: { isSelected?: boolean; selectedFillStyle?: string },
  ) {
    if (!this.ctx || shape.coor.length !== 2) return;

    const { strokeStyle, fillStyle, active, creating, coor, lineWidth } = shape;
    // @ts-ignore
    const [[x0, y0], [x1, y1]] = coor.map((a: NumberTuple) =>
      a.map((b) => Math.round(b * this.scale)),
    );
    this.ctx.save();
    this.ctx.lineWidth = lineWidth || this.lineWidth;
    this.ctx.fillStyle = sub?.isSelected
      ? sub?.selectedFillStyle || this.gridSelectedFillStyle
      : fillStyle || this.fillStyle;
    this.ctx.strokeStyle =
      active || creating
        ? this.activeStrokeStyle
        : strokeStyle || this.strokeStyle;

    const w = x1 - x0;
    const h = y1 - y0;

    if (!creating) this.ctx.fillRect(x0, y0, w, h);
    this.ctx.strokeRect(x0, y0, w, h);

    this.ctx.restore();
    this.drawLabel(coor[0], shape);
  }
  /** 绘制多边形 */
  private drawPolygon(shape: Polygon) {
    if (!this.ctx) return;
    const { strokeStyle, fillStyle, active, creating, coor, lineWidth } = shape;
    this.ctx.save();
    this.ctx.lineJoin = 'round';
    this.ctx.lineWidth = lineWidth || this.lineWidth;
    this.ctx.fillStyle = fillStyle || this.fillStyle;
    this.ctx.strokeStyle =
      active || creating
        ? this.activeStrokeStyle
        : strokeStyle || this.strokeStyle;
    this.ctx.beginPath();
    coor.forEach((el: NumberTuple, i) => {
      const [x, y] = el.map((a) => Math.round(a * this.scale));
      if (x !== undefined && y !== undefined) {
        if (i === 0) {
          this.ctx?.moveTo(x, y);
        } else {
          this.ctx?.lineTo(x, y);
        }
      }
    });
    if (creating) {
      const { x, y } = this.mouse;
      this.ctx.lineTo(x - this.origin.x, y - this.origin.y);
    } else if (coor.length > 2) {
      this.ctx.closePath();
    }
    this.ctx.fill();
    this.ctx.stroke();
    this.ctx.restore();
    this.drawLabel(coor[0], shape);
  }
  /** 绘制点 */
  private drawDot(shape: Dot) {
    if (!this.ctx) return;
    const { strokeStyle, fillStyle, active, coor, lineWidth } = shape;
    const [x, y] = coor.map((a) => a * this.scale);
    if (x !== undefined && y !== undefined) {
      this.ctx.save();
      this.ctx.lineWidth = lineWidth || this.lineWidth;
      this.ctx.fillStyle = fillStyle || this.ctrlFillStyle;
      this.ctx.strokeStyle = active
        ? this.activeStrokeStyle
        : strokeStyle || this.strokeStyle;
      this.ctx.beginPath();
      this.ctx.arc(x, y, this.ctrlRadius, 0, 2 * Math.PI, true);
      this.ctx.fill();
      this.ctx.arc(x, y, this.ctrlRadius, 0, 2 * Math.PI, true);
      this.ctx.stroke();
      this.ctx.restore();
      this.drawLabel(coor as NumberTuple, shape);
    }
  }
  private drawClickSelect(shape: ClickSelect) {
    this.calcCenterPointAndDieSize();
    if (!this.ctx) return;
    const { coor } = shape;
    const [x, y] = coor;
    const nx = (x as number) * this.gridItemWidth;
    const ny = (y as number) * this.gridItemHeight;
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(255, 0, 0, .5)';
    this.ctx.fillRect(nx, ny, this.gridItemWidth, this.gridItemHeight);
    this.ctx.restore();
  }
  private drawQuickFind(shape: QuickFind) {
    this.calcCenterPointAndDieSize();
    if (!this.ctx) return;
    const { coor } = shape;
    const [x, y] = coor;
    const nx = (x as number) * this.gridItemWidth;
    const ny = (y as number) * this.gridItemHeight;
    const lineWidth = Math.max(
      1,
      Math.min(3, Math.min(this.gridItemWidth, this.gridItemHeight) * 0.2),
    );
    this.ctx.save();
    this.ctx.strokeStyle = '#ff0000';
    this.ctx.lineWidth = lineWidth;
    this.ctx.strokeRect(
      nx + lineWidth / 2,
      ny + lineWidth / 2,
      Math.max(0, this.gridItemWidth - lineWidth),
      Math.max(0, this.gridItemHeight - lineWidth),
    );
    this.ctx.restore();
  }
  /** 绘制圆 */
  private drawCircle(shape: Circle) {
    if (!this.ctx) return;
    const {
      strokeStyle,
      fillStyle,
      active,
      coor,
      creating,
      radius,
      ctrlsData,
      lineWidth,
    } = shape;
    const [x, y] = coor.map((a) => a * this.scale);
    if (x !== undefined && y !== undefined) {
      this.ctx.save();
      this.ctx.lineWidth = lineWidth || this.lineWidth;
      this.ctx.fillStyle = fillStyle || this.fillStyle;
      this.ctx.strokeStyle =
        active || creating
          ? this.activeStrokeStyle
          : strokeStyle || this.strokeStyle;
      this.ctx.beginPath();
      this.ctx.arc(x, y, radius * this.scale, 0, 2 * Math.PI, true);
      this.ctx.fill();
      this.ctx.arc(x, y, radius * this.scale, 0, 2 * Math.PI, true);
      this.ctx.stroke();
      this.ctx.restore();
      this.drawLabel(ctrlsData[0] as NumberTuple, shape);
    }
  }
  /** 绘制折线 */
  private drawLine(shape: Line) {
    if (!this.ctx) return;
    const { strokeStyle, active, creating, coor, lineWidth } = shape;
    this.ctx.save();
    this.ctx.lineJoin = 'round';
    this.ctx.lineWidth = lineWidth || this.lineWidth;
    this.ctx.strokeStyle =
      active || creating
        ? this.activeStrokeStyle
        : strokeStyle || this.strokeStyle;
    this.ctx.beginPath();
    coor.forEach((el: NumberTuple, i) => {
      const [x, y] = el.map((a) => Math.round(a * this.scale));
      if (x !== undefined && y !== undefined) {
        if (i === 0) {
          this.ctx?.moveTo(x, y);
        } else {
          this.ctx?.lineTo(x, y);
        }
      }
    });
    if (creating) {
      const { x, y } = this.mouse;
      this.ctx.lineTo(x - this.origin.x, y - this.origin.y);
    }
    this.ctx.stroke();
    this.ctx.restore();
    this.drawLabel(coor[0], shape);
  }
  /** 绘制网格 */
  private drawGrid(shape: Grid) {
    if (!this.ctx) return;
    if (shape.coor.length !== 2) return;
    const { strokeStyle, fillStyle, active, creating, coor, lineWidth } = shape;
    const [[x0, y0], [x1, y1]] = coor.map((a: NumberTuple) =>
      a.map((b) => Math.round(b * this.scale)),
    ) as NumberTuple[];
    this.ctx.save();
    this.ctx.lineWidth = lineWidth || this.lineWidth;
    this.ctx.fillStyle = fillStyle || this.fillStyle;
    this.ctx.strokeStyle =
      active || creating
        ? this.activeStrokeStyle
        : strokeStyle || this.strokeStyle;
    shape.gridRects.forEach((rect: Rect, m) => {
      this.drawRect(rect, {
        selectedFillStyle:
          shape.selectedFillStyle || this.gridSelectedFillStyle,
        isSelected: shape.selected?.includes(m),
      });
    });
    const w = x1 - x0;
    const h = y1 - y0;
    if (!creating) this.ctx.fillRect(x0, y0, w, h);
    this.ctx.strokeRect(x0, y0, w, h);
    this.ctx.restore();
    this.drawLabel(coor[0], shape);
  }
  /** 绘制控制点 */
  private drawCtrl(point: NumberTuple) {
    if (!this.ctx) return;
    const [x, y] = point.map((a) => a * this.scale);
    if (x !== undefined && y !== undefined) {
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.fillStyle = this.ctrlFillStyle;
      this.ctx.strokeStyle = this.ctrlStrokeStyle;
      this.ctx.arc(x, y, this.ctrlRadius, 0, 2 * Math.PI, true);
      this.ctx.fill();
      this.ctx.arc(x, y, this.ctrlRadius, 0, 2 * Math.PI, true);
      this.ctx.stroke();
      this.ctx.restore();
    }
  }
  /** 绘制控制点列表 */
  private drawCtrlList(shape: Line | Polygon | Rect) {
    shape.ctrlsData.forEach((point, i) => {
      if (shape.type === Shape.Circle) {
        if (i === 1) this.drawCtrl(point);
      } else {
        this.drawCtrl(point);
      }
    });
  }
  /** 绘制label */
  private drawLabel(point: NumberTuple, shape: AllShape) {
    const {
      label = '',
      labelFillStyle = '',
      labelFont = '',
      textFillStyle = '',
      hideLabel,
      labelUp,
      lineWidth,
    } = shape;
    const isHideLabel =
      typeof hideLabel === 'boolean' ? hideLabel : this.hideLabel;
    const isLabelUp = typeof labelUp === 'boolean' ? labelUp : this.labelUp;
    const currLineWidth = lineWidth || this.lineWidth;

    if (this.ctx && label.length > 0 && !isHideLabel) {
      this.ctx.font = labelFont || this.labelFont;
      const textPaddingLeft = 4;
      const textPaddingTop = 4;
      const newText =
        label.length < this.labelMaxLen + 1
          ? label
          : `${label.slice(0, this.labelMaxLen)}...`;
      const text = this.ctx.measureText(newText);
      const font = Number.parseInt(this.ctx.font) - 4;
      const labelWidth = text.width + textPaddingLeft * 2;
      const labelHeight = font + textPaddingTop * 2;
      const [x, y] = point.map((a) => a * this.scale);
      if (x !== undefined && y !== undefined) {
        const toleft =
          this.IMAGE_ORIGIN_WIDTH - point[0] < labelWidth / this.scale;
        const toTop =
          this.IMAGE_ORIGIN_HEIGHT - point[1] < labelHeight / this.scale;
        const toTop2 = point[1] > labelHeight / this.scale;
        const isup = isLabelUp ? toTop2 : toTop;
        this.ctx.save();
        this.ctx.fillStyle = labelFillStyle || this.labelFillStyle;
        this.ctx.fillRect(
          toleft
            ? x - text.width - textPaddingLeft - currLineWidth / 2
            : x + currLineWidth / 2,
          isup ? y - labelHeight - currLineWidth / 2 : y + currLineWidth / 2,
          labelWidth,
          labelHeight,
        );
        this.ctx.fillStyle = textFillStyle || this.textFillStyle;
        this.ctx.fillText(
          newText,
          toleft ? x - text.width : x + textPaddingLeft + currLineWidth / 2,
          isup
            ? y - labelHeight + font + textPaddingTop
            : y + font + textPaddingTop + currLineWidth / 2,
          180,
        );
        this.ctx.restore();
      }
    }
  }
}
