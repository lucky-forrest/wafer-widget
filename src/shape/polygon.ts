import Shape from './shape';

export default class Polygon extends Shape {
  public override type = 2;
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(item: any, index: number) {
    super(item, index);
  }
  get ctrlsData() {
    return this.coor.length > 2 ? this.coor : [];
  }
}
