import Shape from './shape';

export default class ClickSelect extends Shape {
  public override type = 7;
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(item: any, index: number) {
    super(item, index);
  }
}
