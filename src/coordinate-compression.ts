export interface WaferAxisCompression {
  indexByCoordinate: Map<number, number>;
  coordinates: number[];
}

export interface WaferCoordinateCompression {
  x: WaferAxisCompression;
  y: WaferAxisCompression;
}

const normalizeCoordinate = (value: unknown): null | number => {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
};

export const createWaferAxisCompression = (
  values: unknown[],
): WaferAxisCompression => {
  const coordinates = [
    ...new Set(
      values
        .map((value) => normalizeCoordinate(value))
        .filter((value): value is number => value !== null),
    ),
  ].sort((a, b) => a - b);

  return {
    coordinates,
    indexByCoordinate: new Map(
      coordinates.map((coordinate, index) => [coordinate, index]),
    ),
  };
};

export const createWaferCoordinateCompression = (
  dataList: Record<string, any>[],
  xField: string,
  yField: string,
): WaferCoordinateCompression => {
  return {
    x: createWaferAxisCompression(dataList.map((item) => item[`_o_${xField}`])),
    y: createWaferAxisCompression(dataList.map((item) => item[`_o_${yField}`])),
  };
};

export const mapWaferDieCoordinate = (
  value: unknown,
  axis: WaferAxisCompression,
): null | number => {
  const coordinate = normalizeCoordinate(value);
  if (coordinate === null) {
    return null;
  }
  return axis.indexByCoordinate.get(coordinate) ?? null;
};

/**
 * Defect coordinates may contain a fractional offset within a die cell.
 * The integer part identifies the source row/column; the fraction is kept.
 */
export const mapWaferOverlayCoordinate = (
  value: unknown,
  axis: WaferAxisCompression,
): null | number => {
  const coordinate = normalizeCoordinate(value);
  if (coordinate === null) {
    return null;
  }
  const sourceCell = Math.floor(coordinate);
  const compressedCell = axis.indexByCoordinate.get(sourceCell);
  if (compressedCell === undefined) {
    return null;
  }
  return compressedCell + coordinate - sourceCell;
};

/** Remove empty cells covered by a Shot rectangle while retaining occupied cells. */
export const mapWaferOverlaySpan = (
  startValue: unknown,
  lengthValue: unknown,
  axis: WaferAxisCompression,
): null | { length: number; start: number } => {
  const start = normalizeCoordinate(startValue);
  const length = normalizeCoordinate(lengthValue);
  if (start === null || length === null || length <= 0) {
    return null;
  }
  const end = start + length;
  const firstIndex = axis.coordinates.findIndex(
    (coordinate) => coordinate >= start && coordinate < end,
  );
  if (firstIndex === -1) {
    return null;
  }
  let lastIndex = firstIndex;
  for (let index = firstIndex + 1; index < axis.coordinates.length; index++) {
    const coordinate = axis.coordinates[index];
    if (coordinate === undefined || coordinate >= end) {
      break;
    }
    lastIndex = index;
  }
  return { start: firstIndex, length: lastIndex - firstIndex + 1 };
};
