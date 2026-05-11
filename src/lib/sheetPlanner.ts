export type CutInput = {
  id: number;
  width: number;
  height: number;
};

export type Cut = CutInput & {
  key: string;
};

export type Placement = {
  id: number;
  key: string;
  width: number;
  height: number;
  x: number;
  y: number;
  rotated: boolean;
};

export type Guide = {
  orientation: "horizontal" | "vertical";
  x: number;
  y: number;
  length: number;
};

export type PackResult = {
  placed: Placement[];
  unplaced: Cut[];
  guides: Guide[];
};

export type SheetLayout = {
  sheetNumber: number;
  placed: Placement[];
  guides: Guide[];
};

export type MultiSheetPackResult = {
  sheets: SheetLayout[];
  unplaced: Cut[];
};

export type PlannerWorkerRequest = {
  jobId: number;
  cuts: Cut[];
  sheetWidth: number;
  sheetHeight: number;
  kerfSize: number;
  maxSheets?: number;
};

export type PlannerWorkerResponse = {
  jobId: number;
  layout: MultiSheetPackResult;
};

type Region = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type SearchResult = {
  placed: Placement[];
  unplacedKeys: string[];
  usedArea: number;
  guides: Guide[];
};

type Candidate = {
  cut: Cut;
  width: number;
  height: number;
  rotated: boolean;
};

type StripReservation = {
  orientation: "horizontal" | "vertical";
  thickness: number;
  strips: Cut[][];
};

const maxCandidatesPerRegion = 6;
const exhaustiveSearchCutoff = 8;

export function normalizeCuts(cutlist: CutInput[]) {
  return cutlist.map((cut, index) => ({
    ...cut,
    key: `cut-${index + 1}`,
  }));
}

export function planSheetCuts(
  cutlist: Cut[],
  stockWidth: number,
  stockHeight: number,
  kerf: number,
  maxSheets?: number,
): MultiSheetPackResult {
  const sheets: SheetLayout[] = [];
  let remainingCuts = [...cutlist];
  let sheetNumber = 1;
  const sheetLimit =
    typeof maxSheets === "number" && maxSheets > 0
      ? Math.floor(maxSheets)
      : Number.POSITIVE_INFINITY;

  while (remainingCuts.length > 0 && sheetNumber <= sheetLimit) {
    const sheetLayout = planSingleSheetCuts(
      remainingCuts,
      stockWidth,
      stockHeight,
      kerf,
    );

    if (sheetLayout.placed.length === 0) {
      break;
    }

    sheets.push({
      sheetNumber,
      placed: sheetLayout.placed,
      guides: sheetLayout.guides,
    });

    const placedKeys = new Set(sheetLayout.placed.map((cut) => cut.key));
    remainingCuts = remainingCuts.filter((cut) => !placedKeys.has(cut.key));
    sheetNumber += 1;
  }

  return {
    sheets,
    unplaced: remainingCuts,
  };
}

function planSingleSheetCuts(
  cutlist: Cut[],
  stockWidth: number,
  stockHeight: number,
  kerf: number,
): PackResult {
  const impossibleCuts = cutlist.filter(
    (cut) =>
      !(
        (cut.width <= stockWidth && cut.height <= stockHeight) ||
        (cut.height <= stockWidth && cut.width <= stockHeight)
      ),
  );

  const possibleCuts = cutlist.filter((cut) => !impossibleCuts.includes(cut));
  const forcedHorizontalCuts = possibleCuts
    .filter((cut) => cut.width === stockWidth && cut.height <= stockHeight)
    .sort((a, b) => b.height - a.height);

  const deferredCuts = possibleCuts.filter(
    (cut) => !forcedHorizontalCuts.includes(cut),
  );

  const placed: Placement[] = [];
  const guides: Guide[] = [];
  const forcedUnplacedKeys = new Set<string>();
  let currentY = 0;

  forcedHorizontalCuts.forEach((cut, index) => {
    const y = index === 0 ? currentY : currentY + kerf;
    if (y + cut.height > stockHeight) {
      forcedUnplacedKeys.add(cut.key);
      return;
    }

    placed.push({
      id: cut.id,
      key: cut.key,
      width: cut.width,
      height: cut.height,
      x: 0,
      y,
      rotated: false,
    });

    if (y > 0) {
      guides.push({
        orientation: "horizontal",
        x: 0,
        y: y - kerf,
        length: stockWidth,
      });
    }

    currentY = y + cut.height;
  });

  const startY = placed.length > 0 ? currentY + kerf : 0;
  const remainingHeight = stockHeight - startY;
  const placedKeys = new Set(placed.map((cut) => cut.key));
  const remainingCuts = deferredCuts.filter((cut) => !placedKeys.has(cut.key));

  if (remainingCuts.length === 0 || remainingHeight <= 0) {
    const unplacedKeys = new Set([
      ...impossibleCuts.map((cut) => cut.key),
      ...forcedUnplacedKeys,
      ...remainingCuts.map((cut) => cut.key),
    ]);

    return {
      placed,
      unplaced: cutlist.filter((cut) => unplacedKeys.has(cut.key)),
      guides,
    };
  }

  const memo = new Map<string, SearchResult>();
  const baselineResult = packRegion(
    remainingCuts,
    stockWidth,
    remainingHeight,
    kerf,
    memo,
  );
  let bestRegionResult = baselineResult;

  const reservations = buildStripReservations(
    remainingCuts,
    stockWidth,
    remainingHeight,
    kerf,
  );

  reservations.forEach((reservation) => {
    const reservedResult = packWithReservation(
      remainingCuts,
      stockWidth,
      remainingHeight,
      kerf,
      reservation,
    );

    if (isBetterResult(reservedResult, bestRegionResult)) {
      bestRegionResult = reservedResult;
    }
  });

  placed.push(...offsetPlacements(bestRegionResult.placed, 0, startY));
  guides.push(...offsetGuides(bestRegionResult.guides, 0, startY));

  const unplacedKeys = new Set([
    ...impossibleCuts.map((cut) => cut.key),
    ...forcedUnplacedKeys,
    ...bestRegionResult.unplacedKeys,
  ]);

  return {
    placed,
    unplaced: cutlist.filter((cut) => unplacedKeys.has(cut.key)),
    guides,
  };
}

function packRegion(
  cuts: Cut[],
  regionWidth: number,
  regionHeight: number,
  kerf: number,
  memo: Map<string, SearchResult>,
): SearchResult {
  if (cuts.length > exhaustiveSearchCutoff) {
    return packRegionGreedy(cuts, regionWidth, regionHeight, kerf);
  }

  const sortedKeys = [...cuts.map((cut) => cut.key)].sort();
  const cacheKey = `${regionWidth}x${regionHeight}|${sortedKeys.join(",")}`;
  const cached = memo.get(cacheKey);

  if (cached) {
    return cached;
  }

  let best: SearchResult = {
    placed: [],
    unplacedKeys: cuts.map((cut) => cut.key),
    usedArea: 0,
    guides: [],
  };

  const candidates = buildCandidates(cuts, regionWidth, regionHeight).slice(
    0,
    maxCandidatesPerRegion,
  );

  for (const candidate of candidates) {
    const remainingCuts = cuts.filter((cut) => cut.key !== candidate.cut.key);
    const piecePlacement: Placement = {
      id: candidate.cut.id,
      key: candidate.cut.key,
      width: candidate.width,
      height: candidate.height,
      x: 0,
      y: 0,
      rotated: candidate.rotated,
    };

    const splitVariants = buildSplitVariants(
      regionWidth,
      regionHeight,
      candidate.width,
      candidate.height,
      kerf,
    );

    for (const variant of splitVariants) {
      const orders =
        variant.regions.length === 2
          ? [variant.regions, [variant.regions[1], variant.regions[0]]]
          : [variant.regions];

      for (const orderedRegions of orders) {
        let unplacedKeys = remainingCuts.map((cut) => cut.key);
        let usedArea = candidate.width * candidate.height;
        let placed = [piecePlacement];
        let guides = [...variant.guides];

        for (const region of orderedRegions) {
          if (region.width <= 0 || region.height <= 0 || unplacedKeys.length === 0) {
            continue;
          }

          const regionCuts = remainingCuts.filter((cut) => unplacedKeys.includes(cut.key));
          const regionResult = packRegion(
            regionCuts,
            region.width,
            region.height,
            kerf,
            memo,
          );

          unplacedKeys = regionResult.unplacedKeys;
          usedArea += regionResult.usedArea;
          placed = placed.concat(offsetPlacements(regionResult.placed, region.x, region.y));
          guides = guides.concat(offsetGuides(regionResult.guides, region.x, region.y));
        }

        const candidateResult: SearchResult = {
          placed,
          unplacedKeys,
          usedArea,
          guides,
        };

        if (isBetterResult(candidateResult, best)) {
          best = candidateResult;
        }
      }
    }
  }

  memo.set(cacheKey, best);
  return best;
}

function packWithReservation(
  cuts: Cut[],
  regionWidth: number,
  regionHeight: number,
  kerf: number,
  reservation: StripReservation,
): SearchResult {
  const reservedKeys = new Set(
    reservation.strips.flatMap((strip) => strip.map((cut) => cut.key)),
  );
  const reservedCuts = cuts.filter((cut) => reservedKeys.has(cut.key));
  const remainingCuts = cuts.filter((cut) => !reservedKeys.has(cut.key));

  const reservedPlaced: Placement[] = [];
  const reservedGuides: Guide[] = [];

  if (reservation.orientation === "horizontal") {
    const reservedHeight =
      reservation.strips.length * reservation.thickness +
      kerf * Math.max(reservation.strips.length - 1, 0);

    if (reservedHeight > regionHeight) {
      return {
        placed: [],
        unplacedKeys: cuts.map((cut) => cut.key),
        usedArea: 0,
        guides: [],
      };
    }

    const freeHeight = regionHeight - reservedHeight - (remainingCuts.length > 0 ? kerf : 0);
    const memo = new Map<string, SearchResult>();
    const freeRegionResult = packRegion(
      remainingCuts,
      regionWidth,
      Math.max(freeHeight, 0),
      kerf,
      memo,
    );

    const stripStartY = regionHeight - reservedHeight;
    let currentStripY = stripStartY;

    reservation.strips.forEach((stripCuts, stripIndex) => {
      if (stripIndex > 0) {
        reservedGuides.push({
          orientation: "horizontal",
          x: 0,
          y: currentStripY - kerf,
          length: regionWidth,
        });
      } else if (remainingCuts.length > 0 && freeHeight >= 0) {
        reservedGuides.push({
          orientation: "horizontal",
          x: 0,
          y: stripStartY - kerf,
          length: regionWidth,
        });
      }

      let currentX = 0;

      stripCuts.forEach((cut, cutIndex) => {
        if (cutIndex > 0) {
          reservedGuides.push({
            orientation: "vertical",
            x: currentX,
            y: currentStripY,
            length: reservation.thickness,
          });
          currentX += kerf;
        }

        reservedPlaced.push({
          id: cut.id,
          key: cut.key,
          width: cut.width,
          height: cut.height,
          x: currentX,
          y: currentStripY,
          rotated: false,
        });
        currentX += cut.width;
      });

      currentStripY += reservation.thickness + kerf;
    });

    return {
      placed: [
        ...freeRegionResult.placed,
        ...reservedPlaced,
      ],
      unplacedKeys: freeRegionResult.unplacedKeys,
      usedArea:
        freeRegionResult.usedArea +
        reservedCuts.reduce((total, cut) => total + cut.width * cut.height, 0),
      guides: [
        ...freeRegionResult.guides,
        ...reservedGuides,
      ],
    };
  }

  const reservedWidth =
    reservation.strips.length * reservation.thickness +
    kerf * Math.max(reservation.strips.length - 1, 0);

  if (reservedWidth > regionWidth) {
    return {
      placed: [],
      unplacedKeys: cuts.map((cut) => cut.key),
      usedArea: 0,
      guides: [],
    };
  }

  const freeWidth = regionWidth - reservedWidth - (remainingCuts.length > 0 ? kerf : 0);
  const memo = new Map<string, SearchResult>();
  const freeRegionResult = packRegion(
    remainingCuts,
    Math.max(freeWidth, 0),
    regionHeight,
    kerf,
    memo,
  );

  const stripStartX = regionWidth - reservedWidth;
  let currentStripX = stripStartX;

  reservation.strips.forEach((stripCuts, stripIndex) => {
    if (stripIndex > 0) {
      reservedGuides.push({
        orientation: "vertical",
        x: currentStripX - kerf,
        y: 0,
        length: regionHeight,
      });
    } else if (remainingCuts.length > 0 && freeWidth >= 0) {
      reservedGuides.push({
        orientation: "vertical",
        x: stripStartX - kerf,
        y: 0,
        length: regionHeight,
      });
    }

    let currentY = 0;

    stripCuts.forEach((cut, cutIndex) => {
      if (cutIndex > 0) {
        reservedGuides.push({
          orientation: "horizontal",
          x: currentStripX,
          y: currentY,
          length: reservation.thickness,
        });
        currentY += kerf;
      }

      reservedPlaced.push({
        id: cut.id,
        key: cut.key,
        width: cut.width,
        height: cut.height,
        x: currentStripX,
        y: currentY,
        rotated: false,
      });
      currentY += cut.height;
    });

    currentStripX += reservation.thickness + kerf;
  });

  return {
    placed: [
      ...freeRegionResult.placed,
      ...reservedPlaced,
    ],
    unplacedKeys: freeRegionResult.unplacedKeys,
    usedArea:
      freeRegionResult.usedArea +
      reservedCuts.reduce((total, cut) => total + cut.width * cut.height, 0),
    guides: [
      ...freeRegionResult.guides,
      ...reservedGuides,
    ],
  };
}

function packRegionGreedy(
  cuts: Cut[],
  regionWidth: number,
  regionHeight: number,
  kerf: number,
): SearchResult {
  const candidates = buildCandidates(cuts, regionWidth, regionHeight);

  if (candidates.length === 0) {
    return {
      placed: [],
      unplacedKeys: cuts.map((cut) => cut.key),
      usedArea: 0,
      guides: [],
    };
  }

  const candidate = candidates[0];
  const remainingCuts = cuts.filter((cut) => cut.key !== candidate.cut.key);
  const piecePlacement: Placement = {
    id: candidate.cut.id,
    key: candidate.cut.key,
    width: candidate.width,
    height: candidate.height,
    x: 0,
    y: 0,
    rotated: candidate.rotated,
  };

  const variants = buildSplitVariants(
    regionWidth,
    regionHeight,
    candidate.width,
    candidate.height,
    kerf,
  );
  const bestVariant = variants.sort(compareSplitVariants)[0];
  const orderedRegions = [...bestVariant.regions].sort(
    (a, b) => b.width * b.height - a.width * a.height,
  );

  let placed = [piecePlacement];
  let guides = [...bestVariant.guides];
  let usedArea = candidate.width * candidate.height;
  let unplacedKeys = remainingCuts.map((cut) => cut.key);

  orderedRegions.forEach((region) => {
    if (region.width <= 0 || region.height <= 0 || unplacedKeys.length === 0) {
      return;
    }

    const regionCuts = remainingCuts.filter((cut) => unplacedKeys.includes(cut.key));
    const regionResult = packRegionGreedy(
      regionCuts,
      region.width,
      region.height,
      kerf,
    );

    unplacedKeys = regionResult.unplacedKeys;
    usedArea += regionResult.usedArea;
    placed = placed.concat(offsetPlacements(regionResult.placed, region.x, region.y));
    guides = guides.concat(offsetGuides(regionResult.guides, region.x, region.y));
  });

  return {
    placed,
    unplacedKeys,
    usedArea,
    guides,
  };
}

function buildCandidates(cuts: Cut[], regionWidth: number, regionHeight: number) {
  const candidates: Candidate[] = [];

  cuts.forEach((cut) => {
    const orientations = [
      { width: cut.width, height: cut.height, rotated: false },
      { width: cut.height, height: cut.width, rotated: true },
    ].filter(
      (orientation, index, all) =>
        orientation.width <= regionWidth &&
        orientation.height <= regionHeight &&
        all.findIndex(
          (item) =>
            item.width === orientation.width && item.height === orientation.height,
        ) === index,
    );

    orientations.forEach((orientation) => {
      candidates.push({
        cut,
        width: orientation.width,
        height: orientation.height,
        rotated: orientation.rotated,
      });
    });
  });

  return candidates.sort((a, b) => {
    const aEdgeFit =
      Number(a.width === regionWidth) + Number(a.height === regionHeight);
    const bEdgeFit =
      Number(b.width === regionWidth) + Number(b.height === regionHeight);

    if (aEdgeFit !== bEdgeFit) {
      return bEdgeFit - aEdgeFit;
    }

    const areaDifference = b.width * b.height - a.width * a.height;
    if (areaDifference !== 0) {
      return areaDifference;
    }

    const aWaste = regionWidth * regionHeight - a.width * a.height;
    const bWaste = regionWidth * regionHeight - b.width * b.height;
    return aWaste - bWaste;
  });
}

function buildSplitVariants(
  regionWidth: number,
  regionHeight: number,
  cutWidth: number,
  cutHeight: number,
  kerf: number,
) {
  const rightGap = cutWidth < regionWidth ? kerf : 0;
  const bottomGap = cutHeight < regionHeight ? kerf : 0;
  const rightStart = cutWidth + rightGap;
  const bottomStart = cutHeight + bottomGap;

  const rightFullHeight: Region = {
    x: rightStart,
    y: 0,
    width: regionWidth - rightStart,
    height: regionHeight,
  };

  const bottomLeft: Region = {
    x: 0,
    y: bottomStart,
    width: cutWidth,
    height: regionHeight - bottomStart,
  };

  const rightTop: Region = {
    x: rightStart,
    y: 0,
    width: regionWidth - rightStart,
    height: cutHeight,
  };

  const bottomFullWidth: Region = {
    x: 0,
    y: bottomStart,
    width: regionWidth,
    height: regionHeight - bottomStart,
  };

  return [
    {
      regions: [rightFullHeight, bottomLeft].filter(isPositiveRegion),
      guides: [
        rightGap > 0
          ? {
              orientation: "vertical" as const,
              x: cutWidth,
              y: 0,
              length: regionHeight,
            }
          : null,
        bottomGap > 0
          ? {
              orientation: "horizontal" as const,
              x: 0,
              y: cutHeight,
              length: cutWidth,
            }
          : null,
      ].filter(isGuide),
    },
    {
      regions: [rightTop, bottomFullWidth].filter(isPositiveRegion),
      guides: [
        bottomGap > 0
          ? {
              orientation: "horizontal" as const,
              x: 0,
              y: cutHeight,
              length: regionWidth,
            }
          : null,
        rightGap > 0
          ? {
              orientation: "vertical" as const,
              x: cutWidth,
              y: 0,
              length: cutHeight,
            }
          : null,
      ].filter(isGuide),
    },
  ];
}

function compareSplitVariants(
  a: { regions: Region[]; guides: Guide[] },
  b: { regions: Region[]; guides: Guide[] },
) {
  const aLargestArea = Math.max(0, ...a.regions.map((region) => region.width * region.height));
  const bLargestArea = Math.max(0, ...b.regions.map((region) => region.width * region.height));

  if (aLargestArea !== bLargestArea) {
    return bLargestArea - aLargestArea;
  }

  const aRegionCount = a.regions.length;
  const bRegionCount = b.regions.length;

  if (aRegionCount !== bRegionCount) {
    return aRegionCount - bRegionCount;
  }

  return a.guides.length - b.guides.length;
}

function buildStripReservations(
  cuts: Cut[],
  regionWidth: number,
  regionHeight: number,
  kerf: number,
) {
  const reservations: StripReservation[] = [];
  const byHeight = new Map<number, Cut[]>();
  const byWidth = new Map<number, Cut[]>();

  cuts.forEach((cut) => {
    const heightGroup = byHeight.get(cut.height);
    if (heightGroup) {
      heightGroup.push(cut);
    } else {
      byHeight.set(cut.height, [cut]);
    }

    const widthGroup = byWidth.get(cut.width);
    if (widthGroup) {
      widthGroup.push(cut);
    } else {
      byWidth.set(cut.width, [cut]);
    }
  });

  byHeight.forEach((groupCuts, height) => {
    if (groupCuts.length < 2 || height > regionHeight) {
      return;
    }

    const strips = packCutsIntoStrips(groupCuts, regionWidth, kerf, "width");
    if (strips.length === 0) {
      return;
    }

    const reservedHeight =
      strips.length * height + kerf * Math.max(strips.length - 1, 0);

    if (reservedHeight <= regionHeight) {
      reservations.push({
        orientation: "horizontal",
        thickness: height,
        strips,
      });
    }
  });

  byWidth.forEach((groupCuts, width) => {
    if (groupCuts.length < 2 || width > regionWidth) {
      return;
    }

    const strips = packCutsIntoStrips(groupCuts, regionHeight, kerf, "height");
    if (strips.length === 0) {
      return;
    }

    const reservedWidth =
      strips.length * width + kerf * Math.max(strips.length - 1, 0);

    if (reservedWidth <= regionWidth) {
      reservations.push({
        orientation: "vertical",
        thickness: width,
        strips,
      });
    }
  });

  return reservations.sort((a, b) => {
    const aArea = a.strips.flat().reduce((total, cut) => total + cut.width * cut.height, 0);
    const bArea = b.strips.flat().reduce((total, cut) => total + cut.width * cut.height, 0);

    if (aArea !== bArea) {
      return bArea - aArea;
    }

    return a.strips.length - b.strips.length;
  });
}

function packCutsIntoStrips(
  cuts: Cut[],
  spanLimit: number,
  kerf: number,
  spanProperty: "width" | "height",
) {
  const strips: Cut[][] = [];
  const usedSpans: number[] = [];
  const sortedCuts = [...cuts].sort((a, b) => b[spanProperty] - a[spanProperty]);

  sortedCuts.forEach((cut) => {
    const span = cut[spanProperty];
    let bestStripIndex = -1;
    let smallestRemainder = Number.POSITIVE_INFINITY;

    usedSpans.forEach((usedSpan, stripIndex) => {
      const nextUsedSpan = usedSpan + kerf + span;
      if (nextUsedSpan > spanLimit) {
        return;
      }

      const remainder = spanLimit - nextUsedSpan;
      if (remainder < smallestRemainder) {
        smallestRemainder = remainder;
        bestStripIndex = stripIndex;
      }
    });

    if (bestStripIndex === -1) {
      if (span > spanLimit) {
        return;
      }

      strips.push([cut]);
      usedSpans.push(span);
      return;
    }

    strips[bestStripIndex].push(cut);
    usedSpans[bestStripIndex] += kerf + span;
  });

  return strips;
}

function isBetterResult(candidate: SearchResult, currentBest: SearchResult) {
  if (candidate.usedArea !== currentBest.usedArea) {
    return candidate.usedArea > currentBest.usedArea;
  }

  if (candidate.placed.length !== currentBest.placed.length) {
    return candidate.placed.length > currentBest.placed.length;
  }

  if (candidate.unplacedKeys.length !== currentBest.unplacedKeys.length) {
    return candidate.unplacedKeys.length < currentBest.unplacedKeys.length;
  }

  return candidate.guides.length < currentBest.guides.length;
}

function isPositiveRegion(region: Region) {
  return region.width > 0 && region.height > 0;
}

function isGuide(guide: Guide | null): guide is Guide {
  return guide !== null && guide.length > 0;
}

function offsetPlacements(placements: Placement[], offsetX: number, offsetY: number) {
  return placements.map((placement) => ({
    ...placement,
    x: placement.x + offsetX,
    y: placement.y + offsetY,
  }));
}

function offsetGuides(guides: Guide[], offsetX: number, offsetY: number) {
  return guides.map((guide) => ({
    ...guide,
    x: guide.x + offsetX,
    y: guide.y + offsetY,
  }));
}
