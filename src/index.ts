import { colorToHex, createFunction, getInterpolatedColor, hexToWebGLColor, } from './tools';
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

 enum Layer {
  map,
  defect,
}

 enum WaferRotate {
  X镜像 = 'xMirror',
  Y镜像 = 'yMirror',
  '旋转90°' = 'rotate90',
  '旋转180°' = 'rotate180',
  '旋转270°' = 'rotate270',
  重置 = 'rotate0',
}

 interface WaferOptionShowInfo {
  title: string;
  content: string;
}

 interface WaferParams {
  waferSummary?: Record<string,any>;
  waferMap?: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    xDieCount: number;
    yDieCount: number;
    minValue: number;
    maxValue: number;
    dataList: Record<string,any>[];
    legendList: Record<string,any>[];
  };
  defect?: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    filePath?: string;
    dataList: Record<string,any>[];
    legendList: Record<string,any>[];
  };
  shot?: {
   dataList: Record<string,any>[];
  };
  zone?: {
    dataList: Record<string,any>[];
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

 interface WaferWidgetOptions {
  backgroundColor: string;
  isShowGrid: boolean;
  basicConfig: {
    size: string;
    isMeasure: boolean;
    isFullscreen: boolean;
    isReturnDataInatches: boolean;
    wsConfig: {
      visible: boolean;
      position: 'leftBottom' | 'leftTop' | 'rightBottom' | 'rightTop';
      data: WaferOptionShowInfo[];
      wsDataSet: Record<string,any>;
    };
    defectConfig: {
      visible: boolean;
      isSystemColor: boolean;
      position: { x: string; y: string };
      value: string;
      defectDataSet: Record<string,any>;
      isShowLegend: boolean;
      legendLayout: 'horizontal' | 'vertical';
      legendDataSet: Record<string,any>;
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
      isHeatmap: boolean;
      position: { x: string; y: string };
      value: string;
      hightlight: string;
      shadow: string;
      border: string;
      data: WaferOptionShowInfo[];
      wmDataSet: Record<string,any>;
      isSelection: boolean;
      isRotate: boolean;
      isQuickFind: boolean;
      isShowLegendValue: boolean;
      isShowLegend: boolean;
      legendLayout: 'horizontal' | 'vertical';
      legendDataSet: Record<string,any>;
      legendName: string;
      legendValue: string;
      legendColor: string;
      legendStatistic: string;
      transparency: number;
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

import type { DebouncedFunc } from 'lodash-es';

 type Point = { x: number; y: number };
 type NumberTuple = [number, number];
 type AllShape =
  | Circle
  | ClickSelect
  | Dot
  | Grid
  | Line
  | Polygon
  | QuickFind
  | Rect;
 type HoverParams = {
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
        return item.title; // 返回第一个匹配的 title
      }
    }
    return null; // 如果没有匹配项，返回 null
  };
}

export default class WaferWidget  extends EventBus {
  options: WaferWidgetOptions;
  waferData: WaferParams = {};
  /** 只读模式，画布不允许任何交互 */
  lock: boolean = false;
  /** 只读模式，仅支持查看 */
  readonly: boolean = false;
  /** 是否正在绘图*/
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
  offScreenCtx: CanvasRenderingContext2D | null | undefined;

  // Wafer相关配置
  waferCanvas: HTMLCanvasElement | undefined;
  waferCtx: CanvasRenderingContext2D | null | undefined;

  // 放大镜相关配置
  magnifierCanvas: HTMLCanvasElement | undefined;
  magnifierCtx: CanvasRenderingContext2D | undefined;

  // 默认展示放大镜
  isMagnifierVisible: boolean = true;
  // 放大镜位置，默认跟随鼠标
  magnifierPosition: 'auto' | NumberTuple = 'auto';

  /** 记录锚点距离 */
  remmber: NumberTuple[] = [];
  /** 记录鼠标位置 */
  mouse: Point = { x: 0, y: 0 };
  /** 记录背景图鼠标位移 */
  remmberOrigin: number[] = [0, 0];
  /** 0 不创建，1 矩形，2 多边形，3 点，4 折线，5 圆，6 网格 */
  createType: Shape = Shape.None; //
  /** 控制点索引 */
  ctrlIndex = -1;
  /** 背景图片 */
  image: HTMLImageElement = new Image();
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
  /** 最小touch双击时间 */
  dblTouch = 300;
  /** 记录touch双击开始时间 */
  dblTouchStore = 0; //
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

  // 水平方向最多die的数量（Math.abs(x的最大值 - x的最小值)）
  xDieCount = 30;
  // 垂直方向最多die数量（Math.abs(y的最大值 - y的最小值)）
  yDieCount = 30;

  private gridItemWidth = 0;
  private gridItemHeight = 0;
  private radius = 0;
  private centerPoint: Point = { x: 0, y: 0 };
  // 重新绘制wafer图
  private debounceRedrawWafer: DebouncedFunc<() => void> = debounce(() => {});
  // 记录当前需要排除掉的图例值
  private mapHeatmapValue = 0;
  private mapLegendValues: (number | string)[] = [];
  private defectLegendValues: (number | string)[] = [];
  // die及defect图例颜色映射对象
  private dieLegendMap = new Map();
  private defectLegendMap = new Map();

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

  /**
   * @param el Valid CSS selector string, or DOM
   * @param src image src
   */
  constructor(el: HTMLCanvasElement | string, options: WaferWidgetOptions) {
    super();
    this.options = options;
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
  //  wafer组件基础配置信息
  get basicConfig() {
    return this.options.basicConfig;
  }
  // 网格元素的宽
  setGridItemWidth() {
    this.gridItemWidth =
      this.IMAGE_WIDTH > 0
        ? this.IMAGE_WIDTH / this.xDieCount
        : this.WIDTH / this.xDieCount;
  }
  // 网格元素高
  setGridItemHeight() {
    this.gridItemHeight =
      this.IMAGE_HEIGHT > 0
        ? this.IMAGE_HEIGHT / this.yDieCount
        : this.HEIGHT / this.yDieCount;
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
    this.radius = this.IMAGE_WIDTH > 0 ? this.IMAGE_WIDTH / 2 : this.WIDTH / 2;
  }
  /** 当前当前选中的标注 */
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

        // 十字线 有需要可以加
        // this.magnifierCtx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
        // this.magnifierCtx.lineWidth = 1;
        // this.magnifierCtx.beginPath();
        // this.magnifierCtx.moveTo(magnifierSize / 2, 0);
        // this.magnifierCtx.lineTo(magnifierSize / 2, magnifierSize);
        // this.magnifierCtx.moveTo(0, magnifierSize / 2);
        // this.magnifierCtx.lineTo(magnifierSize, magnifierSize / 2);
        // this.magnifierCtx.stroke();

        // // 绘制放大镜边框
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
    console.log(
      '%c完成重绘',
      'color: white; font-size: 12px; background: green; padding: 2px 5px;',
    );
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
    if (!this.isDrawing) {
      if (this.lock || !this.scrollZoom) return;
      const { mouseX, mouseY } = this.mergeEvent(e);
      this.mouse = { x: mouseX, y: mouseY };
      this.setScale(e.deltaY < 0, true);
    }
  }
  /**
   * @author: forrest
   * @description: 根据point获取ClickSelect对应的shape索引信息
   * @param {Point} point
   * @Date: 2025-07-21 14:04:22
   */
  private getClickSelectShapeIndex(point: Point): number {
    return this.dataset.findIndex(
      (shape) =>
        shape.type === Shape.ClickSelect &&
        shape.coor.join(',') === `${point.x},${point.y}`,
    );
  }
  private handleMouseDown(e: MouseEvent | TouchEvent) {
    e.stopPropagation();
    if (this.lock) return;
    const { mouseX, mouseY, mouseCX, mouseCY } = this.mergeEvent(e);
    const offsetX = Math.round(mouseX / this.scale);
    const offsetY = Math.round(mouseY / this.scale);
    this.mouse =
      this.isMobile && (e as TouchEvent).touches?.length === 2
        ? { x: mouseCX, y: mouseCY }
        : { x: mouseX, y: mouseY };
    this.remmberOrigin = [mouseX - this.origin.x, mouseY - this.origin.y];
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
        this.remmber = [[offsetX - x0, offsetY - y0]];
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
              newShape = new ClickSelect({ coor: [x, y] }, this.dataset.length);
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
              newShape = new Polygon({ coor: [curPoint] }, this.dataset.length);
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
              this.remmber = [];
              if ([Shape.Circle, Shape.Dot].includes(hitShape.type)) {
                const [x, y] = hitShape.coor;
                this.remmber = [[offsetX - x, offsetY - y]];
              } else {
                hitShape.coor.forEach((pt: any) => {
                  this.remmber.push([offsetX - pt[0], offsetY - pt[1]]);
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
    const { mouseX, mouseY, mouseCX, mouseCY } = this.mergeEvent(e);
    const offsetX = Math.round(mouseX / this.scale);
    const offsetY = Math.round(mouseY / this.scale);
    this.mouse =
      this.isMobile && (e as TouchEvent).touches?.length === 2
        ? { x: mouseCX, y: mouseCY }
        : { x: mouseX, y: mouseY };
    if (
      ((!this.isMobile && (e as MouseEvent).buttons === 1) ||
        (this.isMobile && (e as TouchEvent).touches?.length === 1)) &&
      this.activeShape.type
    ) {
      if (
        this.ctrlIndex > -1 &&
        this.remmber.length > 0 &&
        (this.isInBackground(e) || this.activeShape.type === Shape.Circle)
      ) {
        const [x, y] = this.remmber[0] as NumberTuple;
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
          const [t1, t2] = this.remmber[0];
          const x = offsetX - t1;
          const y = offsetY - t2;
          if (x < 0 || x > w || y < 0 || y > h) noLimit = false;
          coor = [x, y];
        } else {
          for (let i = 0; i < this.activeShape.coor.length; i++) {
            const tar = this.remmber[i];
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
      const [remmberOriginX = 0, remmberOriginY = 0] = this.remmberOrigin;
      // 拖动背景
      this.origin = {
        x: Math.round(mouseX - remmberOriginX),
        y: Math.round(mouseY - remmberOriginY),
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
    // 鼠标抬起则卸载放大器
    this.destroyMagnifier();
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
    this.remmber = [];
    if (this.activeShape.type !== Shape.None && !this.isCtrlKey) {
      this.activeShape.dragging = false;
      if (this.activeShape.creating) {
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
        this.update();
      } else if (this.activeShape.type === Shape.ClickSelect) {
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
    // if (this.lock || document.activeElement !== document.body || this.readonly)
    //   return;
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
  private initSetting() {
    if (!this.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    // 处理图片跨域问题
    this.image.crossOrigin = 'anonymous';
    this.canvas.style.userSelect = 'none';
    this.ctx = this.ctx || this.canvas.getContext('2d', { alpha: this.alpha });
    const canvasSize =
      Math.round(this.canvas.clientWidth) ||
      +`${this.basicConfig.size}`.replace(/[a-z]/g, '') ||
      600;
    this.WIDTH = canvasSize;
    this.HEIGHT = canvasSize;
    this.canvas.width = this.WIDTH * dpr;
    this.canvas.height = this.HEIGHT * dpr;
    this.canvas.style.width = `${this.WIDTH}px`;
    this.canvas.style.height = `${this.HEIGHT}px`;
    this.canvas.style.backgroundColor =
      this.options.backgroundColor || 'transpanrent';

    this.IMAGE_ORIGIN_WIDTH = this.IMAGE_WIDTH = 1024;
    this.IMAGE_ORIGIN_HEIGHT = this.IMAGE_HEIGHT = 1024;
    this.offScreen = document.createElement('canvas');
    this.offScreen.width = this.IMAGE_WIDTH;
    this.offScreen.height = this.IMAGE_HEIGHT;
    this.offScreenCtx = this.offScreen.getContext('2d', {
      willReadFrequently: true,
    });
    //  wafer图层
    this.waferCanvas = document.createElement('canvas');
    this.waferCanvas.width = this.IMAGE_WIDTH;
    this.waferCanvas.height = this.IMAGE_HEIGHT;
    this.waferCtx = this.waferCanvas.getContext('2d', {
      willReadFrequently: true,
    });
    this.debounceRedrawWafer = debounce(this.drawWafer, 2000);
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
  /**
   * @author: forrest
   * @description: 计算中心点及Die的尺寸信息
   * @Date: 2025-04-16 17:50:21
   */
  private calcCenterPointAndDieSize() {
    this.setGridItemWidth();
    this.setGridItemHeight();
    this.setCenterPoint();
    this.setRadius();
  }
  /**
   * @author: forrest
   * @description: 更新die总数信息
   * @Date: 2025-03-12 17:43:25
   */
  private updateDieTotal() {
    if (this.waferCtx) {
      const { xDieCount, yDieCount } = this.waferData.waferMap || {
        xDieCount: 30,
        yDieCount: 30,
      };
      this.xDieCount = xDieCount + 1;
      this.yDieCount = yDieCount + 1;
      this.calcCenterPointAndDieSize();
    }
  }
  /**
   * @author: forrest
   * @description: 绘制晶圆图
   * @Date: 2025-02-10 15:29:15
   */
  private async drawWafer(isInitLoad?: boolean) {
    this.isDrawing = true;
    if (this.waferCanvas && this.waferCtx) {
      const waferCtx = this.waferCtx as CanvasRenderingContext2D;
      waferCtx.clearRect(0, 0, this.waferCanvas.width, this.waferCanvas.height);
      if (this.IMAGE_WIDTH > 0 && this.IMAGE_HEIGHT > 0) {
        this.waferCanvas.width = this.IMAGE_WIDTH;
        this.waferCanvas.height = this.IMAGE_HEIGHT;
      }
      waferCtx.translate(0, 0);
      this.updateDieTotal();

      await this.drawDie();
      await this.drawOutline();
      await this.drawLegendValue();
      await this.drawDefect();
      await this.drawReticle();
      await this.drawZones();
      await this.drawWaferSummaryInfo();

      if (this.waferCanvas) {
        this.isDrawing = false;
        // console.log('%c重绘了...', 'color: white; font-size: 12px; background: green; padding: 2px 5px;');
        if (isInitLoad || this.scale === 1) {
          const dataURL = this.waferCanvas.toDataURL('image/png');
          this.setImage(dataURL);
        } else {
          this.update(this.waferCanvas);
        }
      }
    }
  }
  /**
   * @author: forrest
   * @description: 创建并配置webgl缓冲区
   * @Date: 2025-07-20 21:04:21
   */
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
  /**
   * 清理WebGL缓冲区
   * @param gl WebGL上下文
   * @param webglBuffers 要清理的缓冲区数组
   */
  private cleanupBuffers(
    gl: WebGLRenderingContext,
    webglBuffers: WebGLBuffer[],
  ): void {
    webglBuffers.forEach((buffer) => {
      if (buffer) {
        gl.deleteBuffer(buffer);
      }
    });
  }
  /**
   * @author: forrest
   * @description: 准备die数据
   * @param {Record} pointsData
   * @param {*} any
   * @Date: 2025-06-24 19:25:16
   */
  private prepareData(pointsData: Record<string, any>[], cellSize: CellSize) {
    const wmConfig = this.basicConfig.wmConfig;
    const {
      position: { x, y },
      value,
      border,
      hightlight,
      shadow,
      isHeatmap,
      legendColor,
    } = wmConfig;
    const waferMap = this.waferData.waferMap || {
      minValue: 0,
      maxValue: 0,
      legendList: [] as Record<string, any>[],
    };
    const { minValue = 0, maxValue = 0, legendList = [] } = waferMap;
    const clonedLegendList = cloneDeep(legendList) as Record<string, any>[];

    // 缓存常用值
    const cellWidth = cellSize.width;
    const cellHeight = cellSize.height;
    const borderCellSize = this.calculateCellSize(2);
    // 预计算颜色填充次数
    const RECT_VERTICES = 6; // 每个矩形6个顶点
    const BORDER_VERTICES = 24; // 每个边框24个顶点
    const GLOW_VERTICES = 48; // 每个发光边框48个顶点

    // 初始化数组时直接计算最终大小（避免动态扩容）
    const rectCount = pointsData.length * RECT_VERTICES * 2; // 每个顶点2个坐标 (x,y)
    const borderCount = pointsData.length * BORDER_VERTICES * 2;
    const glowCount = pointsData.length * GLOW_VERTICES * 2;

    const positions = new Float32Array(rectCount);
    const colors = new Float32Array(rectCount * 2); // 每个顶点4个颜色值 (RGBA)
    const borderPositions = new Float32Array(borderCount);
    const borderColors = new Float32Array(borderCount * 2);
    const maskPositions = new Float32Array(rectCount);
    const maskColors = new Float32Array(rectCount * 2);
    const glowPositions = new Float32Array(glowCount);
    const glowColors = new Float32Array(glowCount * 2);

    // 指针跟踪当前填充位置
    let borderColorIdx = 0;
    let borderPosIdx = 0;
    let colorIdx = 0;
    let rectPosIdx = 0;
    let glowColorIdx = 0;
    let glowPosIdx = 0;
    let maskColorIdx = 0;
    let maskPosIdx = 0;

    const startX = -1;
    const startY = 1;

    for (const point of pointsData) {
      const left = startX + point[`_o_${x}`] * cellWidth;
      const right = left + cellWidth;
      const top = startY - point[`_o_${y}`] * cellHeight;
      const bottom = top - cellHeight;

      // 主矩形顶点（两个三角形）
      positions.set(
        [
          left,
          bottom,
          right,
          bottom,
          left,
          top,
          right,
          bottom,
          right,
          top,
          left,
          top,
        ],
        rectPosIdx,
      );
      rectPosIdx += 12;

      // 主矩形颜色
      let color: number[];
      if (isHeatmap) {
        const newLegendList = (
          clonedLegendList.length > 0
            ? [clonedLegendList[0], clonedLegendList.slice(-1)[0]]
            : []
        ) as Record<string, any>[];
        const hexColors = newLegendList.map((item) => item.hexColor) || [
          '#FF0000',
          '#0000FF',
        ];
        const ratio =
          maxValue - minValue > 0
            ? (point[value] - minValue) / (maxValue - minValue)
            : 0;
        const colorString = getInterpolatedColor(ratio, hexColors);
        color = Array.isArray(colorString)
          ? colorString
          : hexToWebGLColor(colorString);
      } else {
        color = (this.dieLegendMap.get(point[value]) || {})[
          `_o_${legendColor}`
        ] || [0.5, 0.5, 0.5, 1];
      }
      // 填充6个顶点的颜色
      for (let i = 0; i < RECT_VERTICES; i++) {
        colors.set(color, colorIdx);
        colorIdx += 4;
      }

      // 边框生成逻辑（复用代码块）
      const createBorder = (size: CellSize, borderColor: number[]) => {
        const innerLeft = left + size.borderWidth;
        const innerRight = right - size.borderWidth;
        const innerTop = top + size.borderHeight;
        const innerBottom = bottom - size.borderHeight;

        // 四条边框的顶点
        const borderVerts = [
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

        // 边框颜色
        for (let i = 0; i < BORDER_VERTICES; i++) {
          borderColors.set(borderColor, borderColorIdx);
          borderColorIdx += 4;
        }
      };

      // 根据条件生成边框
      if (border && point[border]) {
        createBorder(borderCellSize, [0, 0, 0, 1]);
      }
      if (hightlight && point[hightlight]) {
        createBorder(cellSize, [0.501_96, 0, 0.501_96, 1]);
      }

      // 遮罩和发光边框
      if (shadow && point[shadow]) {
        // 遮罩顶点（与主矩形相同）
        maskPositions.set(
          [
            left,
            bottom,
            right,
            bottom,
            left,
            top,
            right,
            bottom,
            right,
            top,
            left,
            top,
          ],
          maskPosIdx,
        );
        maskPosIdx += 12;

        // 遮罩颜色（灰色半透明）
        for (let i = 0; i < RECT_VERTICES; i++) {
          maskColors.set([0.5, 0.5, 0.5, 0.5], maskColorIdx);
          maskColorIdx += 4;
        }

        // 发光边框
        const glowSize = 0.4;
        const glowWidth = (glowSize / this.IMAGE_WIDTH) * 2;
        const glowHeight = (glowSize / this.IMAGE_HEIGHT) * 2;

        const glowInnerLeft = left + glowWidth;
        const glowInnerRight = right - glowWidth;
        const glowInnerTop = top + glowHeight;
        const glowInnerBottom = bottom - glowHeight;

        const glowVerts = [
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

        // 发光颜色（浅黄色半透明）
        for (let i = 0; i < GLOW_VERTICES; i++) {
          glowColors.set([1, 1, 0.3, 0.7], glowColorIdx);
          glowColorIdx += 4;
        }
      }
    }

    return {
      rectPositions: positions,
      rectColors: colors,
      borderPositions,
      borderColors,
      maskPositions,
      maskColors,
      glowPositions,
      glowColors,
      rectCount: pointsData.length * RECT_VERTICES,
      borderCount: pointsData.length * BORDER_VERTICES,
      maskCount: pointsData.length * RECT_VERTICES,
      glowCount: pointsData.length * GLOW_VERTICES,
    };
  }
  /**
   * @author: forrest
   * @description: 绘制die信息
   * @param {WebGLRenderingContext} gl
   * @Date: 2025-06-24 19:25:58
   */
  private async drawDie() {
    if (this.waferCanvas) {
      // 创建离屏Canvas
      let offscreenWebglCanvas: HTMLCanvasElement | null =
        document.createElement('canvas');
      offscreenWebglCanvas.width = this.waferCanvas.width;
      offscreenWebglCanvas.height = this.waferCanvas.height;
      let gl: null | WebGLRenderingContext = offscreenWebglCanvas.getContext(
        'webgl',
      ) as WebGLRenderingContext;

      // 存储创建的缓冲区，用于后续清理
      const buffers: WebGLBuffer[] = [];

      try {
        // 1. 初始化基础设置
        const cellSize = this.calculateCellSize();
        const shaderProgram = this.createShaderProgram(gl);

        // 设置WebGL基础状态
        gl.useProgram(shaderProgram);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.clearColor(0.5, 0.5, 0.5, 0.49);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // 2. 绘制Die元素（如果配置可见）
        if (this.basicConfig.wmConfig?.visible) {
          const { position, value } = this.basicConfig.wmConfig;
          const { dataList } = this.waferData.waferMap || {
            dataList: [] as Record<string, any>[],
          };

          // 检查必要数据是否存在
          if (position.x && position.y && dataList?.length > 0) {
            // 2.1 过滤需要绘制的Die数据
            const filteredDataList = dataList.filter((die) => {
              if (this.mapLegendValues.length > 0) {
                return !this.mapLegendValues.includes(die[value]);
              }
              if (this.basicConfig.wmConfig.isHeatmap) {
                return die[value] >= this.mapHeatmapValue;
              }
              return true;
            });

            if (filteredDataList.length > 0) {
              // 2.2 准备绘制数据
              const {
                rectPositions,
                rectColors,
                rectCount,
                borderPositions,
                borderColors,
                borderCount,
                maskPositions,
                maskColors,
                glowPositions,
                glowColors,
                maskCount,
                glowCount,
              } = this.prepareData(filteredDataList, cellSize);

              // 2.3 获取并启用着色器属性（只需设置一次）
              const aPosition = gl.getAttribLocation(
                shaderProgram,
                'aPosition',
              );
              const aColor = gl.getAttribLocation(shaderProgram, 'aColor');
              gl.enableVertexAttribArray(aPosition);
              gl.enableVertexAttribArray(aColor);

              // 2.4 绘制主矩形
              this.setupBuffer(gl, rectPositions, buffers);
              gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

              this.setupBuffer(gl, rectColors, buffers);
              gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0);

              gl.drawArrays(gl.TRIANGLES, 0, rectCount);

              // 2.5 绘制边框
              this.setupBuffer(gl, borderPositions, buffers);
              gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

              this.setupBuffer(gl, borderColors, buffers);
              gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0);

              gl.drawArrays(gl.TRIANGLES, 0, borderCount);

              // 2.6 绘制发光效果（如果有）
              if (glowCount > 0) {
                this.setupBuffer(gl, glowPositions, buffers);
                gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

                this.setupBuffer(gl, glowColors, buffers);
                gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0);

                gl.enable(gl.BLEND);
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                gl.drawArrays(gl.TRIANGLES, 0, glowCount);
                gl.disable(gl.BLEND);
              }

              // 2.7 绘制遮罩（如果有）
              if (maskCount > 0) {
                this.setupBuffer(gl, maskPositions, buffers);
                gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

                this.setupBuffer(gl, maskColors, buffers);
                gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0);

                gl.enable(gl.BLEND);
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                gl.drawArrays(gl.TRIANGLES, 0, maskCount);
                gl.disable(gl.BLEND);
              }
            }
          }
        }

        // 3. 绘制网格线（如果启用）
        if (this.options.isShowGrid) {
          this.drawGridLines(gl, shaderProgram, cellSize);
        }

        // 4. 将离屏canvas绘制到主canvas
        if (this.waferCtx) {
          this.waferCtx.drawImage(offscreenWebglCanvas, 0, 0);
        }
      } finally {
        // 清理创建的缓冲区
        this.cleanupBuffers(gl, buffers);
        offscreenWebglCanvas.remove();
        offscreenWebglCanvas = null;
        gl = null;
      }
    }
  }
  /**
   * @author: forrest
   * @description: 不显示waferMap的情况下绘制晶圆轮廓图
   * @Date: 2025-06-25 21:29:35
   */
  private async drawOutline() {
    if (
      !this.basicConfig.wmConfig.visible &&
      this.waferCanvas &&
      this.waferCtx
    ) {
      const { x: centerX, y: centerY } = this.centerPoint;
      this.waferCanvas.style.background = 'transpanrent';
      this.waferCtx.save();
      // 绘制外圆
      this.waferCtx.beginPath();
      this.waferCtx.arc(centerX, centerY, this.radius, 0, 2 * Math.PI);
      this.waferCtx.stroke();
      this.waferCtx.fillStyle = 'rgba(255, 255, 255, .75)';
      this.waferCtx.fill();
      this.waferCtx.closePath();
      this.waferCtx.clip(); // 限制绘制区域为圆内

      this.waferCtx.stroke();
      this.waferCtx.fill();
      this.waferCtx.closePath();
    }
  }
  /**
   * @author: forrest
   * @description: 绘制die的图例值
   * @Date: 2025-06-25 19:29:52
   */
  private async drawLegendValue() {
    if (
      this.waferCanvas &&
      this.waferCtx &&
      this.basicConfig.wmConfig &&
      this.basicConfig.wmConfig.visible
    ) {
      const {
        value,
        isShowLegendValue,
        position: { x, y },
      } = this.basicConfig.wmConfig;
      const { dataList } = this.waferData.waferMap || {};
      if (dataList && dataList.length > 0 && isShowLegendValue) {
        // 过滤需要绘制的Die
        const filteredDataList = dataList.filter((die) => {
          if (this.mapLegendValues.length > 0) {
            return !this.mapLegendValues.includes(die[value]);
          }
          if (this.basicConfig.wmConfig.isHeatmap) {
            return die[value] >= this.mapHeatmapValue;
          }
          return true;
        });
        // 在每个格子中心绘制value值
        this.waferCtx.textAlign = 'center';
        this.waferCtx.textBaseline = 'middle';
        this.waferCtx.fillStyle = '#000'; // 白色文本更显眼
        this.waferCtx.font = `${Math.min(20, this.gridItemWidth * 0.8)}px Arial`; // 根据格子大小调整字体

        for (const point of filteredDataList) {
          const centerX = (point[`_o_${x}`] + 0.5) * this.gridItemWidth;
          const centerY = (point[`_o_${y}`] + 0.5) * this.gridItemHeight;
          this.waferCtx.fillText(point[value].toString(), centerX, centerY);
        }
      }
    }
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
  /**
   * @author: forrest
   * @description: 绘制网格线
   * @Date: 2025-06-25 21:30:54
   */
  private drawGridLines(
    gl: WebGLRenderingContext,
    shaderProgram: WebGLProgram,
    cellSize: CellSize,
  ) {
    const buffers: WebGLBuffer[] = [];
    try {
      // 1. 准备网格顶点数据
      const gridPositions = [];
      const startX = -1; // 网格起始X坐标
      const startY = 1; // 网格起始Y坐标

      // 生成垂直线顶点
      for (let x = 0; x <= this.xDieCount; x++) {
        const posX = startX + x * cellSize.width;
        gridPositions.push(posX, startY, posX, startY - 2);
      }

      // 生成水平线顶点
      for (let y = 0; y <= this.yDieCount; y++) {
        const posY = startY - y * cellSize.height;
        gridPositions.push(startX, posY, startX + 2, posY);
      }

      const gridCount = gridPositions.length / 2;

      // 2. 设置网格线颜色（半透明灰色）
      const gridColor = [0.8902, 0.8902, 0.8902, 1];
      const gridColors = new Float32Array(gridCount * 4);
      for (let i = 0; i < gridCount; i++) {
        gridColors.set(gridColor, i * 4);
      }

      // 3. 创建并配置缓冲区
      const gridPositionBuffer = this.setupBuffer(
        gl,
        new Float32Array(gridPositions),
        buffers,
      );

      const gridColorBuffer = this.setupBuffer(gl, gridColors, buffers);

      // 4. 获取并启用着色器属性
      const aPosition = gl.getAttribLocation(shaderProgram, 'aPosition');
      const aColor = gl.getAttribLocation(shaderProgram, 'aColor');

      gl.enableVertexAttribArray(aPosition);
      gl.enableVertexAttribArray(aColor);

      // 5. 绘制网格线
      gl.bindBuffer(gl.ARRAY_BUFFER, gridPositionBuffer);
      gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, gridColorBuffer);
      gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.LINES, 0, gridCount);
    } finally {
      // 6. 清理创建的缓冲区
      this.cleanupBuffers(gl, buffers);
    }
  }
  /**
   * @author: forrest
   * @description: 创建顶点着色器
   * @param {WebGLRenderingContext} gl
   * @Date: 2025-06-24 19:24:20
   */
  private createShaderProgram(gl: WebGLRenderingContext): WebGLProgram {
    const vertexShader = gl.createShader(gl.VERTEX_SHADER) as WebGLShader;
    gl.shaderSource(vertexShader, this.vsSource);
    gl.compileShader(vertexShader);
    // if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
    //   console.error('顶点着色器错误:', gl.getShaderInfoLog(vertexShader));
    //   return null;
    // }

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER) as WebGLShader;
    gl.shaderSource(fragmentShader, this.fsSource);
    gl.compileShader(fragmentShader);
    // if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
    //   console.error('片段着色器错误:', gl.getShaderInfoLog(fragmentShader));
    //   return null;
    // }

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    // if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    //   console.error('程序链接错误:', gl.getProgramInfoLog(program));
    //   return null;
    // }
    return program;
  }
  /**
   * @author: forrest
   * @description: 绘制缺陷信息
   * @Date: 2025-06-25 21:33:37
   */
  private async drawDefect() {
    if (this.waferCanvas && this.waferCtx) {
      const {
        value,
        position: { x, y },
        legendShape,
        legendSize,
        legendColor,
      } = this.basicConfig.defectConfig;
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

      // 预计算样式以减少重复计算
      const baseFontSize = 12 * this.scale;
      if (this.waferCtx) {
        this.waferCtx.save();
        this.waferCtx.textAlign = 'center'; // 水平居中
        this.waferCtx.textBaseline = 'middle'; // 垂直居中

        filteredDataList.forEach((defect) => {
          const nx = defect[`_o_${x}`] * this.gridItemWidth;
          const ny = defect[`_o_${y}`] * this.gridItemHeight;
          const color = (getDefectColor(defect) as string) || 'black';
          const shapeSize =
            (getLegendSize(defect) as number) * this.scale || baseFontSize;
          if (this.waferCtx) {
            this.waferCtx.fillStyle = color;
            this.waferCtx.strokeStyle = color;
            this.waferCtx.font = `${shapeSize}px Arial`;

            const shapeType = getLegendShape(defect);
            switch (shapeType) {
              case 'circle': {
                this.waferCtx.fillText('◉', nx, ny);
                break;
              }
              case 'doji': {
                this.waferCtx.fillText('✦', nx, ny);
                break;
              }
              case 'fiveStar': {
                this.waferCtx.fillText('★', nx, ny);
                break;
              }
              case 'flag': {
                this.waferCtx.fillText('⚑', nx, ny);
                break;
              }
              case 'rect': {
                this.waferCtx.fillText('■', nx, ny);
                break;
              }
              case 'smallDot': {
                this.waferCtx.fillText('●', nx, ny);
                break;
              }
              case 'triangle': {
                this.waferCtx.fillText('▲', nx, ny);
                break;
              }
              case '十': {
                this.waferCtx.fillText('+', nx, ny);
                break;
              }
              default: {
                this.waferCtx.fillText('*', nx, ny);
                break;
              }
            }
          }
        });

        this.waferCtx.restore();
      }
    }
  }
  /**
   * @author: forrest
   * @description:  绘制Reticle
   * @Date: 2025-06-25 21:34:12
   */
  private async drawReticle() {
    if (
      this.waferCanvas &&
      this.waferCtx &&
      this.basicConfig.shotConfig &&
      this.basicConfig.shotConfig.visible
    ) {
      const { offsetX, offsetY, color, position } = this.basicConfig.shotConfig;
      this.waferCtx.restore();
      if (this.waferData.shot && Array.isArray(this.waferData.shot.dataList)) {
        const { x, y } = position;
        this.waferData.shot.dataList.forEach((item: Record<string, any>) => {
          if (this.waferCtx) {
            const nx = +item[x] * this.gridItemWidth;
            const ny = +item[y] * this.gridItemHeight;
            const shotOffsetX = item[offsetX] || 0;
            const shotOffsetY = item[offsetY] || 0;
            this.waferCtx.strokeStyle = colorToHex(color);
            this.waferCtx.lineWidth = 2;
            this.waferCtx.strokeRect(
              nx,
              ny,
              this.gridItemWidth * shotOffsetX,
              this.gridItemHeight * shotOffsetY,
            );
          }
        });
      }
    }
  }
  /**
   * @author: forrest
   * @description: 绘制zone
   * @Date: 2025-06-25 21:34:41
   */
  private async drawZones() {
    if (this.waferCanvas && this.waferCtx && this.waferData.zone) {
      const maxRaidus = Math.max(
        ...this.waferData.zone.dataList.map(
          (item: { maxRadius: number }) => item.maxRadius,
        ),
      );
      const radiusStep = this.radius / maxRaidus;
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
  /**
   * @author: forrest
   * @description: 绘制WaferSummary信息
   * @Date: 2025-03-12 13:48:57
   */
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
  /**
   * @author: forrest
   * @description: 重绘shot信息
   * @Date: 2025-04-03 19:25:32
   */
  redraw() {
    this.drawWafer();
  }
  updateOption(option: WaferWidgetOptions) {
    merge(this.options, option);
    this.drawWafer();
  }

  /**
   * @author: forrest
   * @description: 更新die图例映射对象
   * @param {Record} legendList
   * @param {*} any
   * @Date: 2025-07-19 10:16:57
   */
  updateDieLegend(legendList?: Record<string, any>[]) {
    const { legendValue, legendColor } = this.basicConfig.wmConfig;
    if (this.waferData.waferMap) {
      if (legendList !== undefined) {
        this.waferData.waferMap.legendList = legendList;
      }
      this.dieLegendMap.clear();
      for (const legend of this.waferData.waferMap.legendList) {
        // 绘制die的时候需要把颜色代码转成webgl专用格式
        legend[`_o_${legendColor}`] = hexToWebGLColor(legend[legendColor], 1);
        this.dieLegendMap.set(legend[legendValue], legend);
      }
    }
    if (legendList !== undefined) {
      this.redraw();
    }
  }
  /**
   * @author: forrest
   * @description: 更新defect图例映射对象
   * @param {Record} legendList
   * @param {*} any
   * @Date: 2025-07-19 10:16:33
   */
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
   * @author: forrest
   * @description: 更新wafer图数据
   * @param {WaferParams} waferData
   * @Date: 2025-03-12 14:58:56
   */
  updateData(
    waferData: WaferParams,
    contextParams?: Record<string, any>,
    callbackFn?: (...args: any[]) => any,
  ) {
    if (callbackFn) {
      this.options = callbackFn({
        option: this.options,
        data: waferData,
        ...contextParams,
      });
    }
    Object.assign(this.waferData, waferData);
    this.updateDieLegend();
    this.updateDefectLegend();
    this.resize();
  }
  /**
   * @author: forrest
   * @description: 更新热力图
   * @param {number} value
   * @Date: 2025-03-21 14:44:26
   */
  updateHeatmap(value: number) {
    this.mapHeatmapValue = value;
    this.resize();
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
  /**
   * @author: forrest
   * @description: 设置选中的dies
   * @param {Point} points
   * @Date: 2025-07-21 15:02:07
   */
  setSelectedDies(points: Point[]) {
    const initdata: AllShape[] = points.map(
      (point, index) =>
        new ClickSelect(
          {
            coor: [point.x, point.y],
          },
          index,
        ),
    );
    this.dataset = initdata;
    this.update();
  }
  /**
   * 判断是否在标注实例上
   * @param mousePoint 点击位置
   * @returns
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
  /**
   * 判断是否在矩形内
   * @param point 坐标
   * @param coor 区域坐标
   * @returns 布尔值
   */
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
  /**
   * @author: forrest
   * @description: 判断是否在多边形内
   * @param {Point} point
   * @param {NumberTuple} polygon
   * @Date: 2025-02-10 19:24:53
   */
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
   * @param point 坐标
   * @param center 圆心
   * @param r 半径
   * @param needScale 是否为圆形点击检测
   * @returns 布尔值
   */
  isPointInCircle(point: Point, center: NumberTuple, r: number): boolean {
    const { x, y } = point;
    const [x0, y0] = center.map((a) => a * this.scale);
    // @ts-ignore
    const distance = Math.hypot(x0 + this.origin.x - x, y0 + this.origin.y - y);
    return distance <= r;
  }
  /**
   * 判断是否在折线内
   * @param point 坐标
   * @param coor 区域坐标
   * @returns 布尔值
   */
  isPointInLine(point: Point, coor: NumberTuple[]): boolean {
    if (!this.offScreenCtx) return false;
    this.offScreenCtx.save();
    this.offScreenCtx.clearRect(0, 0, this.WIDTH, this.HEIGHT);
    this.offScreenCtx.translate(this.origin.x, this.origin.y);
    this.offScreenCtx.lineWidth = Math.max(this.lineWidth, 5);
    this.offScreenCtx.beginPath();
    coor.forEach((pt, i) => {
      const [x, y] = pt.map((a) => Math.round(a * this.scale));
      if (x !== undefined && y !== undefined) {
        if (i === 0) {
          this.offScreenCtx?.moveTo(x, y);
        } else {
          this.offScreenCtx?.lineTo(x, y);
        }
      }
    });
    this.offScreenCtx.stroke();
    const areaData = this.offScreenCtx.getImageData(
      0,
      0,
      this.WIDTH,
      this.HEIGHT,
    );
    const index = (point.y - 1) * this.WIDTH * 4 + point.x * 4;
    this.offScreenCtx.restore();
    return areaData.data[index + 3] !== 0;
  }
  /**
   * 更新画布
   */
  update(image?: CanvasImageSource | null, autoScale?: boolean) {
    window.cancelAnimationFrame(this.timer);
    this.timer = window.requestAnimationFrame(() => {
      if (!this.ctx) return;
      this.ctx.save();
      this.ctx.clearRect(0, 0, this.WIDTH, this.HEIGHT);
      this.ctx.translate(this.origin.x, this.origin.y);
      if (this.IMAGE_WIDTH && this.IMAGE_HEIGHT) {
        if (image) {
          this.ctx.drawImage(image, 0, 0, this.IMAGE_WIDTH, this.IMAGE_HEIGHT);
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
            this.drawCirle(shape as Circle);
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
            this.drawQuickFind(shape as QuickFind, autoScale);
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
      this.ctx.restore();
      this.emit('updated', this.dataset);
    });
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
   * 计算缩放步长
   */
  calcStep(flag = '') {
    if (this.WIDTH > 0 && this.HEIGHT > 0) {
      if (
        this.IMAGE_WIDTH < this.WIDTH &&
        this.IMAGE_HEIGHT < this.HEIGHT &&
        (flag === '' || flag === 'b')
      ) {
        this.setScale(true, false, true);
        this.calcStep('b');
      }
      if (
        (this.IMAGE_WIDTH > this.WIDTH || this.IMAGE_HEIGHT > this.HEIGHT) &&
        (flag === '' || flag === 's')
      ) {
        this.setScale(false, false, true);
        this.calcStep('s');
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
    if (
      (!type && this.imageMin < 300) ||
      (type && this.IMAGE_WIDTH > this.imageOriginMax * 100)
    )
      return;
    if (type) {
      if (this.scaleStep < 50) {
        this.scaleStep++;
      } else {
        return;
      }
    } else {
      if (this.scaleStep > -80) {
        this.scaleStep--;
      } else {
        return;
      }
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
    if (!pure) {
      this.update();
      if (type && this.scale >= 2) {
        // 只有放大才需要重绘
        this.debounceRedrawWafer();
      }
    }
  }
  /**
   * @author: forrest
   * @description: 适配背景图
   * @Date: 2025-02-12 09:57:16
   */
  fitZoom() {
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
    this.update();
  }
  /**
   * 设置专注模式
   * @param type {boolean}
   */
  setFocusMode(type: boolean) {
    this.focusMode = type;
    this.update();
  }
  /**
   * @author: forrest
   * @description: 清除标记信息
   * @Date: 2025-02-10 13:35:12
   */
  clearMarks() {
    this.dataset.splice(0);
    this.update();
  }
  /**
   * @author: forrest
   * @description: 获取标注框内的点集合
   * @Date: 2025-02-10 14:22:54
   */
  getMarksPoints(): Set<NumberTuple>[] {
    this.calcCenterPointAndDieSize();
    const masksPoint: { [key: string]: Set<NumberTuple> } = {};
    for (let x = 0; x < this.xDieCount; x++) {
      for (let y = 0; y < this.yDieCount; y++) {
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
    const clickSelectDataset = this.dataset.filter(
      (shape) => shape.type === Shape.ClickSelect,
    );
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
  /**
   * @author: forrest
   * @description: 切换图例对应die的显隐方式
   * @param {number} legendValue
   * @Date: 2025-03-13 12:05:41
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
   * @author: forrest
   * @description:  批量设置图例
   * @param {Layer} type
   * @param {number} legendValues
   * @Date: 2025-05-27 18:42:19
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
   * @author: forrest
   * @description: 快速查找
   * @param {object} point
   * @Date: 2025-03-13 13:50:02
   */
  quickFind(point: Point) {
    this.fitZoom();
    this.calcCenterPointAndDieSize();
    this.origin = {
      x: this.IMAGE_WIDTH / 2 - point.x * this.gridItemWidth,
      y: this.IMAGE_HEIGHT / 2 - point.y * this.gridItemHeight,
    };
    this.mouse = {
      x: point.x * this.gridItemWidth + this.origin.x,
      y: point.y * this.gridItemWidth + this.origin.y,
    };
    const newShape = new QuickFind(
      { coor: [point.x, point.y] },
      this.dataset.length,
    );
    if (newShape) {
      this.dataset.forEach((sp) => {
        sp.active = false;
      });
      newShape.active = true;
      const clickShapeIndex = this.getClickSelectShapeIndex({
        x: newShape.coor[0],
        y: newShape.coor[1],
      });
      if (clickShapeIndex === 0) {
        this.dataset.push(newShape);
        this.update(null, true);
      }
    }
  }
  /**
   * @author: forrest
   * @description: 设置旋转角度
   * @param {WaferRotate} rotateAngle
   * @Date: 2025-06-19 16:49:42
   */
  setRotate(rotateAngle: WaferRotate) {
    const {
      position: { x: dieX, y: dieY },
    } = this.options.basicConfig.wmConfig;
    const {
      position: { x: dX, y: dY },
    } = this.options.basicConfig.defectConfig;

    // 绘图使用的坐标点信息
    const frontDieX = `_o_${dieX}`;
    const frontDieY = `_o_${dieY}`;
    const frontDefectX = `_o_${dX}`;
    const frontDefectY = `_o_${dY}`;

    const { minX, maxX, minY, maxY } = this.waferData.waferMap || {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
    };
    let newMinX = 0;
    let newMinY = 0;
    if (!Object.hasOwnProperty.call(this.waferData, 'waferMap')) {
      this.waferData.waferMap = {
        dataList: [],
        minX: 0,
        minY: 0,
        minValue: 0,
        maxX: 0,
        maxY: 0,
        maxValue: 0,
        xDieCount: 30,
        yDieCount: 30,
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
    const copyWaferData = cloneDeep(this.waferData);

    // 转换坐标点
    const rotatePoint = (rotateAngle: 0 | 90 | 180 | 270) => {
      if (this.waferData.waferMap && copyWaferData.waferMap) {
        this.waferData.waferMap.dataList = copyWaferData.waferMap.dataList.map(
          (item) => {
            const { x, y } = this.fastRotatePoint(
              item[frontDieX],
              item[frontDieY],
              rotateAngle,
              (maxX - minX) / 2,
              (maxY - minY) / 2,
            );
            return {
              ...item,
              [frontDieX]: x,
              [frontDieY]: y,
            };
          },
        );
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
        newMinX = Math.min(...xList, minX);
        newMinY = Math.min(...yList, minY);
        this.waferData.waferMap.dataList = this.waferData.waferMap.dataList.map(
          (item) => {
            item[frontDieX] = item[frontDieX] - newMinX;
            item[frontDieY] = item[frontDieY] - newMinY;
            return item;
          },
        );
      }
      if (this.waferData.defect && copyWaferData.defect) {
        this.waferData.defect.dataList = copyWaferData.defect.dataList.map(
          (item) => {
            const { x, y } = this.fastRotatePoint(
              item[frontDefectX] - minX,
              item[frontDefectY] - minY,
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
      case WaferRotate.X镜像: {
        if (this.waferData.waferMap && copyWaferData.waferMap) {
          this.waferData.waferMap.dataList =
            copyWaferData.waferMap.dataList.map((item) => {
              return {
                ...item,
                [frontDieX]: item[frontDieX] - minX,
                [frontDieY]: maxY - item[frontDieY] - minY,
              };
            });
        }
        if (this.waferData.defect && copyWaferData.defect) {
          this.waferData.defect.dataList = copyWaferData.defect.dataList.map(
            (item) => {
              return {
                ...item,
                [frontDefectX]: item[frontDefectX] - minX,
                [frontDefectY]: maxY - item[frontDefectY] - minY,
              };
            },
          );
        }
        break;
      }
      case WaferRotate.Y镜像: {
        if (this.waferData.waferMap && copyWaferData.waferMap) {
          this.waferData.waferMap.dataList =
            copyWaferData.waferMap.dataList.map((item) => {
              return {
                ...item,
                [frontDieX]: maxX - item[frontDieX] - minX,
                [frontDieY]: item[frontDieY] - minY,
              };
            });
        }
        if (this.waferData.defect && copyWaferData.defect) {
          this.waferData.defect.dataList = copyWaferData.defect.dataList.map(
            (item) => {
              return {
                ...item,
                [frontDefectX]: maxX - item[frontDefectX] - minX,
                [frontDefectY]: item[frontDefectY] - minY,
              };
            },
          );
        }
        break;
      }
      case WaferRotate['旋转90°']: {
        rotatePoint(90);
        break;
      }
      case WaferRotate['旋转180°']: {
        rotatePoint(180);
        break;
      }
      case WaferRotate['旋转270°']: {
        rotatePoint(270);
        break;
      }
      default: {
        rotatePoint(0);
        break;
      }
    }
    this.updateData(this.waferData);
  }
  /**
   * @author: forrest
   * @description: 旋转坐标点
   * @Date: 2025-06-19 17:09:22
   */
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
  /**
   * @author: forrest
   * @description: 导出图片时绘制图例
   * @Date: 2025-05-09 17:52:38
   */
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
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = 700; // 600（放大后） + 200（右侧图片）
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
    if (!this.canvas) return;
    this.image.removeEventListener('load', this.handleLoad);
    this.canvas.removeEventListener('contextmenu', this.handleContextmenu);
    // @ts-ignore
    this.canvas.removeEventListener('mousewheel', this.handleMousewheel);
    this.canvas.removeEventListener('wheel', this.handleMousewheel);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('touchend', this.handleMouseDown);
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
      this.offScreenCtx = null;
    }
    this.dieLegendMap.clear();
    this.defectLegendMap.clear();
    this.waferData = {};
  }
  /**
   * @author: forrest
   * @description: 重新设置画布大小
   * @Date: 2025-02-12 09:57:48
   */
  resize() {
    if (!this.canvas) return;
    this.initSetting();
    this.initEvents();
    this.drawWafer(true);
  }
  /**
   * 判断鼠标是否在背景图内部
   * @param e MouseEvent
   * @returns 布尔值
   */
  private isInBackground(_e: MouseEvent | TouchEvent): boolean {
    return true;
    // const { x: originX, y: originY } = this.origin
    // const { mouseX, mouseY } = this.mergeEvent(e);
    // return (
    //   mouseX >= originX &&
    //   mouseY >= this.originY &&
    //   mouseX <= originX + this.IMAGE_ORIGIN_WIDTH * this.scale &&
    //   mouseY <= this.originY + this.IMAGE_ORIGIN_HEIGHT * this.scale
    // );
  }
  /**
   * @author: forrest
   * @description:根据鼠标所在位置获取坐标信息
   * @param {Point} mouse
   * @Date: 2025-02-10 17:51:37
   */
  private getPoint(mouse: Point): HoverParams {
    this.calcCenterPointAndDieSize();
    const { x, y } = mouse;
    const dataX = Math.floor((x - this.origin.x) / this.gridItemWidth);
    const dataY = Math.floor((y - this.origin.y) / this.gridItemHeight);
    const pointData: HoverParams = {
      x: dataX,
      y: dataY,
    };
    const getPointData = (
      point: Point,
      dataList: Record<string, any>[],
    ): Record<string, any> => {
      return (
        dataList.find(
          (item: Record<string, any>) =>
            Number(item[`_o_${point.x}`]) === dataX &&
            Number(item[`_o_${point.y}`]) === dataY,
        ) || {}
      );
    };
    if (this.basicConfig.wmConfig.visible && this.waferData.waferMap) {
      const { position } = this.basicConfig.wmConfig;
      const { dataList } = this.waferData.waferMap;
      Object.assign(pointData, {
        dieData: getPointData(position as any as Point, dataList),
      });
    }
    if (this.basicConfig.defectConfig.visible && this.waferData.defect) {
      const { position } = this.basicConfig.defectConfig;
      const { dataList } = this.waferData.defect;
      Object.assign(pointData, {
        defectData: getPointData(position as any as Point, dataList),
      });
    }
    return pointData;
  }
  /**
   * @author: forrest
   * @description:绘制矩形
   * @Date: 2025-02-10 17:43:23
   */
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
  /**
   * @author: forrest
   * @description: 绘制多边形
   * @Date: 2025-02-10 17:43:46
   */
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
  /**
   * 绘制点
   * @param shape 标注实例
   */
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
  private drawQuickFind(shape: QuickFind, autoScale?: boolean) {
    this.calcCenterPointAndDieSize();
    if (!this.ctx) return;
    const { coor } = shape;
    const [x, y] = coor;
    const nx = (x as number) * this.gridItemWidth + 0.5 * this.gridItemWidth;
    const ny = (y as number) * this.gridItemHeight - 0.5 * this.gridItemHeight;
    this.ctx.font = `${10 * this.scale}px Arial`;
    this.ctx.textAlign = 'center'; // 水平居中
    this.ctx.textBaseline = 'top'; // 垂直居中
    const flagWidth = this.ctx.measureText('✧').width;
    const gradient = this.ctx.createLinearGradient(
      nx,
      ny,
      nx + flagWidth,
      ny + 30,
    );
    gradient.addColorStop(0, 'red');
    gradient.addColorStop(0.5, 'rgba(255,255,0,1)');
    gradient.addColorStop(1, 'red');
    this.ctx.fillStyle = gradient;
    // this.ctx.fillText('⚑', nx, ny);
    this.ctx.fillText('↓', nx, ny);
    if (autoScale) {
      let scaleCount = 0;
      const interval = setInterval(() => {
        scaleCount++;
        this.setScale(true, true, true);
        if (this.scale >= 2 || scaleCount > 5) {
          clearInterval(interval);
          this.mouse = {
            x: x * this.gridItemWidth + this.origin.x,
            y: y * this.gridItemWidth + this.origin.y,
          };
          this.setScale(true, true);
        }
      }, 20);
    }
  }
  /**
   * 绘制圆
   * @param shape 标注实例
   */
  private drawCirle(shape: Circle) {
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
  /**
   * 绘制折线
   * @param shape 标注实例
   */
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
  /**
   * @author: forrest
   * @description: 绘制网格
   * @param {Grid} shape
   * @Date: 2025-02-10 16:57:59
   */
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
  /**
   * 绘制控制点
   * @param point 坐标
   */
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
  /**
   * 绘制控制点列表
   * @param shape 标注实例
   */
  private drawCtrlList(shape: Line | Polygon | Rect) {
    shape.ctrlsData.forEach((point, i) => {
      if (shape.type === Shape.Circle) {
        if (i === 1) this.drawCtrl(point);
      } else {
        this.drawCtrl(point);
      }
    });
  }
  /**
   * 绘制label
   * @param point 位置
   * @param label 文本
   */
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