import Shape from './shape';

export default class Rect extends Shape {
  public override type = 1;
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(item: any, index: number) {
    super(item, index);
  }
  get ctrlsData() {
    const [[x0, y0], [x1, y1]] = this.coor;
    return [
      [x0, y0],
      [x0 + (x1 - x0) / 2, y0],
      [x1, y0],
      [x1, y0 + (y1 - y0) / 2],
      [x1, y1],
      [x0 + (x1 - x0) / 2, y1],
      [x0, y1],
      [x0, y0 + (y1 - y0) / 2],
    ];
  }
}
