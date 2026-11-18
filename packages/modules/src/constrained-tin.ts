/** Explicit planar constraints use indexes into the original survey point array. */
export interface CivilTinConstraints {
  readonly boundary?: readonly number[];
  readonly holes?: readonly (readonly number[])[];
  readonly breaklines?: readonly (readonly number[])[];
}

/** Keep UI point numbers valid when coincident XYZ points share one TIN vertex. */
export function remapCivilTinConstraints(input: CivilTinConstraints, indexes: readonly number[]): CivilTinConstraints {
  const path = (values: readonly number[]): number[] => {
    if (!Array.isArray(values) || values.length > 512) throw new RangeError("Omezení TIN vyžaduje nejvýše 512 indexů bodů.");
    return values.map((value) => {
      if (!Number.isInteger(value) || value < 0 || value >= indexes.length) {
        throw new TypeError("Omezení TIN: index bodu musí být celé číslo v rozsahu vstupních bodů.");
      }
      return indexes[value]!;
    });
  };
  const paths = (values: readonly (readonly number[])[]): number[][] => {
    if (!Array.isArray(values) || values.length > 128) throw new RangeError("TIN podporuje nejvýše 128 otvorů a 128 lomových linií.");
    return values.map(path);
  };
  return {
    ...(input.boundary !== undefined ? { boundary: path(input.boundary) } : {}),
    ...(input.holes !== undefined ? { holes: paths(input.holes) } : {}),
    ...(input.breaklines !== undefined ? { breaklines: paths(input.breaklines) } : {}),
  };
}

type Point = readonly [number, number, number];
type Face = readonly [number, number, number];
type Edge = readonly [number, number];
const EPS = 1e-12;
const edgeKey = ([a, b]: Edge): string => a < b ? `${a}:${b}` : `${b}:${a}`;
const faceEdges = ([a, b, c]: Face): Edge[] => [[a, b], [b, c], [c, a]];
const orient = (a: Point, b: Point, c: Point): number => (
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
);
const onSegment = (p: Point, a: Point, b: Point): boolean => Math.abs(orient(a, b, p)) <= EPS
  && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS
  && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
const properIntersection = (a: Point, b: Point, c: Point, d: Point): boolean => (
  ((orient(a, b, c) > EPS && orient(a, b, d) < -EPS) || (orient(a, b, c) < -EPS && orient(a, b, d) > EPS))
  && ((orient(c, d, a) > EPS && orient(c, d, b) < -EPS) || (orient(c, d, a) < -EPS && orient(c, d, b) > EPS))
);
const ringArea = (ring: readonly number[], points: readonly Point[]): number => ring.reduce((sum, index, offset) => {
  const a = points[index]!;
  const b = points[ring[(offset + 1) % ring.length]!]!;
  return sum + a[0] * b[1] - b[0] * a[1];
}, 0) / 2;
const inRing = (point: Point, ring: readonly number[], points: readonly Point[]): boolean => {
  let inside = false;
  for (let index = 0; index < ring.length; index += 1) {
    const a = points[ring[index]!]!;
    const b = points[ring[(index + 1) % ring.length]!]!;
    if (onSegment(point, a, b)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};

export const hasCivilTinConstraints = (input: CivilTinConstraints): boolean => (
  input.boundary !== undefined
  || (input.holes !== undefined && (!Array.isArray(input.holes) || input.holes.length > 0))
  || (input.breaklines !== undefined && (!Array.isArray(input.breaklines) || input.breaklines.length > 0))
);

/**
 * Recover constraint edges by flipping crossed diagonals of convex quadrilaterals. Domain clipping happens only AFTER every constraint is a mesh edge.
 * This deliberately makes no constrained-Delaunay quality guarantee after recovery.
 */
export function constrainCivilTin(
  vertices: readonly Point[], input: CivilTinConstraints,
): readonly Face[] {
  let work = 0;
  const spend = (): void => {
    if (++work > 10_000_000) throw new RangeError("Omezená triangulace překročila limit složitosti. Rozdělte model na menší části.");
  };
  const originX = Math.min(...vertices.map((point) => point[0]));
  const originY = Math.min(...vertices.map((point) => point[1]));
  const extent = Math.max(...vertices.map((point) => Math.max(point[0] - originX, point[1] - originY)));
  const points: Point[] = vertices.map((point) => [(point[0] - originX) / extent, (point[1] - originY) / extent, point[2]]);
  const paths: { indexes: readonly number[]; ring: boolean; label: string }[] = [];
  const appendPath = (indexes: readonly number[], ring: boolean, label: string): void => {
    if (!Array.isArray(indexes) || indexes.length < (ring ? 3 : 2) || indexes.length > 512) {
      throw new RangeError(`${label}: vyžaduje ${ring ? 3 : 2} až 512 indexů bodů.`);
    }
    if (indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= points.length)) {
      throw new TypeError(`${label}: index bodu musí být celé číslo v rozsahu vstupních bodů.`);
    }
    if (new Set(indexes).size !== indexes.length) {
      throw new TypeError(`${label}: bod se nesmí opakovat; uzavření obvodu se doplní automaticky.`);
    }
    if (ring && Math.abs(ringArea(indexes, points)) <= EPS) throw new TypeError(`${label}: nulová nebo nestabilní plocha.`);
    paths.push({ indexes, ring, label });
  };
  if (input.boundary !== undefined) appendPath(input.boundary, true, "Obvod");
  for (const key of ["holes", "breaklines"] as const) {
    if (input[key] !== undefined && (!Array.isArray(input[key]) || input[key]!.length > 128)) {
      throw new RangeError("TIN podporuje nejvýše 128 otvorů a 128 lomových linií.");
    }
  }
  if (input.holes?.length && !input.boundary) throw new TypeError("Otvory vyžadují explicitní obvod povrchu.");
  input.holes?.forEach((ring, index) => appendPath(ring, true, `Otvor ${index + 1}`));
  input.breaklines?.forEach((line, index) => appendPath(line, false, `Lomová linie ${index + 1}`));
  const rawCount = paths.reduce((count, path) => count + path.indexes.length - (path.ring ? 0 : 1), 0);
  if (rawCount > 512) throw new RangeError("TIN podporuje nejvýše 512 zadaných hran omezení.");

  // Split every segment at all input points on it; elevations remain untouched.
  const pathEdges = paths.map((path) => {
    const edges: Edge[] = [];
    for (let index = 0; index < path.indexes.length - (path.ring ? 0 : 1); index += 1) {
      const a = path.indexes[index]!;
      const b = path.indexes[(index + 1) % path.indexes.length]!;
      const start = points[a]!;
      const end = points[b]!;
      const along = points.map((point, vertexIndex) => ({ point, vertexIndex })).filter(({ point }) => {
        spend(); return onSegment(point, start, end);
      }).sort((left, right) => ((left.point[0] - start[0]) * (end[0] - start[0]) + (left.point[1] - start[1]) * (end[1] - start[1]))
        - ((right.point[0] - start[0]) * (end[0] - start[0]) + (right.point[1] - start[1]) * (end[1] - start[1])));
      if (along[0]?.vertexIndex !== a || along.at(-1)?.vertexIndex !== b) throw new TypeError("Hrana omezení je numericky nestabilní; upravte příliš blízké body.");
      for (let offset = 1; offset < along.length; offset += 1) edges.push([along[offset - 1]!.vertexIndex, along[offset]!.vertexIndex]);
    }
    // No self-touching rings or polylines, including implicit vertices on segments.
    const chain = [...edges.map((edge) => edge[0]), ...(path.ring ? [] : [edges.at(-1)![1]])];
    if (new Set(chain).size !== chain.length) throw new TypeError(`${path.label}: linie se sama dotýká nebo překrývá.`);
    return edges;
  });
  const all = pathEdges.flatMap((edges, pathIndex) => edges.map((edge) => ({ edge, pathIndex })));
  if (all.length > 2_048) throw new RangeError("Po rozdělení v bodech smí TIN obsahovat nejvýše 2 048 hran omezení.");
  for (let first = 0; first < all.length; first += 1) {
    const left = all[first]!;
    for (let second = first + 1; second < all.length; second += 1) {
      spend();
      const right = all[second]!;
      const shared = left.edge.some((index) => right.edge.includes(index));
      if (left.pathIndex !== right.pathIndex && paths[left.pathIndex]!.ring && paths[right.pathIndex]!.ring && shared) {
        throw new TypeError("Obvod a otvory se nesmí dotýkat ani sdílet hranu.");
      }
      const [a, b] = left.edge.map((index) => points[index]!) as [Point, Point];
      const [c, d] = right.edge.map((index) => points[index]!) as [Point, Point];
      if (!shared && (properIntersection(a, b, c, d) || onSegment(a, c, d) || onSegment(b, c, d)
        || onSegment(c, a, b) || onSegment(d, a, b))) {
        throw new TypeError("Hrany omezení se protínají bez společného vstupního bodu. Doplňte průsečík se společnou výškou.");
      }
    }
  }
  const holes = input.holes ?? [];
  for (let index = 0; index < holes.length; index += 1) {
    const point = points[holes[index]![0]!]!;
    if (!inRing(point, input.boundary!, points)) throw new TypeError("Otvor musí ležet uvnitř obvodu povrchu.");
    for (let other = 0; other < holes.length; other += 1) {
      if (other !== index && inRing(point, holes[other]!, points)) throw new TypeError("Otvory se nesmí překrývat ani vnořovat.");
    }
  }
  const inDomain = (point: Point): boolean => (!input.boundary || inRing(point, input.boundary, points))
    && !holes.some((hole) => inRing(point, hole, points));
  for (let index = 0; index < paths.length; index += 1) {
    if (paths[index]!.ring) continue;
    for (const [a, b] of pathEdges[index]!) {
      const midpoint: Point = [(points[a]![0] + points[b]![0]) / 2, (points[a]![1] + points[b]![1]) / 2, 0];
      // A breakline coincident with a hole boundary is already represented there.
      if (!inDomain(midpoint) && !all.some((candidate) => paths[candidate.pathIndex]!.ring && edgeKey(candidate.edge) === edgeKey([a, b]))) {
        throw new TypeError("Lomová linie leží mimo obvod nebo prochází otvorem.");
      }
    }
  }

  const earClip = (polygon: number[]): Face[] => {
    if (polygon.length < 3) return [];
    const remaining = ringArea(polygon, points) > 0 ? [...polygon] : [...polygon].reverse();
    const result: Face[] = [];
    while (remaining.length > 3) {
      let clipped = false;
      for (let index = 0; index < remaining.length; index += 1) {
        spend();
        const a = remaining[(index + remaining.length - 1) % remaining.length]!;
        const b = remaining[index]!;
        const c = remaining[(index + 1) % remaining.length]!;
        if (orient(points[a]!, points[b]!, points[c]!) <= EPS) continue;
        const occupied = remaining.some((candidate) => {
          spend();
          return candidate !== a && candidate !== b && candidate !== c
            && orient(points[a]!, points[b]!, points[candidate]!) >= -EPS
            && orient(points[b]!, points[c]!, points[candidate]!) >= -EPS
            && orient(points[c]!, points[a]!, points[candidate]!) >= -EPS;
        });
        if (occupied) continue;
        result.push([a, b, c]); remaining.splice(index, 1); clipped = true; break;
      }
      if (!clipped) throw new TypeError("Hranu nelze bezpečně vložit: nestabilní nebo degenerovaná oblast triangulace.");
    }
    if (orient(points[remaining[0]!]!, points[remaining[1]!]!, points[remaining[2]!]!) <= EPS) {
      throw new TypeError("Hrana omezení vytváří degenerovaný trojúhelník.");
    }
    result.push([remaining[0]!, remaining[1]!, remaining[2]!]);
    return result;
  };
  // Start with a complete convex hull, then insert every survey point. A finite
  // Delaunay supertriangle can leave gaps near the hull, which constraints cannot
  // repair by edge recovery. This construction guarantees the whole hull exists.
  const ordered = points.map((_, index) => index).sort((a, b) => points[a]![0] - points[b]![0] || points[a]![1] - points[b]![1]);
  const halfHull = (indexes: number[]): number[] => {
    const hull: number[] = [];
    for (const index of indexes) {
      while (hull.length > 1 && orient(points[hull.at(-2)!]!, points[hull.at(-1)!]!, points[index]!) <= EPS) hull.pop();
      hull.push(index);
    }
    return hull.slice(0, -1);
  };
  const hull = [...halfHull(ordered), ...halfHull([...ordered].reverse())];
  if (hull.length < 3) throw new TypeError("TIN je degenerovaný: body jsou kolineární nebo numericky nestabilní.");
  let faces: Face[] = earClip(hull);
  const hullIndexes = new Set(hull);
  for (let index = 0; index < points.length; index += 1) {
    if (hullIndexes.has(index)) continue;
    const replacement: Face[] = [];
    let inserted = false;
    for (const face of faces) {
      spend();
      const sides = faceEdges(face).map(([a, b]) => orient(points[a]!, points[b]!, points[index]!));
      if (sides.some((side) => side < -EPS)) { replacement.push(face); continue; }
      inserted = true;
      const candidates = faceEdges(face).map(([a, b]): Face => [a, b, index]);
      for (const candidate of candidates) {
        const [a, b, c] = candidate;
        if (orient(points[a]!, points[b]!, points[c]!) > EPS) replacement.push(candidate);
      }
    }
    if (!inserted) throw new TypeError("Bod nelze vložit do TIN; souřadnice jsou numericky nestabilní.");
    faces = replacement;
  }
  const constraints = [...new Map(all.map(({ edge }) => [edgeKey(edge), edge])).values()];
  for (const [start, end] of constraints) {
    const target = edgeKey([start, end]);
    // Lawson-style edge recovery: only crossed edges can flip, so previously
    // recovered constraints remain untouched. Queue retries are bounded below.
    const buildAdjacency = (): Map<string, { edge: Edge; faces: number[] }> => {
      const adjacency = new Map<string, { edge: Edge; faces: number[] }>();
      faces.forEach((face, faceIndex) => {
        spend();
        for (const edge of faceEdges(face)) {
          const existing = adjacency.get(edgeKey(edge));
          if (existing) existing.faces.push(faceIndex);
          else adjacency.set(edgeKey(edge), { edge, faces: [faceIndex] });
        }
      });
      return adjacency;
    };
    let adjacency = buildAdjacency();
    if (adjacency.has(target)) continue;
    const queue = [...adjacency.values()].filter(({ edge: [a, b] }) => properIntersection(points[start]!, points[end]!, points[a]!, points[b]!)).map(({ edge }) => edgeKey(edge));
    if (!queue.length) throw new TypeError(`Hranu omezení ${start + 1}–${end + 1} nelze vložit do triangulace; zkontrolujte numerickou přesnost bodů.`);
    let stalled = 0;
    const normalize = ([a, b, c]: Face): Face => orient(points[a]!, points[b]!, points[c]!) > 0 ? [a, b, c] : [a, c, b];
    while (queue.length) {
      spend();
      const current = queue.shift()!;
      const item = adjacency.get(current);
      if (!item) continue;
      const [a, b] = item.edge;
      const [first, second] = item.faces;
      if (item.faces.length !== 2) throw new TypeError("Hrana omezení prochází mimo triangulovanou oblast.");
      const c = faces[first!]!.find((index) => index !== a && index !== b)!;
      const d = faces[second!]!.find((index) => index !== a && index !== b)!;
      if (!properIntersection(points[a]!, points[b]!, points[c]!, points[d]!)) {
        queue.push(current);
        if (++stalled >= queue.length) throw new TypeError("Hranu nelze bezpečně vložit: nestabilní nebo degenerovaná oblast triangulace.");
        continue;
      }
      stalled = 0;
      faces[first!] = normalize([c, d, a]); faces[second!] = normalize([d, c, b]);
      adjacency = buildAdjacency();
      if (properIntersection(points[start]!, points[end]!, points[c]!, points[d]!)) queue.push(edgeKey([c, d]));
    }
    if (!adjacency.has(target)) throw new TypeError("Triangulace nezachovala zadanou lomovou hranu.");
  }
  // Recovered ring edges separate the domain exactly; no triangle can cross a ring.
  faces = faces.filter(([a, b, c]) => inDomain([
    (points[a]![0] + points[b]![0] + points[c]![0]) / 3,
    (points[a]![1] + points[b]![1] + points[c]![1]) / 3, 0,
  ]));
  const meshEdges = new Map<string, { edge: Edge; count: number }>();
  for (const face of faces) for (const edge of faceEdges(face)) {
    const existing = meshEdges.get(edgeKey(edge));
    meshEdges.set(edgeKey(edge), { edge, count: (existing?.count ?? 0) + 1 });
  }
  for (const edge of constraints) {
    if (!meshEdges.has(edgeKey(edge))) throw new TypeError("Výsledný TIN nezachoval všechny zadané hrany omezení.");
  }
  const ringEdges = new Set(all.filter(({ pathIndex }) => paths[pathIndex]!.ring).map(({ edge }) => edgeKey(edge)));
  for (const [key, { edge: [a, b], count }] of meshEdges) {
    if (count > 2 || (input.boundary && count !== (ringEdges.has(key) ? 1 : 2))) {
      throw new TypeError("Výsledný TIN není souvislá plocha se zadanými hranicemi.");
    }
    for (const [c, d] of constraints) {
      spend();
      if (properIntersection(points[a]!, points[b]!, points[c]!, points[d]!)) throw new TypeError("Výsledný TIN protíná hranu omezení.");
    }
  }
  const expected = Math.abs(ringArea(input.boundary ?? hull, points)) - holes.reduce((sum, hole) => sum + Math.abs(ringArea(hole, points)), 0);
  const actual = faces.reduce((sum, [a, b, c]) => sum + orient(points[a]!, points[b]!, points[c]!) / 2, 0);
  if (Math.abs(expected - actual) > Math.max(EPS * 10, expected * 1e-9)) throw new TypeError("Plocha TIN neodpovídá obvodu a otvorům.");
  const usedVertices = new Set(faces.flat());
  if (points.some((point, index) => inDomain(point) && !usedVertices.has(index))) {
    throw new TypeError("TIN nezachoval všechny vstupní body uvnitř oblasti; upravte numericky nestabilní souřadnice.");
  }
  if (!faces.length) throw new TypeError("Po použití obvodu a otvorů nezůstal žádný trojúhelník.");
  return faces;
}
