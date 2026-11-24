/* The 3D models can't be eyeballed in CI, so check the parametric geometry maths: control surfaces
   re-expressed around their hinge line must sit exactly where the plain panel would be, on every
   design (swept, tapered, vertical). */
import { describe, expect, it } from "vitest";
import { Box3, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { hingedSurface, panel } from "../aircraftModel";
import { DESIGNS } from "../designs";

const mat = new MeshBasicMaterial();
const box = (o: import("three").Object3D) => {
  o.updateMatrixWorld(true);
  return new Box3().setFromObject(o, true); // precise: per-vertex, not a rotated AABB
};
const close = (a: Vector3, b: Vector3) => expect(a.distanceTo(b)).toBeLessThan(1e-4);

describe("parametric aircraft geometry", () => {
  for (const [id, d] of Object.entries(DESIGNS)) {
    it(`${id}: hinged ailerons / elevators / rudder sit on their trailing edges`, () => {
      for (const side of [-1, 1]) {
        const ail = box(hingedSurface(d.wing, side, 0.58, 0.94, 0.72, mat));
        const ref = box(new Mesh(panel(d.wing, side, 0.58, 0.94, 0.72, 1), mat));
        close(ail.min, ref.min);
        close(ail.max, ref.max);
        const el = box(hingedSurface(d.hstab, side, 0.02, 1, 0.62, mat));
        const elRef = box(new Mesh(panel(d.hstab, side, 0.02, 1, 0.62, 1), mat));
        close(el.min, elRef.min);
        close(el.max, elRef.max);
      }
      const fin = { ...d.fin, span: d.fin.height * 2, dihedral: 0, thickness: d.fin.rootChord * 0.1 };
      const rud = box(hingedSurface(fin, 1, 0.02, 1, 0.65, mat, true));
      const rudRef = box(new Mesh(panel(fin, 1, 0.02, 1, 0.65, 1, true), mat));
      close(rud.min, rudRef.min);
      close(rud.max, rudRef.max);
    });

    it(`${id}: the wing spans its design span and the left half mirrors the right`, () => {
      const L = box(new Mesh(panel(d.wing, -1, 0, 1, 0, 1), mat));
      const R = box(new Mesh(panel(d.wing, 1, 0, 1, 0, 1), mat));
      expect(R.max.x).toBeCloseTo(d.wing.span / 2, 3);
      expect(L.min.x).toBeCloseTo(-d.wing.span / 2, 3);
      expect(R.max.z - L.max.z).toBeCloseTo(0, 5);
    });
  }
});
