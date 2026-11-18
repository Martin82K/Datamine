import test from "node:test";
import assert from "node:assert/strict";
import { emptyTinConstraints, parseTinConstraints } from "../src/tin-constraints.ts";
test("převádí pevné číslování, uzavření a víc řádků", () => {
  assert.deepEqual(parseTinConstraints({ boundary: "1,2;3 4 1", holes: "5 6 7\n\n8 9 10", breaklines: "1 3\n2 4" }, 10), { boundary: [0,1,2,3], holes: [[4,5,6],[7,8,9]], breaklines: [[0,2],[1,3]] });
  assert.deepEqual(parseTinConstraints(emptyTinConstraints(), 4), {});
});
test("odmítne zlomky, rozsahy, skripty, neplatné indexy a otvor bez obvodu", () => {
  for (const boundary of ["0 1 2", "1 2 5", "1.1 2 3", "1e0 2 3", "1-3", "<script> 2 3", "1 2", "1,".repeat(9000)]) assert.throws(() => parseTinConstraints({ ...emptyTinConstraints(), boundary }, 4));
  assert.throws(() => parseTinConstraints({ ...emptyTinConstraints(), holes: "1 2 3" }, 4), /obvod/);
});
