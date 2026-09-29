import Shape from './shape';

export default class Dot extends Shape {
  public override type = 3;
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(item: any, index: number) {
    super(item, index);
  }
}
