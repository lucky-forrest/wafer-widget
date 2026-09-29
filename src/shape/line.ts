import Shape from './shape';

export default class Line extends Shape {
  public override type = 4;
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(item: any, index: number) {
    super(item, index);
  }
  get ctrlsData() {
    return this.coor.length > 1 ? this.coor : [];
  }
}
