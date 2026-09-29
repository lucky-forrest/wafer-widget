import Shape from './shape';

export default class QuickFind extends Shape {
  public override type = 8;
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(item: any, index: number) {
    super(item, index);
  }
}
